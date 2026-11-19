import { AssetRecord, Capability, Counts, InspectorConfig, InspectorReport, normalizeConfig, ResourceEvent, Sample, Snapshot, TrackedObject } from '../shared/model';
import { analyzeReport } from './analyzer';
import { SnapshotChunk, StreamPacket, STREAM_MAX_RECORDS, STREAM_MAX_SNAPSHOT_DETAILS, STREAM_VERSION } from '../shared/stream';

const fail = (path: string, message: string): never => { throw new Error(`报告格式错误：${path} ${message}`); };
function object(value: unknown, path: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail(path, '必须为对象');
    return value as Record<string, unknown>;
}
function string(value: unknown, path: string, max = 2048): string {
    if (typeof value !== 'string' || value.length > max) return fail(path, `必须为不超过 ${max} 字符的字符串`);
    return value;
}
function number(value: unknown, path: string, integer = false): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e15 || (integer && !Number.isInteger(value))) return fail(path, '必须为有限的非负数字');
    return value;
}
function boolean(value: unknown, path: string): boolean {
    if (typeof value !== 'boolean') return fail(path, '必须为布尔值');
    return value;
}
function array(value: unknown, path: string, max: number): unknown[] {
    if (!Array.isArray(value) || value.length > max) return fail(path, `必须为不超过 ${max} 项的数组`);
    return value;
}
function nullable(value: unknown, path: string): number | null { return value === null ? null : number(value, path); }
function counts(value: unknown, path: string): Counts {
    const item = object(value, path);
    return Object.fromEntries(['nodes', 'components', 'assets', 'tweens', 'listeners'].map(k => [k, number(item[k], `${path}.${k}`, true)])) as unknown as Counts;
}
function tracked(value: unknown, path: string): TrackedObject {
    const item = object(value, path);
    if (!['node', 'component', 'tween', 'listener'].includes(item.kind as string)) fail(`${path}.kind`, '无效');
    const result: TrackedObject = {
        id: string(item.id, `${path}.id`, 512), kind: item.kind as TrackedObject['kind'], label: string(item.label, `${path}.label`),
        createdAt: number(item.createdAt, `${path}.createdAt`), lastSeenAt: number(item.lastSeenAt, `${path}.lastSeenAt`),
    };
    if (item.path !== undefined) result.path = string(item.path, `${path}.path`);
    if (item.stack !== undefined) result.stack = string(item.stack, `${path}.stack`, 16384);
    if (item.details !== undefined) result.details = string(item.details, `${path}.details`, 8192);
    if (item.destroyed !== undefined) result.destroyed = boolean(item.destroyed, `${path}.destroyed`);
    return result;
}
function asset(value: unknown, path: string): AssetRecord {
    const item = object(value, path);
    return { id: string(item.id, `${path}.id`, 512), name: string(item.name, `${path}.name`), type: string(item.type, `${path}.type`, 512), refCount: number(item.refCount, `${path}.refCount`, true) };
}
function uniqueIds(items: { id: string }[], path: string): void {
    const ids = new Set<string>();
    for (const item of items) {
        if (!item.id || ids.has(item.id)) fail(path, '含空 ID 或重复 ID');
        ids.add(item.id);
    }
}
function ordered(items: { time: number }[], path: string): void {
    for (let i = 1; i < items.length; i++) if (items[i].time < items[i - 1].time) fail(path, '时间必须递增或相等');
}

