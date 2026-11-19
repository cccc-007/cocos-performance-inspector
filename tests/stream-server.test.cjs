const { test } = require('node:test');
const assert = require('node:assert/strict');
const { InspectorServer } = require('../dist/src/editor/server');
const { DEFAULT_CONFIG } = require('../dist/src/shared/model');
const { STREAM_MAX_BYTES, STREAM_MAX_RECORDS } = require('../dist/src/shared/stream');

function sample(index) {
    return { time: index * 1000, scene: 'game', fps: 60, frameMs: 16.7, p95Ms: 17, maxFrameMs: 18, slowFrames: 0,
        heapBytes: 1000000, drawCalls: 10, textureBytes: 2000000, bufferBytes: 10000,
        nodes: 2, components: 3, assets: 4, tweens: 0, listeners: 1 };
}
function event(index) { return { time: index, operation: 'load', key: 'asset-' + index }; }
function object(id) { return { id, kind: 'node', label: id, createdAt: 0, lastSeenAt: 0 }; }
function asset(id) { return { id, name: id, type: 'Texture', refCount: 1 }; }
function chunk(index = 0, extra = {}) {
    return { index, id: 'snapshot-' + index, label: 'test', scene: 'game', time: index * 1000,
        counts: { nodes: 2, components: 3, assets: 4, tweens: 0, listeners: 1 }, truncated: false,
        objectTotal: 0, assetTotal: 0, objectOffset: 0, assetOffset: 0, objects: [], assets: [], ...extra };
}
function packet(sequence = 1, extra = {}) {
    return { protocolVersion: 1, streamId: 'stream-a', sequence,
        session: { id: 'game-a', startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:01:00Z', engine: '3.8.3', platform: 'test' },
        config: { ...DEFAULT_CONFIG }, capabilities: [], dropped: { samples: 0, events: 0, objects: 0, snapshots: 0 },
        samples: { start: 0, values: [] }, resourceEvents: { start: 0, values: [] }, ...extra };
}
function post(server, value) {
    return fetch(server.endpoint + '/stream', { method: 'POST', headers: { 'X-Inspector-Token': server.token, 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
}

test('stream uploads acknowledge retry once, merge overlapping absolute ranges, and request reset for missing sequences', async t => {
    const server = new InspectorServer(); await server.start(); t.after(() => server.stop());
    const first = packet(1, { samples: { start: 0, values: [sample(0), sample(1)] }, resourceEvents: { start: 0, values: [event(0)] } });
    assert.deepEqual(await (await post(server, first)).json(), { ok: true, streamId: 'stream-a', sequence: 1 });
    const revision = server.state().revision;
    assert.deepEqual(await (await post(server, first)).json(), { ok: true, streamId: 'stream-a', sequence: 1 });
    assert.equal(server.state().revision, revision);
    assert.equal(server.getReport().samples.length, 2);
    assert.equal(server.getReport().resourceEvents.length, 1);
    const second = packet(2, { samples: { start: 1, values: [sample(1), sample(2)] }, resourceEvents: { start: 0, values: [event(0), event(1)] } });
    assert.equal(server.ingestStream(second).ok, true);
    assert.deepEqual(server.getReport().samples.map(s => s.time), [0, 1000, 2000]);
    assert.deepEqual(server.getReport().resourceEvents.map(e => e.key), ['asset-0', 'asset-1']);
    assert.deepEqual(server.ingestStream(packet(4)), { ok: false, reset: true });
    assert.equal(server.state().revision, revision + 1);
    const empty = new InspectorServer();
    assert.deepEqual(empty.ingestStream(packet(2)), { ok: false, reset: true });
    assert.equal(empty.state().sessions.length, 0);
});

test('invalid packets do not commit samples, snapshots, metadata, or sequence', () => {
    const server = new InspectorServer();
    server.ingestStream(packet(1, { samples: { start: 0, values: [sample(0)] }, snapshot: chunk(0, { objectTotal: 2, objects: [object('one')] }) }));
    const revision = server.state().revision;
    const second = packet(2, { samples: { start: 1, values: [sample(1)] }, snapshot: chunk(0, { objectTotal: 2, objectOffset: 1, objects: [object('one')] }) });
    assert.throws(() => server.ingestStream(second), /ID/);
    assert.equal(server.state().revision, revision);
    assert.equal(server.getReport().samples.length, 1);
    assert.equal(server.getReport().snapshots.length, 0);
    second.snapshot.objects = [object('two')];
    assert.equal(server.ingestStream(second).ok, true);
    assert.deepEqual(server.getSnapshot('snapshot-0').objects.map(o => o.id), ['one', 'two']);
    const third = packet(3, { samples: { start: 2, values: [sample(0)] } });
    assert.throws(() => server.ingestStream(third), /时间/);
    third.samples.values = [sample(2)];
    assert.equal(server.ingestStream(third).ok, true);
    const changed = packet(4); changed.config.maxSamples = 10;
    assert.throws(() => server.ingestStream(changed), /元数据/);
    assert.equal(server.getReport().config.maxSamples, DEFAULT_CONFIG.maxSamples);
});

test('snapshots remain private while partial, publish once, and can skip an evicted partial', () => {
    const server = new InspectorServer();
    const first = packet(1, { snapshot: chunk(2, { objectTotal: 2, assetTotal: 1, objects: [object('old')] }) });
    server.ingestStream(first);
    assert.equal(server.getReport().snapshots.length, 0);
    assert.deepEqual(server.state().report.snapshots, []);
    assert.throws(() => server.getSnapshot('snapshot-2'), /不存在/);
    const badOffset = packet(2, { snapshot: chunk(2, { objectTotal: 2, assetTotal: 1, objectOffset: 0, objects: [object('bad')] }) });
    assert.throws(() => server.ingestStream(badOffset), /偏移/);
    const replacement = packet(2, { snapshot: chunk(5, { objectTotal: 1, assetTotal: 1, objects: [object('new')] }) });
    server.ingestStream(replacement);
    const last = packet(3, { snapshot: chunk(5, { objectTotal: 1, assetTotal: 1, objectOffset: 1, assets: [asset('texture')] }) });
    server.ingestStream(last); server.ingestStream(last);
    assert.equal(server.getReport().snapshots.length, 1);
    assert.deepEqual(server.getSnapshot('snapshot-5').objects.map(o => o.id), ['new']);
    const summary = server.state().report.snapshots[0];
    assert.equal(summary.objectCount, 1); assert.equal(summary.assetCount, 1);
    assert.equal('objects' in summary, false); assert.equal('assets' in summary, false);
    assert.throws(() => server.ingestStream(packet(4, { snapshot: chunk(4) })), /乱序/);
});

test('new stream sequence one replaces retained data and partial state, preserving selection and rejecting retired streams', () => {
    const server = new InspectorServer();
    const first = packet(1, { samples: { start: 0, values: [sample(0)] }, snapshot: chunk(0, { objectTotal: 2, objects: [object('old')] }) });
    server.ingestStream(first);
    const revision = server.state().revision;
    const oldCursor = { sessionId: 'game-a', revision, sampleOffset: 0 };
    const reset = packet(1, { streamId: 'stream-b', samples: { start: 0, values: [sample(10)] }, snapshot: chunk(3, { objects: [object('new')], objectTotal: 1 }) });
    server.ingestStream(reset);
    assert.equal(server.state().selected, 'game-a');
    assert.equal(server.state().revision, revision + 1);
    assert.equal(server.state(oldCursor).report.samplesReset, true);
    assert.deepEqual(server.getReport().samples.map(s => s.time), [10000]);
    assert.deepEqual(server.getReport().snapshots.map(s => s.id), ['snapshot-3']);
    assert.deepEqual(server.ingestStream(first), { ok: false, reset: true });
    assert.equal(server.getReport().samples.length, 1);
    server.clear();
    assert.deepEqual(server.ingestStream(packet(2, { streamId: 'stream-b' })), { ok: false, reset: true });
});

test('server bounds retained records and sessions, and exposes absolute resource pages after gaps', () => {
    const server = new InspectorServer();
    const config = { ...DEFAULT_CONFIG, maxSamples: 10, maxEvents: 10 };
    server.ingestStream(packet(1, { config, samples: { start: 0, values: Array.from({ length: 20 }, (_, i) => sample(i)) },
        resourceEvents: { start: 0, values: Array.from({ length: 20 }, (_, i) => event(i)) }, snapshot: chunk(0) }));
    for (let sequence = 2; sequence <= 12; sequence++) server.ingestStream(packet(sequence, { config,
        samples: { start: 20, values: [] }, resourceEvents: { start: 20, values: [] }, snapshot: chunk(sequence - 1) }));
    assert.equal(server.getReport().samples.length, 10);
    assert.equal(server.getReport().resourceEvents.length, 10);
    assert.equal(server.getReport().snapshots.length, 10);
    assert.equal(server.getReport().snapshots[0].id, 'snapshot-2');
    const page = server.getResourceEvents(0);
    assert.equal(page.start, 10); assert.equal(page.next, 20); assert.equal(page.end, 20); assert.equal(page.reset, true);
    server.ingestStream(packet(13, { config, samples: { start: 40, values: [sample(40)] }, resourceEvents: { start: 45, values: [event(45)] } }));
    assert.deepEqual(server.getReport().samples.map(s => s.time), [40000]);
    assert.equal(server.getResourceEvents(20).start, 45);
    assert.equal(server.getResourceEvents(20).reset, true);
    for (let i = 0; i < 8; i++) server.ingestStream(packet(1, { streamId: 'stream-' + i, session: { ...packet().session, id: 'session-' + i } }));
    assert.equal(server.state().sessions.length, 5);
    assert.ok(server.state().sessions.some(s => s.id === server.state().selected));
});

test('panel polls send only new trend records, omit unchanged reports, and never include resource or snapshot detail', () => {
    const server = new InspectorServer();
    for (let sequence = 1; sequence <= 3; sequence++) server.ingestStream(packet(sequence, {
        samples: { start: (sequence - 1) * 120, values: Array.from({ length: 120 }, (_, i) => sample((sequence - 1) * 120 + i)) },
        resourceEvents: { start: (sequence - 1) * 120, values: Array.from({ length: 120 }, (_, i) => event((sequence - 1) * 120 + i)) } }));
    const state = server.state();
    assert.equal(state.report.samples.length, 240);
    assert.equal(state.report.samplesStart, 120);
    assert.equal(state.report.samplesNext, 360);
    assert.equal(state.report.sampleCount, 360);
    assert.equal(state.report.samplesReset, true);
    assert.equal('resourceEvents' in state.report, false);
    const cursor = { sessionId: state.selected, revision: state.revision, sampleOffset: state.report.samplesNext };
    assert.equal('report' in server.state(cursor), false);
    server.ingestStream(packet(4, { samples: { start: 360, values: [sample(360)] }, resourceEvents: { start: 360, values: [] } }));
    const delta = server.state(cursor);
    assert.equal(delta.report.samplesReset, false); assert.equal(delta.report.samples.length, 1);
    assert.equal(delta.report.samplesStart, 360); assert.equal(delta.report.samplesNext, 361);
    assert.equal(delta.report.resourceRevision, state.report.resourceRevision);
    const first = server.getResourceEvents();
    assert.equal(first.events.length, 256); assert.equal(first.next, 256); assert.equal(first.end, 360);
    const second = server.getResourceEvents(first.next);
    assert.equal(second.reset, false); assert.equal(second.events.length, 104); assert.equal(second.next, 360);
    assert.equal(server.state({ sessionId: 'other', sampleOffset: 360 }).report.samplesReset, true);
});

test('cached analysis runs once per data revision and heartbeat polls do not scan history again', () => {
    const analyzer = require('../dist/src/core/analyzer');
    const analyze = analyzer.analyzeReport; let calls = 0;
    analyzer.analyzeReport = value => { calls++; return analyze(value); };
    try {
        const server = new InspectorServer();
        server.ingestStream(packet(1, { samples: { start: 0, values: [sample(0)] } }));
        assert.equal(calls, 0);
        const state = server.state(); assert.equal(calls, 1);
        server.state(); server.getReport(); server.state({ sessionId: state.selected, revision: state.revision });
        assert.equal(calls, 1);
        server.ingestStream(packet(2, { samples: { start: 1, values: [] } }));
        server.state(); assert.equal(calls, 1);
        server.ingestStream(packet(3, { samples: { start: 1, values: [sample(1)] } }));
        server.state(); assert.equal(calls, 2);
    } finally { analyzer.analyzeReport = analyze; }
});

test('stream rejects oversized HTTP packets and excessive or malformed fresh records without retaining a session', async t => {
    const server = new InspectorServer(); await server.start(); t.after(() => server.stop());
    const response = await fetch(server.endpoint + '/stream', { method: 'POST', headers: { 'X-Inspector-Token': server.token }, body: 'x'.repeat(STREAM_MAX_BYTES + 1) });
    assert.equal(response.status, 413);
    assert.equal(server.state().sessions.length, 0);
    assert.throws(() => server.ingestStream(packet(1, { samples: { start: 0, values: Array.from({ length: STREAM_MAX_RECORDS + 1 }, (_, i) => sample(i)) } })));
    assert.throws(() => server.ingestStream(packet(1, { snapshot: chunk(0, { objectTotal: 10001, objects: [object('x')] }) })));
    assert.throws(() => server.ingestStream(packet(1, { snapshot: chunk(0, { objectTotal: 1 }) })));
    assert.throws(() => server.ingestStream(packet(1, { resourceEvents: { start: -1, values: [] } })));
    assert.equal(server.state().sessions.length, 0);
});
