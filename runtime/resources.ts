import { Asset, assetManager, AssetManager } from 'cc';
import { AssetRecord, Capability, InspectorConfig, ResourceEvent } from '../src/shared/model';
import { clock, HookScope, short } from './hooks';

/** Capture public API requests/completions. A release request does not imply memory has been reclaimed. */
export class ResourceTracker {
    private loadDepth = 0;
    private releaseDepth = 0;
    private enabled = true;
    private coverage: string[] = [];
    private missing: string[] = [];
    constructor(private config: InspectorConfig, private now: () => number, private emit: (event: ResourceEvent) => void) {}

    private stack(): string | undefined { return this.config.captureStacks ? new Error().stack?.split('\n').slice(3, 15).join('\n').slice(0, 16384) : undefined; }
    private key(value: any): string { return short(value?.uuid || value?._uuid || value?.name || value); }

    private load(scope: HookScope, owner: any, method: string, mode: 'any' | 'simple' | 'bundle'): boolean {
        const tracker = this;
        return scope.wrap(owner, method, original => function (this: any, ...args: any[]) {
            if (!tracker.enabled) return original.apply(this, args);
            if (tracker.loadDepth) return original.apply(this, args);
            const started = clock();
            const trace = tracker.stack();
            let options = args[1];
            let progress = args[2];
            let callback = args[3];
            if (mode === 'simple') {
                callback = typeof args[1] === 'function' ? args[1] : args[2];
                options = typeof args[1] === 'function' ? null : args[1];
            } else if (callback === undefined) {
                const isType = mode === 'bundle' && typeof options === 'function' && (options === Asset || options.prototype instanceof Asset);
                const callbackAtSecond = mode === 'any' ? typeof options === 'function' : !isType;
                if (progress) { callback = progress; if (!callbackAtSecond) progress = null; }
                else if (progress === undefined && callbackAtSecond) { callback = options; options = null; progress = null; }
                if (args[2] !== undefined && callbackAtSecond) { progress = args[1]; options = null; }
            }
            const originalCallback = typeof callback === 'function' ? callback : undefined;
            const bundleName = mode === 'bundle' ? this.name : options?.bundle;
            const key = `${bundleName ? `${bundleName}:` : ''}${tracker.key(args[0])}`;
            let completed = false;
            const completion = function (this: any, error: any, result: any, ...rest: any[]) {
                if (!completed && tracker.enabled) {
                    completed = true;
                    tracker.emit({ time: tracker.now(), operation: error ? 'error' : 'load', key,
                        type: method, durationMs: clock() - started, stack: trace,
                        details: error ? short(error?.message || error) : `Completed ${method}; result=${Array.isArray(result) ? `${result.length} assets` : tracker.key(result)}` });
                }
                return originalCallback?.apply(this, [error, result, ...rest]);
            };
            const normalized = mode === 'simple' ? [args[0], options, completion] : [args[0], options, progress, completion];
            tracker.loadDepth++;
            try { return original.apply(this, normalized); }
            catch (error: any) {
                if (tracker.enabled && !completed) tracker.emit({ time: tracker.now(), operation: 'error', key, type: method,
                    durationMs: clock() - started, stack: trace, details: short(error?.message || error) });
                throw error;
            } finally { tracker.loadDepth--; }
        });
    }

    private release(scope: HookScope, owner: any, method: string): boolean {
        const tracker = this;
        return scope.wrap(owner, method, original => function (this: any, ...args: any[]) {
            if (!tracker.enabled) return original.apply(this, args);
            if (tracker.releaseDepth) return original.apply(this, args);
            const key = method.includes('All') || method === 'releaseUnusedAssets' ? `${this.name || 'assetManager'}:*` : tracker.key(args[0]);
            const stack = tracker.stack();
            tracker.releaseDepth++;
            try {
                const result = original.apply(this, args);
                if (tracker.enabled) tracker.emit({ time: tracker.now(), operation: 'release', key, type: method,
                    stack, details: 'Release API requested. Check subsequent asset cache/refCount snapshots; this does not prove CPU/GPU/JS memory reclamation.' });
                return result;
            } finally { tracker.releaseDepth--; }
        });
    }

    install(scope: HookScope): void {
        const observed = (name: string, success: boolean) => (success ? this.coverage : this.missing).push(name);
        observed('assetManager.loadAny', this.load(scope, assetManager, 'loadAny', 'any'));
        observed('assetManager.loadRemote', this.load(scope, assetManager, 'loadRemote', 'simple'));
        observed('assetManager.loadBundle', this.load(scope, assetManager, 'loadBundle', 'simple'));
        const bundle = (AssetManager as any).Bundle?.prototype;
        observed('Bundle.load', this.load(scope, bundle, 'load', 'bundle'));
        observed('Bundle.loadDir', this.load(scope, bundle, 'loadDir', 'bundle'));
        for (const key of ['releaseAsset', 'releaseAll', 'releaseUnusedAssets']) observed(`assetManager.${key}`, this.release(scope, assetManager, key));
        for (const key of ['release', 'releaseAll', 'releaseUnusedAssets']) observed(`Bundle.${key}`, this.release(scope, bundle, key));
        const tracker = this;
        for (const method of ['addRef', 'decRef'] as const) {
            observed(`Asset.${method}`, scope.wrap(Asset.prototype, method, original => function (this: Asset, ...args: any[]) {
                if (!tracker.enabled) return original.apply(this, args);
                const stack = tracker.stack();
                const key = tracker.key(this);
                const result = original.apply(this, args);
                if (tracker.enabled) tracker.emit({ time: tracker.now(), operation: method, key, type: this.constructor.name,
                    refCount: this.refCount, stack, details: `${method} invocation observed; refCount=${this.refCount}` });
                return result;
            }));
        }
    }

    capability(): Capability {
        return { name: 'resource-lifecycle', available: this.coverage.length > 0,
            detail: `Observed after startup: ${this.coverage.join(', ') || 'none'}. Missing/unpatchable APIs: ${this.missing.join(', ') || 'none'}. Nested load/release calls are deduplicated. Release events are API requests, not proof of reclamation.` };
    }

    inventory(limit: number): { count: number; assets: AssetRecord[]; truncated: boolean } {
        const assets: AssetRecord[] = [];
        let count = 0;
        assetManager.assets.forEach((asset: Asset, id: string) => {
            count++;
            if (assets.length < limit) assets.push({ id: short(id), name: short(asset.name), type: asset.constructor.name, refCount: asset.refCount });
        });
        return { count, assets, truncated: count > limit };
    }

    dispose(): void { this.enabled = false; }
}
