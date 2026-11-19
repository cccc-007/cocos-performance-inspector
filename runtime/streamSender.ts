import { InspectorReport } from '../src/shared/model';
import { SnapshotChunk, StreamAck, StreamPacket, STREAM_MAX_BYTES, STREAM_MAX_RECORDS, STREAM_VERSION } from '../src/shared/stream';
import { utf8Bytes } from '../src/core/reportBudget';

export type StreamSource = Pick<InspectorReport, 'session' | 'config' | 'capabilities' | 'dropped' | 'samples' | 'resourceEvents' | 'snapshots'>;
export interface PreparedPacket { packet: StreamPacket; body: string; }
interface Cursor { samples: number; events: number; snapshot: number; objects: number; assets: number; }

/** A single bounded pending packet, with cursors committed only after its exact ACK. */
export class IncrementalStreamSender {
    private streamId = this.newStreamId();
    private sequence = 1;
    private cursor?: Cursor;
    private pending?: PreparedPacket & { after: Cursor };

    constructor(private readonly source: () => StreamSource) {}

    private newStreamId(): string { return `stream-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`; }

    private available(source: StreamSource): Cursor {
        const cursor = this.cursor || { samples: source.dropped.samples, events: source.dropped.events,
            snapshot: source.dropped.snapshots, objects: 0, assets: 0 };
        return { samples: Math.max(cursor.samples, source.dropped.samples), events: Math.max(cursor.events, source.dropped.events),
            snapshot: Math.max(cursor.snapshot, source.dropped.snapshots),
            objects: cursor.snapshot < source.dropped.snapshots ? 0 : cursor.objects,
            assets: cursor.snapshot < source.dropped.snapshots ? 0 : cursor.assets };
    }

    hasPendingData(): boolean {
        if (this.pending) return true;
        const source = this.source();
        const cursor = this.available(source);
        return cursor.samples < source.dropped.samples + source.samples.length ||
            cursor.events < source.dropped.events + source.resourceEvents.length ||
            cursor.snapshot < source.dropped.snapshots + source.snapshots.length;
    }

