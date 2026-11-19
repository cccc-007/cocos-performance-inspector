const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeReport, compareSnapshots } = require('../dist/src/core/analyzer.js');
const { renderHtmlReport } = require('../dist/src/core/report.js');
const { validateReport } = require('../dist/src/core/validation.js');
const { DEFAULT_CONFIG } = require('../dist/src/shared/model.js');

const counts = (patch = {}) => ({ nodes: 10, components: 15, assets: 4, tweens: 0, listeners: 0, ...patch });
const sample = (time, patch = {}) => ({ ...counts(), time, scene: 'Main', fps: 60, frameMs: 16.67, p95Ms: 18, maxFrameMs: 20, slowFrames: 0, heapBytes: null, drawCalls: null, textureBytes: null, bufferBytes: null, ...patch });
const object = (id, patch = {}) => ({ id, kind: 'node', label: id, path: `Main/${id}`, createdAt: 0, lastSeenAt: 2000, ...patch });
const snapshot = (id, time, objects, patch = {}) => ({ id, label: id, time, scene: 'Main', counts: counts({ nodes: objects.length }), objects, assets: [], truncated: false, ...patch });
const report = (patch = {}) => ({ schemaVersion: 1, session: { id: 'test', engine: '3.8.3', platform: 'web', startedAt: '2026-11-13T00:00:00.000Z', endedAt: '2026-11-13T00:01:00.000Z' }, config: { ...DEFAULT_CONFIG }, samples: [], snapshots: [], resourceEvents: [], findings: [], capabilities: [], dropped: { samples: 0, events: 0, objects: 0, snapshots: 0 }, ...patch });
const has = (r, id) => analyzeReport(r).some(f => f.id === id);
const memory = values => values.map((heap, i) => sample(i * 1000, { heapBytes: heap * 1048576 }));

test('sustained low FPS requires consecutive observations; a short dip is ignored', () => {
    assert.equal(has(report({ samples: [sample(0, { fps: 30 }), sample(1000, { fps: 30 })] }), 'performance-low-fps'), false);
    assert.equal(has(report({ samples: [sample(0, { fps: 30 }), sample(1000, { fps: 30 }), sample(2000, { fps: 30 })] }), 'performance-low-fps'), true);
    assert.equal(has(report({ samples: [sample(0, { fps: 30 }), sample(1000), sample(2000, { fps: 30 }), sample(3000, { fps: 30 })] }), 'performance-low-fps'), false);
});

test('long frame evidence is independent from interval average FPS', () => {
    const r = report({ samples: [sample(0, { fps: 59, maxFrameMs: 150, slowFrames: 2 })] });
    assert.equal(has(r, 'performance-frame-spikes'), true);
    assert.match(analyzeReport(r)[0].evidence, /150\.0 ms/);
});

test('memory growth needs sufficient time, absolute growth, slope and rising group medians', () => {
    const rising = report({ samples: memory(Array.from({ length: 30 }, (_, i) => 20 + i)) });
    assert.equal(has(rising, 'memory-sustained-growth'), true);
    const tooFast = report({ samples: rising.samples.map((s, i) => ({ ...s, time: i * 10 })) });
    assert.equal(has(tooFast, 'memory-sustained-growth'), false);
    const small = report({ samples: memory(Array.from({ length: 30 }, (_, i) => 20 + i / 100)) });
    assert.equal(has(small, 'memory-sustained-growth'), false);
    const incomplete = report({ samples: rising.samples.slice(0, 29) });
    assert.equal(has(incomplete, 'memory-sustained-growth'), false);
});

test('flat GC sawtooth, one-time step allocation, declining and unavailable memory do not trigger sustained growth', () => {
    for (const values of [Array.from({ length: 30 }, (_, i) => 20 + i % 5), Array.from({ length: 30 }, (_, i) => i < 15 ? 20 : 80), Array.from({ length: 30 }, (_, i) => 80 - i)]) {
        assert.equal(has(report({ samples: memory(values) }), 'memory-sustained-growth'), false);
    }
    assert.equal(has(report({ samples: Array.from({ length: 40 }, (_, i) => sample(i * 1000)) }), 'memory-sustained-growth'), false);
});

test('snapshot comparison uses stable IDs rather than names and discloses truncation', () => {
    const a = snapshot('a', 0, [object('1', { label: 'same' }), object('2')]);
    const b = snapshot('b', 1000, [object('3', { label: 'same' }), object('2')], { truncated: true });
    const diff = compareSnapshots(a, b);
    assert.deepEqual(diff.added.map(o => o.id), ['3']);
    assert.deepEqual(diff.removed.map(o => o.id), ['1']);
    assert.equal(diff.countDelta.nodes, 0);
    assert.equal(diff.incomplete, true);
});

test('same-scene object growth is informational and cross-scene differences are not flagged', () => {
    const before = snapshot('base', 0, [object('1')]);
    const after = snapshot('after', 2000, [object('1'), object('2')]);
    const finding = analyzeReport(report({ snapshots: [before, after] })).find(f => f.id === 'object-snapshot-growth');
    assert.equal(finding.severity, 'info');
    assert.deepEqual(finding.objectIds, ['2']);
    assert.equal(has(report({ snapshots: [before, { ...after, scene: 'Different' }] }), 'object-snapshot-growth'), false);
});

