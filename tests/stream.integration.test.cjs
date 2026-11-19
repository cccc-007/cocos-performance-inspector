const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename);
const { IncrementalStreamSender } = require('../runtime/streamSender.ts');
const { InspectorServer } = require('../dist/src/editor/server');
const { DEFAULT_CONFIG } = require('../dist/src/shared/model');
const { STREAM_MAX_BYTES } = require('../dist/src/shared/stream');
const { writeReport } = require('../dist/src/editor/storage');
const { fitReportToBudget } = require('../dist/src/core/reportBudget');

function fixture() {
    const startedAt = '2026-01-01T00:00:00.000Z';
    return {
        session: { id: 'large-incremental-integration', startedAt, endedAt: startedAt, engine: '3.8.3', platform: 'test' },
        config: { ...DEFAULT_CONFIG }, capabilities: [], dropped: { samples: 0, events: 0, objects: 0, snapshots: 0 },
        samples: [], resourceEvents: [], snapshots: [],
    };
}
function snapshot(index, time) {
    return {
        id: `snapshot-${index}`, label: `snapshot ${index}`, time, scene: 'scene', truncated: false,
        counts: { nodes: 600, components: 1200, listeners: 1800, assets: 300, tweens: 1 },
        objects: Array.from({ length: 1800 }, (_, i) => ({
            id: `object:${i}`, kind: 'listener', label: `icon-${i}:transform-changed`,
            path: 'scene/Canvas/TemporaryInterface/' + 'animation/icon/'.repeat(10),
            createdAt: 0, lastSeenAt: time, details: 'Callback: updateTransform; target=UITransform; targetDestroyed=false',
        })),
        assets: Array.from({ length: 300 }, (_, i) => ({ id: `asset-${i}`, name: `texture-${i}`, type: 'Texture2D', refCount: 1 })),
    };
}

test('large multi-snapshot streams survive lost ACKs and export the assembled retained report', t => {
    const source = fixture(), sender = new IncrementalStreamSender(() => source), server = new InspectorServer();
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-stream-export-'));
    t.after(() => { server.stop(); fs.rmSync(temporary, { recursive: true, force: true }); });
    const seen = new Set(); let lostAckTested = false, bytes = 0, packets = 0;
    const send = heartbeat => {
        const prepared = sender.nextPacket(heartbeat);
        if (!prepared) return false;
        assert.ok(Buffer.byteLength(prepared.body) <= STREAM_MAX_BYTES);
        bytes += Buffer.byteLength(prepared.body); packets++;
        const packet = JSON.parse(prepared.body);
        if (packet.snapshot) {
            for (const [kind, records] of [['object', packet.snapshot.objects], ['asset', packet.snapshot.assets]]) {
                for (const record of records) {
                    const key = `${packet.snapshot.id}:${kind}:${record.id}`;
                    assert.ok(!seen.has(key), `Already confirmed snapshot detail resent: ${key}`);
                    seen.add(key);
                }
            }
        }
        let ack = server.ingestStream(packet);
        if (!lostAckTested && packets === 5) {
            assert.equal(sender.nextPacket().body, prepared.body);
            ack = server.ingestStream(JSON.parse(prepared.body));
            lostAckTested = true;
        }
        assert.equal(sender.acknowledge(ack), true);
        return true;
    };
    for (let tick = 0; tick < 200; tick++) {
        source.session.endedAt = new Date(Date.parse(source.session.startedAt) + (tick + 1) * 3000).toISOString();
        for (let j = 0; j < 3; j++) source.samples.push({
            time: tick * 3000 + (j + 1) * 1000, scene: 'scene', fps: 60, frameMs: 1000 / 60,
            p95Ms: 17, maxFrameMs: 20, slowFrames: 0, heapBytes: 100000000, drawCalls: 100,
            textureBytes: 250000000, bufferBytes: 10000000, nodes: 600, components: 1200,
            listeners: 1800, assets: 300, tweens: 1,
        });
        for (let j = 0; j < 50; j++) source.resourceEvents.push({
            time: tick * 3000 + j, operation: j % 2 ? 'addRef' : 'decRef', key: `asset-${j}`, refCount: j % 2,
        });
        while (source.resourceEvents.length > source.config.maxEvents) { source.resourceEvents.shift(); source.dropped.events++; }
        if ([0, 20, 21, 22, 23, 24, 25, 26, 100].includes(tick)) source.snapshots.push(snapshot(source.snapshots.length, tick * 3000));
        for (let i = 0; i < 4; i++) if (!send(i === 0)) break;
    }
    for (let i = 0; sender.hasPendingData() && i < 1000; i++) send(false);
    assert.equal(sender.hasPendingData(), false);
    assert.equal(lostAckTested, true);
    assert.equal(seen.size, 9 * (1800 + 300));
    const report = server.getReport();
    assert.deepEqual(report.samples, source.samples);
    assert.deepEqual(report.resourceEvents, source.resourceEvents);
    assert.deepEqual(report.snapshots, source.snapshots);
    assert.deepEqual(report.dropped, source.dropped);
    assert.ok(bytes < Buffer.byteLength(JSON.stringify(report)) * 2, 'Historical snapshots should not dominate every poll');

    const state = server.state();
    assert.ok(state.report.samples.length <= 240);
    assert.equal(state.report.sampleCount, 600);
    assert.equal(state.report.resourceEvents, undefined);
    assert.equal(state.report.snapshots.length, 9);
    for (const summary of state.report.snapshots) {
        assert.equal(summary.objects, undefined); assert.equal(summary.assets, undefined);
    }
    const unchanged = server.state({ sessionId: state.selected, revision: state.revision, sampleOffset: state.report.samplesNext });
    assert.equal(Object.hasOwn(unchanged, 'report'), false);
    assert.deepEqual(server.getSnapshot('snapshot-8'), source.snapshots[8]);
    const events = []; let cursor = 0;
    for (let i = 0; i < 20; i++) {
        const page = server.getResourceEvents(cursor);
        events.push(...page.events); cursor = page.next;
        if (page.next === page.end) break;
    }
    assert.deepEqual(events, source.resourceEvents);

    const file = writeReport(temporary, report, 'json');
    assert.equal(path.dirname(file), path.join(temporary, 'extensions', 'cocos-performance-inspector', 'PITemp'));
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), fitReportToBudget(report));
});
