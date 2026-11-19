import { AssetRecord, Capability, InspectorConfig, InspectorReport, ResourceEvent, Sample, Snapshot, TrackedObject } from './model';
/** Independent from the offline report schema: live packets carry only new records. */
export declare const STREAM_VERSION = 1;
export declare const STREAM_MAX_BYTES: number;
export declare const STREAM_MAX_RECORDS = 256;
export declare const STREAM_MAX_SNAPSHOT_DETAILS = 10000;
export interface StreamRange<T> {
    start: number;
    values: T[];
}
export interface SnapshotChunk extends Omit<Snapshot, 'objects' | 'assets'> {
    index: number;
    objectOffset: number;
    assetOffset: number;
    objectTotal: number;
    assetTotal: number;
    objects: TrackedObject[];
    assets: AssetRecord[];
}
export interface StreamPacket {
    protocolVersion: 1;
    streamId: string;
    sequence: number;
    session: InspectorReport['session'];
    config: InspectorConfig;
    capabilities: Capability[];
    dropped: InspectorReport['dropped'];
    samples: StreamRange<Sample>;
    resourceEvents: StreamRange<ResourceEvent>;
    snapshot?: SnapshotChunk;
}
export type StreamAck = {
    ok: true;
    streamId: string;
    sequence: number;
} | {
    ok: false;
    reset: true;
};
