import { InspectorReport, ResourceEvent, Sample, Snapshot } from './model';

export interface PanelCursor { sessionId?: string; revision?: number; sampleOffset?: number; }
export interface SnapshotSummary extends Omit<Snapshot, 'objects' | 'assets'> { objectCount: number; assetCount: number; }
export interface PanelReport extends Omit<InspectorReport, 'samples' | 'snapshots' | 'resourceEvents'> {
    samples: Sample[];
    samplesStart: number;
    samplesNext: number;
    samplesReset: boolean;
    sampleCount: number;
    snapshots: SnapshotSummary[];
    resourceEventCount: number;
    resourceRevision: number;
}
export interface ResourcePage { start: number; next: number; end: number; reset: boolean; total: number; events: ResourceEvent[]; }
