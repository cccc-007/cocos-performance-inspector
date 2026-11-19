export type ObjectKind = 'node' | 'component' | 'tween' | 'listener';
export interface Counts {
    nodes: number;
    components: number;
    assets: number;
    tweens: number;
    listeners: number;
}
export interface Sample extends Counts {
    time: number;
    scene: string;
    fps: number;
    frameMs: number;
    p95Ms: number;
    maxFrameMs: number;
    slowFrames: number;
    heapBytes: number | null;
    drawCalls: number | null;
    textureBytes: number | null;
    bufferBytes: number | null;
}
export interface TrackedObject {
    id: string;
    kind: ObjectKind;
    label: string;
    path?: string;
    createdAt: number;
    lastSeenAt: number;
    destroyed?: boolean;
    stack?: string;
    details?: string;
}
export interface AssetRecord {
    id: string;
    name: string;
    type: string;
    refCount: number;
}
export interface Snapshot {
    id: string;
    label: string;
    time: number;
    scene: string;
    counts: Counts;
    objects: TrackedObject[];
    assets: AssetRecord[];
    truncated: boolean;
}
export interface ResourceEvent {
    time: number;
    operation: 'load' | 'release' | 'addRef' | 'decRef' | 'error';
    key: string;
    type?: string;
    durationMs?: number;
    refCount?: number;
    stack?: string;
    details?: string;
}
export interface Finding {
    id: string;
    severity: 'info' | 'warning' | 'critical';
    category: 'performance' | 'memory' | 'resource' | 'object';
    title: string;
    evidence: string;
    suggestion: string;
    objectIds?: string[];
}
export interface InspectorConfig {
    sampleIntervalMs: number;
    maxSamples: number;
    maxEvents: number;
    maxObjects: number;
    lowFps: number;
    slowFrameMs: number;
    memoryWindow: number;
    memoryGrowthMB: number;
    memorySlopeMBPerMin: number;
    captureStacks: boolean;
    staleObjectMs: number;
}
export declare const DEFAULT_CONFIG: InspectorConfig;
export interface Capability {
    name: string;
    available: boolean;
    detail: string;
}
export interface InspectorReport {
    schemaVersion: 1;
    session: {
        id: string;
        startedAt: string;
        endedAt: string;
        engine: string;
        platform: string;
    };
    config: InspectorConfig;
    samples: Sample[];
    snapshots: Snapshot[];
    resourceEvents: ResourceEvent[];
    findings: Finding[];
    capabilities: Capability[];
    dropped: {
        samples: number;
        events: number;
        objects: number;
        snapshots: number;
    };
}
export declare function normalizeConfig(input?: Partial<InspectorConfig>): InspectorConfig;
