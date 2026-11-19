export type ObjectKind = 'node' | 'component' | 'tween' | 'listener';
export interface Counts { nodes: number; components: number; assets: number; tweens: number; listeners: number; }
export interface Sample extends Counts {
    time: number; scene: string; fps: number; frameMs: number; p95Ms: number; maxFrameMs: number;
    slowFrames: number; heapBytes: number | null; drawCalls: number | null;
    textureBytes: number | null; bufferBytes: number | null;
}
export interface TrackedObject {
    id: string; kind: ObjectKind; label: string; path?: string; createdAt: number;
    lastSeenAt: number; destroyed?: boolean; stack?: string; details?: string;
}
export interface AssetRecord { id: string; name: string; type: string; refCount: number; }
export interface Snapshot {
    id: string; label: string; time: number; scene: string; counts: Counts;
    objects: TrackedObject[]; assets: AssetRecord[]; truncated: boolean;
}
export interface ResourceEvent {
    time: number; operation: 'load' | 'release' | 'addRef' | 'decRef' | 'error';
    key: string; type?: string; durationMs?: number; refCount?: number; stack?: string; details?: string;
}
export interface Finding {
    id: string; severity: 'info' | 'warning' | 'critical'; category: 'performance' | 'memory' | 'resource' | 'object';
    title: string; evidence: string; suggestion: string; objectIds?: string[];
}
export interface InspectorConfig {
    sampleIntervalMs: number; maxSamples: number; maxEvents: number; maxObjects: number;
    lowFps: number; slowFrameMs: number; memoryWindow: number; memoryGrowthMB: number;
    memorySlopeMBPerMin: number; captureStacks: boolean; staleObjectMs: number;
}
export const DEFAULT_CONFIG: InspectorConfig = {
    sampleIntervalMs: 1000, maxSamples: 1800, maxEvents: 2000, maxObjects: 10000,
    lowFps: 45, slowFrameMs: 50, memoryWindow: 30, memoryGrowthMB: 8,
    memorySlopeMBPerMin: 2, captureStacks: false, staleObjectMs: 30000,
};
export interface Capability { name: string; available: boolean; detail: string; }
export interface InspectorReport {
    schemaVersion: 1;
    session: { id: string; startedAt: string; endedAt: string; engine: string; platform: string; };
    config: InspectorConfig; samples: Sample[]; snapshots: Snapshot[]; resourceEvents: ResourceEvent[];
    findings: Finding[]; capabilities: Capability[];
    dropped: { samples: number; events: number; objects: number; snapshots: number; };
}
export function normalizeConfig(input: Partial<InspectorConfig> = {}): InspectorConfig {
    const value = { ...DEFAULT_CONFIG };
    for (const key of Object.keys(DEFAULT_CONFIG) as (keyof InspectorConfig)[]) {
        const candidate = input[key];
        if (key === 'captureStacks') { value.captureStacks = candidate === true; }
        else if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
            (value as any)[key] = candidate;
        }
    }
    value.sampleIntervalMs = Math.max(250, value.sampleIntervalMs);
    for (const key of ['maxSamples', 'maxEvents', 'maxObjects', 'memoryWindow'] as const) {
        value[key] = Math.min(100000, Math.max(key === 'memoryWindow' ? 5 : 10, Math.floor(value[key])));
    }
    return value;
}
