import { Component, director, EventTarget, isValid, Node, Tween } from 'cc';
import * as cc from 'cc';
import { Capability, Counts, InspectorConfig, ObjectKind, TrackedObject } from '../src/shared/model';
import { HookScope, short, weak, WeakHandle } from './hooks';

interface Entry { value: TrackedObject; ref?: WeakHandle; }
export interface ObjectInventory { counts: Pick<Counts, 'nodes' | 'components' | 'tweens' | 'listeners'>; objects: TrackedObject[]; truncated: boolean; }

/** All engine references in persistent registries are weak. Snapshots contain strings/numbers only. */
export class ObjectTracker {
    private ids = new WeakMap<object, string>();
    private serial = 0;
    private entries = new Map<string, Entry>();
    private emitters = new Map<string, WeakHandle>();
    private observed = new Set<string>();
    private scannedTables = new Set<any>();
    private ignoredCallbacks = new WeakSet<Function>();
    private inScan = false;
    private overflow = false;
    private tweenSupported = false;
    private eventTableSupported = false;
    private enabled = true;

    constructor(private config: InspectorConfig, private now: () => number, private onDrop: () => void) {}

    private identity(object: any): string {
        if (!object || (typeof object !== 'object' && typeof object !== 'function')) return String(object);
        let id = this.ids.get(object);
        if (!id) { id = String(++this.serial); this.ids.set(object, id); }
        return id;
    }

    private path(node: any): string {
        const parts: string[] = [];
        let current = node;
        while (current && parts.length < 40) { parts.unshift(short(current.name || '(unnamed)', 80)); current = current.parent; }
        return parts.join('/').slice(0, 2048);
    }

    private destroyed(value: any): boolean {
        return !!value && typeof value === 'object' && 'isValid' in value && !isValid(value, true);
    }

    private record(id: string, kind: ObjectKind, label: string, ref: any, details?: string, path?: string, stack?: string): void {
        label = label.slice(0, 2048);
        details = details?.slice(0, 2048);
        path = path?.slice(0, 2048);
        stack = stack?.slice(0, 16384);
        if (this.inScan) this.observed.add(id);
        let entry = this.entries.get(id);
        const time = this.now();
        if (!entry) {
            if (this.entries.size >= this.config.maxObjects) {
                const oldest = this.entries.keys().next().value;
                if (oldest !== undefined) this.entries.delete(oldest);
                this.overflow = true;
                this.onDrop();
            }
            entry = { value: { id, kind, label, createdAt: time, lastSeenAt: time, details, path, stack }, ref: weak(ref) };
            this.entries.set(id, entry);
        } else {
            Object.assign(entry.value, { label, lastSeenAt: time, details, path });
            if (stack && !entry.value.stack) entry.value.stack = stack;
        }
    }

    private stack(): string | undefined { return this.config.captureStacks ? new Error().stack?.split('\n').slice(3, 15).join('\n') : undefined; }

    private listenerId(emitter: any, type: string | number, callback: any, target: any, capture: boolean): string {
        let typeKey = String(type);
        if (typeKey.length > 200) {
            let hash = 2166136261;
            for (let i = 0; i < typeKey.length; i++) hash = Math.imul(hash ^ typeKey.charCodeAt(i), 16777619);
            typeKey = `${typeKey.slice(0, 100)}#${(hash >>> 0).toString(16)}:${typeKey.length}`;
        }
        return `listener:${this.identity(emitter)}:${typeKey}:${this.identity(callback)}:${this.identity(target)}:${capture}`;
    }

    private watchEmitter(emitter: any): void {
        const ref = weak(emitter);
        if (!ref) return;
        const id = this.identity(emitter);
        if (!this.emitters.has(id) && this.emitters.size >= this.config.maxObjects) {
            const oldest = this.emitters.keys().next().value;
            if (oldest !== undefined) this.emitters.delete(oldest);
            this.overflow = true; this.onDrop();
        }
        this.emitters.set(id, ref);
    }

    /** Discover an Eventify-derived/custom event bus that predates profiler startup. */
    trackEventTarget(emitter: object): void { if (this.enabled) this.watchEmitter(emitter); }
    ignoreCallback(callback: Function): void { this.ignoredCallbacks.add(callback); }