/** Rebuild a strict data-only report. Imported findings are always recomputed. */
export function validateReport(input: unknown, analyze = true): InspectorReport {
    const root = object(input, 'root');
    if (root.schemaVersion !== 1) fail('schemaVersion', '仅支持版本 1');
    const session = object(root.session, 'session');
    const startedAt = string(session.startedAt, 'session.startedAt', 64);
    const endedAt = string(session.endedAt, 'session.endedAt', 64);
    if (!Number.isFinite(Date.parse(startedAt)) || !Number.isFinite(Date.parse(endedAt)) || Date.parse(endedAt) < Date.parse(startedAt)) fail('session', '开始/结束时间无效');
    const rawConfig = object(root.config, 'config');
    const checkedConfig: Partial<InspectorConfig> = {};
    for (const key of ['sampleIntervalMs', 'maxSamples', 'maxEvents', 'maxObjects', 'lowFps', 'slowFrameMs', 'memoryWindow', 'memoryGrowthMB', 'memorySlopeMBPerMin', 'staleObjectMs'] as const) {
        const value = number(rawConfig[key], `config.${key}`);
        if (value <= 0) fail(`config.${key}`, '必须大于零');
        checkedConfig[key] = value;
    }
    checkedConfig.captureStacks = boolean(rawConfig.captureStacks, 'config.captureStacks');
    const config = normalizeConfig(checkedConfig);
    const samples = array(root.samples, 'samples', 100000).map((value, i): Sample => {
        const p = `samples[${i}]`, item = object(value, p);
        return { ...counts(item, p), time: number(item.time, `${p}.time`), scene: string(item.scene, `${p}.scene`),
            fps: number(item.fps, `${p}.fps`), frameMs: number(item.frameMs, `${p}.frameMs`), p95Ms: number(item.p95Ms, `${p}.p95Ms`),
            maxFrameMs: number(item.maxFrameMs, `${p}.maxFrameMs`), slowFrames: number(item.slowFrames, `${p}.slowFrames`, true),
            heapBytes: nullable(item.heapBytes, `${p}.heapBytes`), drawCalls: nullable(item.drawCalls, `${p}.drawCalls`),
            textureBytes: nullable(item.textureBytes, `${p}.textureBytes`), bufferBytes: nullable(item.bufferBytes, `${p}.bufferBytes`) };
    });
    let totalDetails = 0;
    const snapshots = array(root.snapshots, 'snapshots', 60).map((value, i): Snapshot => {
        const p = `snapshots[${i}]`, item = object(value, p);
        const objects = array(item.objects, `${p}.objects`, 100000).map((v, j) => tracked(v, `${p}.objects[${j}]`));
        const assets = array(item.assets, `${p}.assets`, 100000).map((v, j) => asset(v, `${p}.assets[${j}]`));
        totalDetails += objects.length + assets.length;
        if (totalDetails > 300000) fail('snapshots', '对象及资源明细总量超过 300000');
        uniqueIds(objects, `${p}.objects`); uniqueIds(assets, `${p}.assets`);
        return { id: string(item.id, `${p}.id`, 512), label: string(item.label, `${p}.label`), time: number(item.time, `${p}.time`),
            scene: string(item.scene, `${p}.scene`), counts: counts(item.counts, `${p}.counts`), objects, assets, truncated: boolean(item.truncated, `${p}.truncated`) };
    });
    const resourceEvents = array(root.resourceEvents, 'resourceEvents', 100000).map((value, i): ResourceEvent => {
        const p = `resourceEvents[${i}]`, item = object(value, p);
        if (!['load', 'release', 'addRef', 'decRef', 'error'].includes(item.operation as string)) fail(`${p}.operation`, '无效');
        const event: ResourceEvent = { time: number(item.time, `${p}.time`), operation: item.operation as ResourceEvent['operation'], key: string(item.key, `${p}.key`, 8192) };
        if (item.type !== undefined) event.type = string(item.type, `${p}.type`, 512);
        if (item.durationMs !== undefined) event.durationMs = number(item.durationMs, `${p}.durationMs`);
        if (item.refCount !== undefined) event.refCount = number(item.refCount, `${p}.refCount`, true);
        if (item.stack !== undefined) event.stack = string(item.stack, `${p}.stack`, 16384);
        if (item.details !== undefined) event.details = string(item.details, `${p}.details`, 8192);
        return event;
    });
    const capabilities = array(root.capabilities, 'capabilities', 64).map((value, i): Capability => {
        const p = `capabilities[${i}]`, item = object(value, p);
        return { name: string(item.name, `${p}.name`, 512), available: boolean(item.available, `${p}.available`), detail: string(item.detail, `${p}.detail`, 8192) };
    });
    const dropped = object(root.dropped, 'dropped');
    const report: InspectorReport = {
        schemaVersion: 1, session: { id: string(session.id, 'session.id', 512), startedAt, endedAt,
            engine: string(session.engine, 'session.engine', 512), platform: string(session.platform, 'session.platform', 512) },
        config, samples, snapshots, resourceEvents, capabilities, findings: [],
        dropped: { samples: number(dropped.samples, 'dropped.samples', true), events: number(dropped.events, 'dropped.events', true),
            objects: number(dropped.objects, 'dropped.objects', true), snapshots: number(dropped.snapshots, 'dropped.snapshots', true) },
    };
    ordered(samples, 'samples'); ordered(snapshots, 'snapshots'); uniqueIds(snapshots, 'snapshots');
    // Resource callbacks may finish out of request order; their supplied event times
    // are not required to be ordered. Event order is not used to infer allocation.
    if (analyze) report.findings = analyzeReport(report);
    return report;
}

