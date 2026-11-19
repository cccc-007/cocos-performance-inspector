import { director, Director, sys } from 'cc';
import * as cc from 'cc';
import { analyzeReport } from '../src/core/analyzer';
import { Capability, InspectorConfig, InspectorReport, normalizeConfig, ResourceEvent, Sample, Snapshot } from '../src/shared/model';
import { clock, HookScope } from './hooks';
import { ObjectTracker } from './objects';
import { ResourceTracker } from './resources';
import { requestJSON, requestJSONBody } from './transport';
import { fitReportToBudget } from './reportBudget';
import { IncrementalStreamSender, StreamSource } from './streamSender';

export interface InspectorOptions extends Partial<InspectorConfig> {
    /** Base URL from the editor panel, e.g. http://127.0.0.1:12345. Empty enables offline mode. */
    endpoint?: string;
    token?: string;
    transportIntervalMs?: number;
}

/** Debug-only singleton. Call stop() to remove every installed hook and timer. */
export class PerformanceInspector {
    static current: PerformanceInspector | undefined;
    static start(options: InspectorOptions = {}): PerformanceInspector {
        if (PerformanceInspector.current) return PerformanceInspector.current;
        const inspector = new PerformanceInspector(options);
        PerformanceInspector.current = inspector;
        inspector.begin();
        return inspector;
    }