    install(scope: HookScope): void {
        const tracker = this;
        for (const owner of [(EventTarget as any).prototype, Node.prototype]) {
            for (const key of ['on', 'once']) {
                scope.wrap(owner, key, original => function (this: any, ...args: any[]) {
                    if (!tracker.enabled) return original.apply(this, args);
                    const result = original.apply(this, args);
                    tracker.watchEmitter(this);
                    if (typeof args[1] === 'function' && !tracker.ignoredCallbacks.has(args[1])) {
                        const isNode = this instanceof Node;
                        const capture = isNode && !!args[3];
                        const id = tracker.listenerId(this, args[0], args[1], args[2], capture);
                        tracker.record(id, 'listener', `${this.name || this.constructor?.name || 'EventTarget'}:${String(args[0])}`,
                            this, 'Observed registration; reconciled against live callback tables at sampling.',
                            args[2] instanceof Component ? tracker.path(args[2].node) : args[2] instanceof Node ? tracker.path(args[2]) : undefined,
                            tracker.stack());
                    }
                    return result;
                });
            }
        }
        scope.wrap(Tween.prototype, 'start', original => function (this: any, ...args: any[]) {
            if (!tracker.enabled) return original.apply(this, args);
            const result = original.apply(this, args);
            if (this._finalAction && this._target) {
                tracker.record(`tween:${tracker.identity(this._finalAction)}`, 'tween', `Tween → ${this._target.name || this._target.constructor?.name || 'Object'}`,
                    this._finalAction, 'Active action; lifecycle reconciled against ActionManager.', undefined, tracker.stack());
            }
            return result;
        });
    }

    private scanEmitter(emitter: any): number {
        if (this.destroyed(emitter)) return 0;
        const processor = emitter instanceof Node ? emitter.eventProcessor || (emitter as any)._eventProcessor : undefined;
        const tables = processor
            ? [[processor.bubblingTarget?._callbackTable, false], [processor.capturingTarget?._callbackTable, true]] as const
            : [[emitter._callbackTable, false]] as const;
        let count = 0;
        for (const [table, capture] of tables) {
            if (!table || typeof table !== 'object') continue;
            if (this.scannedTables.has(table)) continue;
            this.scannedTables.add(table);
            this.eventTableSupported = true;
            for (const type of Object.keys(table)) {
                const infos = table[type]?.callbackInfos;
                if (!Array.isArray(infos)) continue;
                for (const info of infos) {
                    if (!info || typeof info.callback !== 'function' || this.ignoredCallbacks.has(info.callback)) continue;
                    const target = info.target;
                    const id = this.listenerId(emitter, type, info.callback, target, capture);
                    const targetDestroyed = this.destroyed(target);
                    const targetNode = target instanceof Component ? target.node : target instanceof Node ? target : undefined;
                    this.record(id, 'listener', `${emitter.name || emitter.constructor?.name || 'EventTarget'}:${type} → ${target?.name || target?.constructor?.name || '(no target)'}`,
                        emitter, `callback=${info.callback.name || '(anonymous)'}; once=${!!info.once}; capture=${capture}; targetDestroyed=${targetDestroyed}`,
                        targetNode ? this.path(targetNode) : undefined);
                    const entry = this.entries.get(id);
                    if (entry) entry.value.destroyed = targetDestroyed;
                    count++;
                }
            }
        }
        return count;
    }