    nextPacket(forceMetadata = false): PreparedPacket | undefined {
        if (this.pending) return this.pending;
        const source = this.source();
        const before = this.available(source);
        const after = { ...before };
        const snapshot = source.snapshots[before.snapshot - source.dropped.snapshots];
        const chunk: SnapshotChunk | undefined = snapshot && {
            id: snapshot.id, label: snapshot.label, time: snapshot.time, scene: snapshot.scene,
            counts: { ...snapshot.counts }, truncated: snapshot.truncated, index: before.snapshot,
            objectOffset: before.objects, assetOffset: before.assets,
            objectTotal: snapshot.objects.length, assetTotal: snapshot.assets.length, objects: [], assets: [],
        };
        const packet: StreamPacket = {
            protocolVersion: STREAM_VERSION, streamId: this.streamId, sequence: this.sequence,
            session: { ...source.session }, config: { ...source.config }, capabilities: source.capabilities.map(value => ({ ...value })),
            dropped: { ...source.dropped }, samples: { start: before.samples, values: [] },
            resourceEvents: { start: before.events, values: [] }, ...(chunk ? { snapshot: chunk } : {}),
        };
        let bytes = utf8Bytes(JSON.stringify(packet));
        if (bytes > STREAM_MAX_BYTES) throw new Error('Inspector stream metadata exceeds the packet limit.');
        const sampleOffset = before.samples - source.dropped.samples;
        const eventOffset = before.events - source.dropped.events;
        const firstSample = source.samples[sampleOffset];
        const firstEvent = source.resourceEvents[eventOffset];
        const firstSampleBytes = firstSample ? utf8Bytes(JSON.stringify(firstSample)) : 0;
        const firstEventBytes = firstEvent ? utf8Bytes(JSON.stringify(firstEvent)) : 0;
        // A share is a fairness target, not a per-record limit. Isolate a large record so
        // new samples or snapshot metadata cannot indefinitely prevent it from fitting.
        const isolated = firstSampleBytes > 64 * 1024 ? 'sample' : firstEventBytes > 64 * 1024 ? 'event' : undefined;
        if (isolated) {
            delete packet.snapshot;
            bytes = utf8Bytes(JSON.stringify(packet));
            const cost = isolated === 'sample' ? firstSampleBytes : firstEventBytes;
            if (bytes + cost > STREAM_MAX_BYTES) throw new Error('Inspector stream record exceeds the packet limit.');
            if (isolated === 'sample') { packet.samples.values.push(firstSample); after.samples++; }
            else { packet.resourceEvents.values.push(firstEvent); after.events++; }
            const body = JSON.stringify(packet);
            this.pending = { packet, body, after };
            return this.pending;
        }
        // Measure each record once, rather than repeatedly serializing an ever-growing packet.
        const append = <T>(target: T[], values: T[], offset: number, limit = STREAM_MAX_RECORDS, ceiling = STREAM_MAX_BYTES): number => {
            let count = 0;
            while (count < limit && offset + count < values.length) {
                const value = values[offset + count];
                const measured = value === firstSample ? firstSampleBytes : value === firstEvent ? firstEventBytes : utf8Bytes(JSON.stringify(value));
                const cost = measured + (target.length ? 1 : 0);
                if (bytes + cost > ceiling) break;
                target.push(value); bytes += cost; count++;
            }
            return count;
        };
        // Reserve bounded shares for live samples/events before snapshot details. Large snapshots
        // continue across packets without starving the live chart or queuing the entire snapshot.
        after.samples += append(packet.samples.values, source.samples, sampleOffset,
            STREAM_MAX_RECORDS, Math.min(STREAM_MAX_BYTES, bytes + 64 * 1024));
        after.events += append(packet.resourceEvents.values, source.resourceEvents, eventOffset,
            STREAM_MAX_RECORDS, Math.min(STREAM_MAX_BYTES, bytes + 64 * 1024));
        if (chunk && snapshot) {
            after.objects += append(chunk.objects, snapshot.objects, before.objects);
            after.assets += append(chunk.assets, snapshot.assets, before.assets, STREAM_MAX_RECORDS - chunk.objects.length);
            if (after.objects === snapshot.objects.length && after.assets === snapshot.assets.length) {
                after.snapshot++; after.objects = 0; after.assets = 0;
            } else if (!chunk.objects.length && !chunk.assets.length) {
                if (packet.samples.values.length || packet.resourceEvents.values.length) delete packet.snapshot;
                else throw new Error('Inspector snapshot record exceeds the packet limit.');
            }
        }
        const progressed = after.samples !== before.samples || after.events !== before.events ||
            after.snapshot !== before.snapshot || after.objects !== before.objects || after.assets !== before.assets;
        if (!progressed) {
            const waiting = before.samples < source.dropped.samples + source.samples.length ||
                before.events < source.dropped.events + source.resourceEvents.length || !!snapshot;
            if (waiting) throw new Error('Inspector pending record could not fit within the packet limit.');
            if (!forceMetadata) return undefined;
        }
        const body = JSON.stringify(packet);
        if (utf8Bytes(body) > STREAM_MAX_BYTES) throw new Error('Inspector stream packet exceeds the packet limit.');
        this.pending = { packet, body, after };
        return this.pending;
    }

    /** A receiver restart replays only the collector's current bounded history in a fresh stream. */
    acknowledge(ack: StreamAck): boolean {
        if (ack?.ok === false && ack.reset === true) {
            this.pending = undefined; this.cursor = undefined; this.sequence = 1; this.streamId = this.newStreamId();
            return false;
        }
        if (!this.pending || ack?.ok !== true || ack.streamId !== this.pending.packet.streamId || ack.sequence !== this.pending.packet.sequence) {
            throw new Error('Inspector stream ACK does not match the pending packet.');
        }
        this.cursor = this.pending.after; this.sequence++; this.pending = undefined;
        return true;
    }
}