    readonly config: InspectorConfig;
    private readonly started = clock();
    private readonly startedAt = new Date().toISOString();
    private readonly id = `cpi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    private readonly hooks = new HookScope();
    private readonly objects: ObjectTracker;
    private readonly resources: ResourceTracker;
    private readonly samples: Sample[] = [];
    private readonly snapshots: Snapshot[] = [];
    private readonly events: ResourceEvent[] = [];
    private readonly dropped = { samples: 0, events: 0, objects: 0, snapshots: 0 };
    private readonly endpoint: string;
    private readonly token: string;
    private readonly transportIntervalMs: number;
    private running = false;
    private endedAt?: string;
    private sampleTimer?: ReturnType<typeof setInterval>;
    private transportTimer?: ReturnType<typeof setInterval>;
    private transportTask?: Promise<void>;
    private finalFlush = false;
    private transportResets = 0;
    private readonly sender = new IncrementalStreamSender(() => this.streamSource());
    private transportStatus = 'Offline: endpoint not configured.';
    private frames: number[] = [];
    private frameCount = 0;
    private frameTotal = 0;
    private slowFrames = 0;
    private frameMax = 0;
    private lastFrame = 0;
    private snapshotSerial = 0;
    private finalCapabilities?: Capability[];
    private readonly onFrame = (): void => {
        const time = clock();
        if (typeof document !== 'undefined' && document.hidden) { this.lastFrame = 0; return; }
        if (this.lastFrame > 0) {
            const dt = Math.max(0, time - this.lastFrame);
            this.frameCount++;
            this.frameTotal += dt;
            this.frameMax = Math.max(this.frameMax, dt);
            if (dt > this.config.slowFrameMs) this.slowFrames++;
            if (this.frames.length < 6000) this.frames.push(dt);
        }
        this.lastFrame = time;
    };

    private constructor(options: InspectorOptions) {
        this.config = normalizeConfig(options);
        // 10 snapshots × (10000 objects + 10000 asset details) stays under the importer's aggregate record limit.
        this.config.maxObjects = Math.min(10000, this.config.maxObjects);
        this.endpoint = (options.endpoint || '').trim().replace(/\/+$/, '');
        this.token = options.token || '';
        this.transportIntervalMs = Math.max(2000, options.transportIntervalMs || 3000);
        this.objects = new ObjectTracker(this.config, () => this.elapsed(), () => this.dropped.objects++);
        this.resources = new ResourceTracker(this.config, () => this.elapsed(), event => this.pushEvent(event));
    }

    private elapsed(): number { return Math.max(0, clock() - this.started); }
    private scene(): string { return String(director.getScene()?.name || '(no scene)').slice(0, 2048); }

    private begin(): void {
        this.running = true;
        this.objects.install(this.hooks);
        this.resources.install(this.hooks);
        this.objects.trackEventTarget(director);
        this.objects.ignoreCallback(this.onFrame);
        director.on(Director.EVENT_AFTER_DRAW, this.onFrame);
        this.captureSnapshot('开始采集 / baseline');
        this.sampleTimer = setInterval(() => this.sample(), this.config.sampleIntervalMs);
        if (this.endpoint) {
            this.transportStatus = 'Awaiting first connection.';
            this.transportTimer = setInterval(() => { void this.tickTransport(); }, this.transportIntervalMs);
            void this.tickTransport();
        }
    }

    private pushEvent(event: ResourceEvent): void {
        if (!this.running) return;
        if (this.events.length >= this.config.maxEvents) { this.events.shift(); this.dropped.events++; }
        this.events.push(event);
    }

    private metrics(): { heapBytes: number | null; drawCalls: number | null; textureBytes: number | null; bufferBytes: number | null } {
        const finite = (value: any): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
        const device = (director as any).root?.device;
        return {
            heapBytes: finite(typeof performance !== 'undefined' ? (performance as any).memory?.usedJSHeapSize : undefined),
            drawCalls: finite(device?.numDrawCalls), textureBytes: finite(device?.memoryStatus?.textureSize), bufferBytes: finite(device?.memoryStatus?.bufferSize),
        };
    }

    private sample(): void {
        if (!this.running) return;
        const objects = this.objects.scan();
        const assets = this.resources.inventory(0);
        const sorted = this.frames.slice().sort((a, b) => a - b);
        const sample: Sample = {
            time: this.elapsed(), scene: this.scene(), ...objects.counts, assets: assets.count, ...this.metrics(),
            fps: this.frameTotal > 0 ? this.frameCount * 1000 / this.frameTotal : 0,
            frameMs: this.frameCount > 0 ? this.frameTotal / this.frameCount : 0,
            p95Ms: sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * .95) - 1)] : 0,
            maxFrameMs: this.frameMax, slowFrames: this.slowFrames,
        };
        if (this.samples.length >= this.config.maxSamples) { this.samples.shift(); this.dropped.samples++; }
        this.samples.push(sample);
        this.frames = []; this.frameCount = 0; this.frameTotal = 0; this.slowFrames = 0; this.frameMax = 0;
    }

    private captureSnapshot(label: string): Snapshot {
        if (!this.running) throw new Error('Inspector is stopped. Start a new session before capturing snapshots.');
        const inventory = this.objects.scan();
        const assets = this.resources.inventory(this.config.maxObjects);
        const snapshot: Snapshot = {
            id: `${this.id}-snapshot-${++this.snapshotSerial}`, label: String(label).slice(0, 200), time: this.elapsed(), scene: this.scene(),
            counts: { ...inventory.counts, assets: assets.count }, objects: inventory.objects, assets: assets.assets,
            truncated: inventory.truncated || assets.truncated,
        };
        if (this.snapshots.length >= 10) { this.snapshots.shift(); this.dropped.snapshots++; }
        this.snapshots.push(snapshot);
        return snapshot;
    }

    snapshot(label = '手动快照'): Snapshot {
        return JSON.parse(JSON.stringify(this.captureSnapshot(label))) as Snapshot;
    }

    mark(label: string): Snapshot { return this.snapshot(label); }
    trackEventTarget(emitter: object): void { this.objects.trackEventTarget(emitter); }

    private capabilities(): Capability[] {
        const metrics = this.metrics();
        return [
            ...this.objects.capabilities(),
            { name: 'js-heap', available: metrics.heapBytes !== null, detail: 'Chromium performance.memory usedJSHeapSize when available. Shared/isolate JS heap estimate; unavailable on most native/mobile runtimes. Native RSS and GC retaining paths are not measured.' },
            { name: 'gpu-counters', available: metrics.drawCalls !== null, detail: 'Current engine device drawCalls and memoryStatus textureSize/bufferSize. Engine allocation counters, not total GPU process memory.' },
            this.resources.capability(),
            { name: 'editor-transport', available: !!this.endpoint && this.transportStatus === 'Connected', detail: this.transportStatus },
            { name: 'bounded-recording', available: true, detail: `Samples ≤ ${this.config.maxSamples}; resource events ≤ ${this.config.maxEvents}; object records ≤ ${this.config.maxObjects}; snapshots ≤ 10. Call stacks are ${this.config.captureStacks ? 'enabled' : 'disabled'}. Frame percentiles use up to 6000 frames per interval. Observer adds scan/hook/serialization overhead.` },
        ];
    }

    getReport(): InspectorReport {
        const report: InspectorReport = {
            schemaVersion: 1,
            session: { id: this.id, startedAt: this.startedAt, endedAt: this.endedAt || new Date().toISOString(),
                engine: String((cc as any).VERSION || (cc as any).ENGINE_VERSION || 'Cocos Creator 3.8.x'), platform: String(sys.platform) },
            config: { ...this.config }, samples: this.samples, snapshots: this.snapshots, resourceEvents: this.events,
            findings: [], capabilities: this.finalCapabilities || this.capabilities(), dropped: { ...this.dropped },
        };
        report.findings = analyzeReport(report);
        // Returning plain detached data prevents callers from altering the collector buffers.
        return fitReportToBudget(report);
    }

    private streamSource(): StreamSource {
        return {
            session: { id: this.id, startedAt: this.startedAt, endedAt: this.endedAt || new Date().toISOString(),
                engine: String((cc as any).VERSION || (cc as any).ENGINE_VERSION || 'Cocos Creator 3.8.x'), platform: String(sys.platform) },
            config: this.config, samples: this.samples, snapshots: this.snapshots, resourceEvents: this.events,
            capabilities: this.finalCapabilities || this.capabilities(), dropped: this.dropped,
        };
    }

    /** Flush a bounded batch of new records. Complete offline reports are assembled only on demand. */
    async sendReport(): Promise<void> {
        if (!this.endpoint) throw new Error('Inspector endpoint is empty; export getReport() for offline import.');
        return this.startTransport(false);
    }

    private async tickTransport(): Promise<void> {
        if (!this.running) return;
        try { await this.startTransport(true); }
        catch { /* Transport status is exposed through capabilities; the next tick retries the same packet. */ }
    }

    private startTransport(pollCommands: boolean): Promise<void> {
        if (this.transportTask) return this.transportTask;
        const task = this.transportCycle(pollCommands);
        this.transportTask = task;
        void task.finally(() => { if (this.transportTask === task) this.transportTask = undefined; }).catch(() => {});
        return task;
    }

    private async flushPackets(limit: number, heartbeat = false): Promise<void> {
        for (let count = 0; count < limit; count++) {
            const prepared = this.sender.nextPacket(heartbeat && count === 0);
            if (!prepared) return;
            const ack = await requestJSONBody(`${this.endpoint}/stream`, this.token, prepared.body);
            if (this.sender.acknowledge(ack)) this.transportStatus = 'Connected';
            else if (++this.transportResets >= 2) throw new Error('Inspector receiver repeatedly requested a stream reset.');
        }
    }

    private async transportCycle(pollCommands: boolean): Promise<void> {
        this.transportResets = 0;
        try {
            await this.flushPackets(3, true);
            if (this.running && pollCommands) {
                const response = await requestJSON(`${this.endpoint}/commands?session=${encodeURIComponent(this.id)}`, this.token);
                if (this.running && Array.isArray(response?.commands)) for (const command of response.commands.slice(0, 10)) {
                    if (command?.type === 'snapshot') this.captureSnapshot(String(command.label || '编辑器快照'));
                }
            }
            await this.flushPackets(1);
            // stop() may run while a request is in flight. It joins this same task and never
            // starts a competing final upload. Yield between batches; keep no packet queue.
            while (this.finalFlush && this.sender.hasPendingData()) {
                await new Promise<void>(resolve => setTimeout(resolve, 0));
                await this.flushPackets(4);
            }
            // If stop occurred after the last packet was prepared, publish the final endedAt.
            if (this.finalFlush) await this.flushPackets(1, true);
        } catch (error: any) {
            this.transportStatus = String(error?.message || error); throw error;
        } finally { if (!this.running) this.finalFlush = false; }
    }

    /** Browser download. In JSB use getReport() plus the project's own file I/O, or sendReport(). */
    downloadReport(filename = `performance-${this.id}.json`): void {
        if (typeof document === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
            throw new Error('Browser download unavailable. Use getReport() or sendReport().');
        }
        const url = URL.createObjectURL(new Blob([JSON.stringify(this.getReport())], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url; link.download = filename; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    stop(): void {
        if (!this.running) return;
        this.sample();
        this.captureSnapshot('停止采集 / final');
        this.finalCapabilities = this.capabilities();
        this.running = false;
        this.endedAt = new Date().toISOString();
        if (this.sampleTimer !== undefined) clearInterval(this.sampleTimer);
        if (this.transportTimer !== undefined) clearInterval(this.transportTimer);
        director.off(Director.EVENT_AFTER_DRAW, this.onFrame);
        this.resources.dispose();
        this.hooks.dispose();
        this.objects.dispose();
        this.frames = [];
        if (PerformanceInspector.current === this) PerformanceInspector.current = undefined;
        if (this.endpoint) {
            this.finalFlush = true;
            void this.startTransport(false).catch(() => { /* Bounded offline buffers remain available through getReport(). */ });
        }
    }
}