test('destroyed targets expose listener/tween IDs, excluding destroyed node records', () => {
    const r = report({ snapshots: [snapshot('a', 2000, [object('node', { destroyed: true }), object('listener', { kind: 'listener', destroyed: true }), object('tween', { kind: 'tween', destroyed: true })])] });
    const finding = analyzeReport(r).find(f => f.id === 'object-destroyed-target');
    assert.deepEqual(finding.objectIds, ['listener', 'tween']);
});

test('Node and Component weak-retention clues remain informational and include object paths', () => {
    const r = report({ snapshots: [snapshot('retained', 40000, [
        object('destroyed-node', { destroyed: true }),
        object('pooled-component', { kind: 'component', lastSeenAt: 0 }),
        object('recent-node', { lastSeenAt: 39999 }),
    ])] });
    const finding = analyzeReport(r).find(f => f.id === 'object-retained-engine-objects');
    assert.equal(finding.severity, 'info');
    assert.deepEqual(finding.objectIds, ['destroyed-node', 'pooled-component']);
    assert.match(finding.evidence, /Main\/destroyed-node/);
    assert.match(finding.suggestion, /不是泄漏证明/);
});

test('resource evidence reflects request errors/latency, not allocations or proved leaks', () => {
    const r = report({ resourceEvents: [{ time: 0, operation: 'load', key: 'prefab', durationMs: 800 }, { time: 1, operation: 'error', key: 'bad-url' }, { time: 2, operation: 'release', key: 'prefab' }] });
    assert.equal(has(r, 'resource-load-errors'), true);
    assert.equal(has(r, 'resource-slow-loads'), true);
    assert.equal(has(r, 'resource-cache-growth'), false);
});

test('strict importer rejects unsupported schema, NaN, missing metrics, inverted dates and oversized arrays', () => {
    assert.throws(() => validateReport({ ...report(), schemaVersion: 2 }), /版本/);
    assert.throws(() => validateReport(report({ samples: [sample(0, { fps: NaN })] })), /fps/);
    assert.throws(() => validateReport(report({ samples: [{ time: 0 }] })), /nodes/);
    assert.throws(() => validateReport(report({ session: { ...report().session, endedAt: '2020-01-01' } })), /时间/);
    assert.throws(() => validateReport(report({ snapshots: Array(61).fill(null) })), /60/);
    assert.throws(() => validateReport(report({ samples: Array(100001).fill(null) })), /100000/);
});

test('strict importer rejects duplicate IDs and unsorted sample time', () => {
    assert.throws(() => validateReport(report({ snapshots: [snapshot('a', 0, [object('1'), object('1')])] })), /重复 ID/);
    assert.throws(() => validateReport(report({ samples: [sample(1000), sample(0)] })), /时间/);
});

test('importer rebuilds data, ignores extra properties and recomputes findings', () => {
    const input = report({ samples: [sample(0, { maxFrameMs: 90 })], findings: [{ title: 'forged' }], dangerous: 'ignored' });
    const result = validateReport(input);
    assert.equal(result.dangerous, undefined);
    assert.equal(result.findings.some(f => f.title === 'forged'), false);
    assert.equal(result.findings[0].id, 'performance-frame-spikes');
    input.samples[0].fps = 10;
    assert.equal(result.samples[0].fps, 60);
});

test('HTML report escapes malicious names, paths, stacks and raw JSON and runs offline', () => {
    const attack = '</pre><script>alert("x")</script><img src=x onerror=alert(1)>';
    const r = report({ session: { ...report().session, id: attack }, snapshots: [snapshot('before', 0, []), snapshot('after', 2000, [object('1', { label: attack, path: attack, stack: attack })])], resourceEvents: [{ time: 100, operation: 'error', key: attack, details: attack, stack: attack }] });
    const html = renderHtmlReport(r);
    assert.ok(html.startsWith('<!doctype html>'));
    assert.ok(html.includes('&lt;script&gt;'));
    assert.equal(html.includes('<script'), false);
    assert.equal(html.includes('<img'), false);
    assert.equal(html.includes('src="http'), false);
    assert.ok(html.includes('Content-Security-Policy'));
    assert.ok(html.includes('原始报告数据'));
});

test('single-snapshot HTML still exposes object paths and registration stacks', () => {
    const html = renderHtmlReport(report({ snapshots: [snapshot('baseline', 1000, [object('widget', { path: 'Scene/Canvas/Widget', stack: 'registeredAt business.ts:20' })])] }));
    assert.ok(html.includes('最新快照对象明细'));
    assert.ok(html.includes('Scene/Canvas/Widget'));
    assert.ok(html.includes('registeredAt business.ts:20'));
});

test('unobserved frame intervals do not create 0 FPS diagnostics or summary averages', () => {
    const r = report({ samples: [sample(0), sample(1000, { fps: 0, frameMs: 0 }), sample(2000, { fps: 0, frameMs: 0 }), sample(3000, { fps: 0, frameMs: 0 })] });
    assert.equal(has(r, 'performance-low-fps'), false);
    assert.ok(renderHtmlReport(r).includes('60.0 <span class="unit">FPS'));
});
