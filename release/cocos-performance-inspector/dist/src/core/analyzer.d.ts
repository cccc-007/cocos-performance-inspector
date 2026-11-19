import { Counts, Finding, InspectorReport, Snapshot, TrackedObject } from '../shared/model';
export interface SnapshotComparison {
    sameScene: boolean;
    incomplete: boolean;
    countDelta: Counts;
    added: TrackedObject[];
    removed: TrackedObject[];
    addedAssets: Snapshot['assets'];
    removedAssets: Snapshot['assets'];
}
/** Stable runtime IDs are compared; matching names do not imply matching objects. */
export declare function compareSnapshots(before: Snapshot, after: Snapshot): SnapshotComparison;
/** Heuristic diagnostics only: these observations do not establish GC reachability. */
export declare function analyzeReport(report: InspectorReport): Finding[];