    scan(): ObjectInventory {
        this.inScan = true;
        this.observed.clear();
        this.scannedTables.clear();
        const counts = { nodes: 0, components: 0, tweens: 0, listeners: 0 };
        const scene = director.getScene();
        const queue: Node[] = scene ? [scene] : [];
        // 3.8.x stores persistent roots here; normally they already belong to the current scene.
        const persistent = (director as any)._persistRootNodes;
        if (persistent && typeof persistent === 'object') queue.push(...Object.values(persistent) as Node[]);
        const visited = new Set<Node>();
        const scannedEmitters = new Set<any>();
        while (queue.length) {
            const node = queue.pop()!;
            if (!node || visited.has(node) || !isValid(node, true)) continue;
            visited.add(node);
            const path = this.path(node);
            const id = `node:${this.identity(node)}`;
            counts.nodes++;
            this.record(id, 'node', short(node.name || '(unnamed)', 150), node,
                `uuid=${node.uuid}; active=${node.activeInHierarchy}; persistent=${!!persistent?.[node.uuid]}`, path);
            const nodeEntry = this.entries.get(id);
            if (nodeEntry) nodeEntry.value.destroyed = false;
            for (const component of node.getComponents(Component)) {
                if (!isValid(component, true)) continue;
                counts.components++;
                const cid = `component:${this.identity(component)}`;
                this.record(cid, 'component', component.constructor.name, component, `enabled=${component.enabled}; node=${node.uuid}`, path);
                const entry = this.entries.get(cid);
                if (entry) entry.value.destroyed = false;
            }
            counts.listeners += this.scanEmitter(node);
            scannedEmitters.add(node);
            queue.push(...node.children);
        }
        for (const [id, ref] of this.emitters) {
            const emitter = ref.deref();
            if (!emitter || this.destroyed(emitter)) { this.emitters.delete(id); continue; }
            if (!scannedEmitters.has(emitter)) counts.listeners += this.scanEmitter(emitter);
        }
        const manager = (cc as any).TweenSystem?.instance?.ActionManager;
        const targets = manager?._hashTargets;
        this.tweenSupported = targets instanceof Map;
        if (this.tweenSupported) {
            targets.forEach((entry: any, target: any) => {
                if (!Array.isArray(entry.actions)) return;
                for (const action of entry.actions) {
                    if (!action) continue;
                    const id = `tween:${this.identity(action)}`;
                    const destroyed = this.destroyed(target);
                    this.record(id, 'tween', `Tween → ${target?.name || target?.constructor?.name || 'Object'}`, action,
                        `paused=${!!entry.paused}; targetDestroyed=${destroyed}`,
                        target instanceof Component ? this.path(target.node) : target instanceof Node ? this.path(target) : undefined);
                    const tracked = this.entries.get(id);
                    if (tracked) tracked.value.destroyed = destroyed;
                    counts.tweens++;
                }
            });
        }
        const objects: TrackedObject[] = [];
        for (const [id, entry] of this.entries) {
            const record = entry.value;
            if (this.observed.has(id)) { objects.push({ ...record }); continue; }
            if (record.kind === 'listener' || record.kind === 'tween') { this.entries.delete(id); continue; }
            const object = entry.ref?.deref();
            if (!object) { this.entries.delete(id); continue; }
            record.destroyed = this.destroyed(object);
            record.details = record.destroyed
                ? 'Destroyed engine object still observable via WeakRef. GC has not been forced; this alone is not proof of a leak.'
                : 'Previously observed object is outside the current scene tree. It may be intentionally pooled or retained.';
            objects.push({ ...record });
        }
        this.inScan = false;
        this.scannedTables.clear();
        return { counts, objects, truncated: this.overflow };
    }

    capabilities(): Capability[] {
        return [
            { name: 'scene-objects', available: true, detail: 'Current scene and persistent roots, including inactive nodes/components. Detached objects are observable only after first scene observation.' },
            { name: 'weak-object-retention', available: typeof (globalThis as any).WeakRef === 'function', detail: 'WeakRef observation is a leak clue, not a retaining path or GC proof. Without WeakRef, detached/destroyed retention and global event-bus lifetime cannot be tracked.' },
            { name: 'event-listeners', available: this.eventTableSupported, detail: '3.8.x callback tables: current Nodes and EventTarget.on/once observed since startup; once/off/targetOff/removeAll are reconciled from actual tables. Custom Eventify buses can call trackEventTarget(). No DOM/custom-emitter coverage.' },
            { name: 'active-tweens', available: this.tweenSupported, detail: '3.8.x ActionManager._hashTargets inventory. Includes existing actions; completed/stopped actions are removed at next sample. Private-field compatibility is checked.' },
        ];
    }

    dispose(): void { this.enabled = false; this.entries.clear(); this.emitters.clear(); this.observed.clear(); this.scannedTables.clear(); this.ids = new WeakMap(); this.ignoredCallbacks = new WeakSet(); }
}