/** Validate and copy only the new records, never the accumulated live history. */
export function validateStreamPacket(input: unknown): StreamPacket {
    const root = object(input, 'packet');
    if (root.protocolVersion !== STREAM_VERSION) fail('protocolVersion', 'unsupported protocol');
    const streamId = string(root.streamId, 'streamId', 512);
    if (!streamId) fail('streamId', 'must not be empty');
    const sequence = number(root.sequence, 'sequence', true);
    if (sequence < 1) fail('sequence', 'must be positive');
    const samples = object(root.samples, 'samples');
    const events = object(root.resourceEvents, 'resourceEvents');
    const sampleStart = number(samples.start, 'samples.start', true);
    const eventStart = number(events.start, 'resourceEvents.start', true);
    array(samples.values, 'samples.values', STREAM_MAX_RECORDS);
    array(events.values, 'resourceEvents.values', STREAM_MAX_RECORDS);
    let rawSnapshot: Record<string, unknown> | undefined;
    if (root.snapshot !== undefined) {
        rawSnapshot = object(root.snapshot, 'snapshot');
        const objectTotal = number(rawSnapshot.objectTotal, 'snapshot.objectTotal', true);
        const assetTotal = number(rawSnapshot.assetTotal, 'snapshot.assetTotal', true);
        if (objectTotal > STREAM_MAX_SNAPSHOT_DETAILS || assetTotal > STREAM_MAX_SNAPSHOT_DETAILS) fail('snapshot', 'too many details');
        const objectOffset = number(rawSnapshot.objectOffset, 'snapshot.objectOffset', true);
        const assetOffset = number(rawSnapshot.assetOffset, 'snapshot.assetOffset', true);
        const objects = array(rawSnapshot.objects, 'snapshot.objects', STREAM_MAX_RECORDS);
        const assets = array(rawSnapshot.assets, 'snapshot.assets', STREAM_MAX_RECORDS);
        if (objects.length + assets.length > STREAM_MAX_RECORDS) fail('snapshot', 'chunk has too many details');
        if (objectOffset + objects.length > objectTotal || assetOffset + assets.length > assetTotal) fail('snapshot', 'chunk exceeds declared totals');
        if (!objects.length && !assets.length && (objectOffset !== objectTotal || assetOffset !== assetTotal)) fail('snapshot', 'chunk makes no progress');
        number(rawSnapshot.index, 'snapshot.index', true);
    }
    const report = validateReport({ schemaVersion: 1, session: root.session, config: root.config,
        samples: samples.values, resourceEvents: events.values, snapshots: rawSnapshot ? [rawSnapshot] : [],
        capabilities: root.capabilities, dropped: root.dropped }, false);
    if (!report.session.id) fail('session.id', 'must not be empty');
    let snapshot: SnapshotChunk | undefined;
    if (rawSnapshot) {
        snapshot = { ...report.snapshots[0], index: rawSnapshot.index as number,
            objectOffset: rawSnapshot.objectOffset as number, assetOffset: rawSnapshot.assetOffset as number,
            objectTotal: rawSnapshot.objectTotal as number, assetTotal: rawSnapshot.assetTotal as number };
        if (!snapshot.id) fail('snapshot.id', 'must not be empty');
    }
    return { protocolVersion: 1, streamId, sequence, session: report.session, config: report.config,
        capabilities: report.capabilities, dropped: report.dropped,
        samples: { start: sampleStart, values: report.samples }, resourceEvents: { start: eventStart, values: report.resourceEvents },
        ...(snapshot ? { snapshot } : {}) };
}
