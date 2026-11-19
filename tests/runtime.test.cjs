const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');

// Execute the actual runtime TypeScript against a minimal 3.8-style engine contract.
// These tests exercise observer semantics; a real Creator preview smoke test is still required.
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
}).outputText, filename);

class EventBus {
    constructor() { this._callbackTable = Object.create(null); }
    on(type, callback, target, once) {
        const list = this._callbackTable[type] ||= { callbackInfos: [] };
        if (!list.callbackInfos.some(x => x.callback === callback && x.target === target)) list.callbackInfos.push({ callback, target, once: !!once });
        return callback;
    }
    once(type, callback, target) { return this.on(type, callback, target, true); }
    off(type, callback, target) {
        if (!callback) delete this._callbackTable[type];
        else if (this._callbackTable[type]) this._callbackTable[type].callbackInfos = this._callbackTable[type].callbackInfos.filter(x => x.callback !== callback || x.target !== target);
    }
    targetOff(target) { this.removeAll(target); }
    removeAll(target) {
        if (typeof target === 'string') delete this._callbackTable[target];
        else for (const list of Object.values(this._callbackTable)) list.callbackInfos = list.callbackInfos.filter(x => x.target !== target);
    }
    emit(type, ...args) {
        for (const info of [...this._callbackTable[type]?.callbackInfos || []]) {
            if (info.once) this.off(type, info.callback, info.target);
            info.callback.apply(info.target, args);
        }
    }
}
let nodeSerial = 0;
class Node {
    constructor(name = '') {
        this.name = name; this.uuid = `node-${++nodeSerial}`; this.parent = null; this.children = []; this.components = [];
        this.isValid = true; this.activeInHierarchy = true;
        this.eventProcessor = { bubblingTarget: new EventBus(), capturingTarget: new EventBus() };
    }
    getComponents() { return this.components; }
    addChild(node) { node.parent = this; this.children.push(node); }
    on(type, callback, target, capture = false) { this.eventProcessor[capture ? 'capturingTarget' : 'bubblingTarget'].on(type, callback, target); }
    once(type, callback, target, capture = false) { this.eventProcessor[capture ? 'capturingTarget' : 'bubblingTarget'].once(type, callback, target); }
    off(type, callback, target, capture = false) { this.eventProcessor[capture ? 'capturingTarget' : 'bubblingTarget'].off(type, callback, target); }
    targetOff(target) { for (const bus of Object.values(this.eventProcessor)) bus.targetOff(target); }
    emit(type, ...args) { this.eventProcessor.bubblingTarget.emit(type, ...args); }
    destroy() { this.isValid = false; for (const bus of Object.values(this.eventProcessor)) bus._callbackTable = Object.create(null); }
}
class Component { constructor(node) { this.node = node; this.enabled = true; this.isValid = true; } }
class Asset {
    constructor(name = 'test') { this.name = name; this.uuid = name; this.refCount = 0; }
    addRef() { this.refCount++; return this; }
    decRef() { this.refCount = Math.max(0, this.refCount - 1); return this; }
}
function parameters(options, progress, complete, bundle = false) {
    if (complete === undefined) {
        const isCallback = bundle ? !(typeof options === 'function' && (options === Asset || options.prototype instanceof Asset)) : typeof options === 'function';
        if (progress) { complete = progress; if (!isCallback) progress = null; }
        else if (progress === undefined && isCallback) { complete = options; options = null; progress = null; }
        if (arguments[1] !== undefined && isCallback) { progress = arguments[0]; options = null; }
    }
    return { options, progress, complete };
}
let lastLoad;
const manager = {
    assets: new Map(),
    loadAny(input, opts, progress, callback) {
        const normalized = parameters(opts, progress, callback);
        lastLoad = { input, ...normalized };
        normalized.progress?.(1, 1, {});
        const result = new Asset(String(input));
        manager.assets.set(result.uuid, result);
        normalized.complete?.(null, result);
    },
    loadRemote(url, opts, complete) { if (typeof opts === 'function') { complete = opts; opts = null; } return this.loadAny({ url }, opts, null, complete); },
    loadBundle(name, opts, complete) { if (typeof opts === 'function') { complete = opts; opts = null; } return this.loadAny({ url: name }, opts, null, complete); },
    releaseAsset(asset) { this.assets.delete(asset.uuid); },
    releaseAll() { this.assets.clear(); },
    releaseUnusedAssets() {},
};
class Bundle {
    constructor() { this.name = 'ui'; }
    load(input, type, progress, complete) { const n = parameters(type, progress, complete, true); return manager.loadAny(input, { bundle: this.name, type: n.options }, n.progress, n.complete); }
    loadDir(...args) { return this.load(...args); }
    release(asset) { manager.releaseAsset(asset); }
    releaseAll() { manager.releaseAll(); }
    releaseUnusedAssets() {}
}
const actions = new Map();
class Tween {
    constructor(target) { this._target = target; }
    start() { this._finalAction = {}; actions.set(this._target, { actions: [this._finalAction], paused: false }); return this; }
    stop() { actions.delete(this._target); return this; }
}
const director = new EventBus();
director.scene = new Node('scene');
director.getScene = () => director.scene;
director._persistRootNodes = {};
director.root = { device: { numDrawCalls: 5, memoryStatus: { textureSize: 1024, bufferSize: 512 } } };
const cc = {
    Node, Component, Asset, assetManager: manager, AssetManager: { Bundle }, EventTarget: EventBus, Tween,
    director, Director: { EVENT_AFTER_DRAW: 'after-draw' }, sys: { platform: 'test' },
    TweenSystem: { instance: { ActionManager: { _hashTargets: actions } } },
    isValid: value => !!value && value.isValid !== false,
};
const nativeLoad = Module._load;
Module._load = function (name, ...args) { if (name === 'cc') return cc; return nativeLoad.call(this, name, ...args); };
const { PerformanceInspector } = require('../runtime/PerformanceInspector.ts');
afterEach(() => {
    PerformanceInspector.current?.stop();
    manager.assets.clear(); actions.clear(); director.scene = new Node('scene'); director._persistRootNodes = {};
});

test('start/stop is idempotent, hooks restore exactly, returned reports are detached', () => {
    const originalOn = Node.prototype.on;
    const originalLoad = manager.loadAny;
    const inspector = PerformanceInspector.start();
    assert.equal(PerformanceInspector.start(), inspector);
    assert.notEqual(Node.prototype.on, originalOn);
    const report = inspector.getReport();
    report.snapshots[0].label = 'mutated';
    assert.notEqual(inspector.getReport().snapshots[0].label, 'mutated');
    inspector.stop(); inspector.stop();
    assert.equal(Node.prototype.on, originalOn);
    assert.equal(manager.loadAny, originalLoad);
    assert.equal(PerformanceInspector.current, undefined);
    assert.equal(inspector.getReport().snapshots.at(-1).label, '停止采集 / final');
});

test('Node capture/bubble, once, duplicate, off and targetOff keep their engine semantics', () => {
    const inspector = PerformanceInspector.start();
    const node = new Node('Button'); director.scene.addChild(node);
    const target = new Component(node); let calls = 0;
    function callback(value) { assert.equal(this, target); calls += value; }
    node.on('click', callback, target);
    node.on('click', callback, target);
    node.on('click', callback, target, true);
    node.once('once', callback, target);
    let snapshot = inspector.snapshot('registered');
    assert.equal(snapshot.counts.listeners, 3);
    assert.equal(snapshot.objects.filter(x => x.kind === 'listener' && x.label.startsWith('Button:')).length, 3);
    node.emit('once', 2); node.emit('once', 9);
    assert.equal(calls, 2);
    snapshot = inspector.snapshot('once fired');
    assert.equal(snapshot.counts.listeners, 2);
    assert.equal(snapshot.objects.filter(x => x.kind === 'listener' && x.label.startsWith('Button:')).length, 2);
    node.off('click', callback, target, true);
    node.targetOff(target);
    assert.equal(inspector.snapshot('removed').counts.listeners, 0);
});

test('EventTarget destroyed receiver yields a live listener clue, removeAll clears it', () => {
    const inspector = PerformanceInspector.start();
    const bus = new EventBus(); const target = new Component(director.scene);
    bus.on('data', () => {}, target);
    target.isValid = false;
    assert.ok(inspector.snapshot('destroyed').objects.some(x => x.kind === 'listener' && x.destroyed));
    bus.removeAll('data');
    assert.equal(inspector.snapshot('cleared').objects.filter(x => x.kind === 'listener' && x.destroyed).length, 0);
});

test('resource overloads preserve type/progress/completion callbacks and deduplicate nested loadAny', () => {
    const inspector = PerformanceInspector.start();
    const bundle = new Bundle(); let progress = 0; let complete = 0;
    class Texture extends Asset {}
    const onProgress = () => progress++;
    const onComplete = (error, asset) => { assert.equal(error, null); assert.ok(asset instanceof Asset); complete++; };
    bundle.load('sprite', Texture, onProgress, onComplete);
    assert.equal(lastLoad.options.type, Texture);
    assert.equal(progress, 1); assert.equal(complete, 1);
    bundle.load('sprite2', onProgress, onComplete);
    bundle.loadDir('sprite3', Texture, onComplete);
    manager.loadRemote('http://example.invalid/a.png', onComplete);
    manager.loadAny('uuid-no-callback');
    assert.equal(progress, 2); assert.equal(complete, 4);
    const events = inspector.getReport().resourceEvents.filter(x => x.operation === 'load');
    assert.equal(events.length, 5);
    assert.ok(events.some(x => x.key === 'ui:sprite' && x.type === 'load'));
    assert.ok(events.some(x => x.type === 'loadRemote'));
    assert.ok(events.some(x => x.key === 'uuid-no-callback'));
});

test('active Tween inventory drops completed/stopped actions and identifies invalid targets', () => {
    const inspector = PerformanceInspector.start(); const node = new Node('Moving'); director.scene.addChild(node);
    const tween = new Tween(node).start();
    assert.equal(inspector.snapshot('running').counts.tweens, 1);
    node.isValid = false;
    assert.ok(inspector.snapshot('target invalid').objects.some(x => x.kind === 'tween' && x.destroyed));
    tween.stop();
    assert.equal(inspector.snapshot('stopped').counts.tweens, 0);
});

test('buffers stay bounded and dropped counters report truncation', () => {
    const inspector = PerformanceInspector.start({ maxSamples: 10, maxEvents: 10, maxObjects: 10 });
    for (let i = 0; i < 25; i++) {
        director.scene.addChild(new Node(`n${i}`));
        manager.loadAny(`asset${i}`);
        inspector.sample(); inspector.snapshot(`s${i}`);
    }
    const report = inspector.getReport();
    assert.equal(report.samples.length, 10); assert.equal(report.resourceEvents.length, 10); assert.equal(report.snapshots.length, 10);
    assert.ok(report.snapshots.every(x => x.objects.length <= 10 && x.assets.length <= 10));
    assert.ok(report.dropped.samples > 0 && report.dropped.events > 0 && report.dropped.objects > 0 && report.dropped.snapshots > 0);
});

test('all documented load overloads preserve callback arity and Asset type', () => {
    const inspector = PerformanceInspector.start();
    const bundle = new Bundle(); class Texture extends Asset {}
    let calls = 0, progressCalls = 0;
    const complete = () => calls++;
    const progress = () => progressCalls++;
    const variants = [
        () => bundle.load('a', complete),
        () => bundle.load('b', Texture, complete),
        () => bundle.load('c', progress, complete),
        () => bundle.load('d', Texture, progress, complete),
        () => bundle.load('e'),
        () => bundle.load('f', Texture),
        () => bundle.load('g', null, null, complete),
        () => manager.loadAny('h', complete),
        () => manager.loadAny('i', { custom: true }, complete),
        () => manager.loadAny('j', progress, complete),
        () => manager.loadAny('k', { custom: true }, progress, complete),
        () => manager.loadAny('l'),
        () => manager.loadRemote('m', complete),
        () => manager.loadRemote('n', { ext: '.png' }, complete),
        () => manager.loadRemote('o'),
        () => manager.loadBundle('p', { version: 'v1' }, complete),
        () => manager.loadBundle('q', complete),
        () => manager.loadBundle('r'),
    ];
    for (const load of variants) load();
    assert.equal(calls, 13); assert.equal(progressCalls, 4);
    assert.equal(inspector.getReport().resourceEvents.filter(e => e.operation === 'load').length, variants.length);
});

test('oversized report exports preserve counts, fit UTF-8 budget and leave original data intact', () => {
    const { fitReportToBudget, utf8Bytes } = require('../runtime/reportBudget.ts');
    const { validateReport } = require('../src/core/validation.ts');
    const inspector = PerformanceInspector.start();
    const original = inspector.getReport();
    const node = { id: 'node:1', kind: 'node', label: '节点', createdAt: 0, lastSeenAt: 0, details: '内存'.repeat(500), stack: 'call\n'.repeat(500) };
    original.snapshots = Array.from({ length: 8 }, (_, index) => ({ ...original.snapshots[0], id: `s${index}`, time: index,
        objects: Array.from({ length: 600 }, (_, i) => ({ ...node, id: `node:${i}` })), counts: { nodes: 600, components: 0, tweens: 0, listeners: 0, assets: 0 } }));
    const compact = fitReportToBudget(original, 256 * 1024);
    assert.ok(utf8Bytes(JSON.stringify(compact)) <= 256 * 1024);
    assert.deepEqual(compact.snapshots.map(x => x.id), ['s0', 's7']);
    assert.ok(compact.snapshots.every(x => x.counts.nodes === 600 && x.truncated));
    assert.ok(compact.dropped.objects > 0 && compact.dropped.snapshots === 6);
    assert.equal(original.snapshots.length, 8); assert.equal(original.snapshots[0].objects.length, 600);
    assert.equal(compact.capabilities.at(-1).name, 'report-detail-budget');
    assert.doesNotThrow(() => validateReport(compact));
    assert.deepEqual(compact.findings, validateReport(compact).findings);
    assert.equal(utf8Bytes('a中😀'), Buffer.byteLength('a中😀'));
});

test('stop disables observers retained inside subsequently installed tools', () => {
    const originalOn = Node.prototype.on;
    const inspector = PerformanceInspector.start();
    const wrappedOn = Node.prototype.on;
    Node.prototype.on = function (...args) { return wrappedOn.apply(this, args); };
    try {
        inspector.stop();
        const node = new Node('after-stop'); node.on('event', () => {});
        assert.equal(inspector.objects.entries.size, 0);
        assert.equal(inspector.objects.emitters.size, 0);
    } finally { Node.prototype.on = originalOn; }
});

function mockTransport(responder = () => undefined) {
    const previous = global.XMLHttpRequest;
    const records = [];
    let active = 0, maximum = 0;
    global.XMLHttpRequest = class {
        open(method, url) { this.method = method; this.url = url; }
        setRequestHeader() {}
        send(body) {
            const record = { xhr: this, method: this.method, url: this.url, body, packet: body ? JSON.parse(body) : undefined };
            records.push(record); active++; maximum = Math.max(maximum, active);
            let finished = false;
            record.complete = result => {
                if (finished) return;
                finished = true; active--;
                if (result?.error) { this.onerror(); return; }
                this.status = 200;
                this.responseText = JSON.stringify(result?.response || (record.packet
                    ? { ok: true, streamId: record.packet.streamId, sequence: record.packet.sequence } : { commands: [] }));
                this.onload();
            };
            const result = responder(record);
            if (!result?.hold) queueMicrotask(() => record.complete(result));
        }
    };
    return { records, get maximum() { return maximum; }, restore() { global.XMLHttpRequest = previous; } };
}
async function finishTransport(inspector, network) {
    inspector?.stop();
    await inspector?.transportTask?.catch(() => {});
    network.restore();
}

test('live transport sends only new records and never builds a full report on its periodic path', async () => {
    const network = mockTransport();
    const inspector = PerformanceInspector.start({ endpoint: 'http://127.0.0.1:1234', token: 'test' });
    try {
        inspector.getReport = () => { throw new Error('periodic path must not assemble a full report'); };
        await inspector.sendReport();
        const baseline = network.records.filter(x => x.packet);
        assert.equal(baseline.length, 1);
        assert.ok(baseline[0].url.endsWith('/stream'));
        assert.ok(baseline[0].packet.snapshot);
        inspector.sample();
        manager.loadAny('new-asset');
        await inspector.sendReport();
        const second = network.records.filter(x => x.packet).at(-1).packet;
        assert.equal(second.samples.start, 0); assert.equal(second.samples.values.length, 1);
        assert.equal(second.resourceEvents.start, 0); assert.equal(second.resourceEvents.values.length, 1);
        assert.equal(second.snapshot, undefined);
        await inspector.sendReport();
        const heartbeat = network.records.filter(x => x.packet).at(-1).packet;
        assert.equal(heartbeat.samples.start, 1); assert.equal(heartbeat.samples.values.length, 0);
        assert.equal(heartbeat.resourceEvents.start, 1); assert.equal(heartbeat.resourceEvents.values.length, 0);
        assert.equal(heartbeat.snapshot, undefined);
    } finally { await finishTransport(inspector, network); }
});

test('XHR failure and mismatched ACK retain the exact pending body for the next retry', async () => {
    let posts = 0;
    const network = mockTransport(record => {
        if (!record.packet) return;
        posts++;
        if (posts === 1) return { error: true };
        if (posts === 2) return { response: { ok: true, streamId: record.packet.streamId, sequence: 999 } };
    });
    const inspector = PerformanceInspector.start({ endpoint: 'http://127.0.0.1:1234' });
    try {
        await assert.rejects(inspector.sendReport(), /transport unavailable/);
        inspector.sample();
        await assert.rejects(inspector.sendReport(), /ACK/);
        await inspector.sendReport();
        const packets = network.records.filter(x => x.packet);
        assert.equal(packets[0].body, packets[1].body);
        assert.equal(packets[0].body, packets[2].body);
        assert.equal(packets[3].packet.samples.values.length, 1, 'records added during a failed request follow its ACK');
        assert.equal(network.maximum, 1);
    } finally { await finishTransport(inspector, network); }
});

test('receiver reset starts a new stream and replays retained samples and snapshots', async () => {
    let reset = false;
    const network = mockTransport(record => {
        if (record.packet && reset) { reset = false; return { response: { ok: false, reset: true } }; }
    });
    const inspector = PerformanceInspector.start({ endpoint: 'http://127.0.0.1:1234' });
    try {
        await inspector.sendReport();
        const original = network.records.find(x => x.packet).packet;
        inspector.sample(); reset = true;
        await inspector.sendReport();
        const replay = network.records.filter(x => x.packet).at(-1).packet;
        assert.notEqual(replay.streamId, original.streamId);
        assert.equal(replay.sequence, 1);
        assert.equal(replay.samples.values.length, 1);
        assert.equal(replay.snapshot.id, original.snapshot.id);
    } finally { await finishTransport(inspector, network); }
});

test('stop during an in-flight upload removes hooks immediately and flushes final chunks without concurrent requests', async () => {
    const originalOn = Node.prototype.on;
    let first;
    const network = mockTransport(record => {
        if (!first && record.packet) { first = record; return { hold: true }; }
    });
    const inspector = PerformanceInspector.start({ endpoint: 'http://127.0.0.1:1234' });
    try {
        for (let i = 0; i < 1000; i++) director.scene.addChild(new Node(`extra-${i}`));
        inspector.snapshot('before stop');
        inspector.pushEvent({ time: 1, operation: 'error', key: '界'.repeat(8192), stack: '界'.repeat(16384), details: '界'.repeat(8192) });
        const inFlight = inspector.sendReport();
        inspector.stop(); inspector.stop();
        assert.equal(Node.prototype.on, originalOn);
        assert.equal(PerformanceInspector.current, undefined);
        assert.equal(network.records.length, 1);
        first.complete();
        await inFlight;
        const packets = network.records.filter(x => x.packet).map(x => x.packet);
        assert.ok(packets.length > 4, 'final flush continues in bounded, yielding batches');
        assert.equal(network.maximum, 1);
        assert.equal(network.records.some(x => x.url.includes('/commands')), false, 'stop skips queued command polling');
        const grouped = new Map();
        for (const packet of packets) if (packet.snapshot) {
            const chunk = packet.snapshot;
            const list = grouped.get(chunk.id) || []; list.push(...chunk.objects); grouped.set(chunk.id, list);
            assert.ok(Buffer.byteLength(JSON.stringify(packet)) <= 256 * 1024);
        }
        assert.equal(grouped.size, 3);
        const events = packets.flatMap(packet => packet.resourceEvents.values);
        assert.equal(events.length, 1, 'final flush sends the large event exactly once');
        assert.equal(events[0].stack.length, 16384);
        const report = inspector.getReport();
        for (const snapshot of report.snapshots) assert.equal(grouped.get(snapshot.id).length, snapshot.objects.length);
        assert.equal(inspector.objects.entries.size, 0);
        assert.equal(inspector.objects.emitters.size, 0);
    } finally { if (first) first.complete(); await finishTransport(inspector, network); }
});

test('stop fails a record beyond the packet limit without endlessly acknowledging empty packets', async () => {
    const network = mockTransport();
    const inspector = PerformanceInspector.start({ endpoint: 'http://127.0.0.1:1234' });
    try {
        const completion = inspector.sendReport();
        inspector.pushEvent({ time: 1, operation: 'error', key: 'too-large', stack: '界'.repeat(256 * 1024) });
        inspector.stop();
        await assert.rejects(completion, /record exceeds the packet limit/);
        assert.ok(network.records.length <= 2);
        assert.equal(inspector.running, false); assert.equal(inspector.finalFlush, false);
        assert.equal(inspector.objects.entries.size, 0);
    } finally { await finishTransport(inspector, network); }
});

test('alternating successful ACKs and resets cannot keep the final flush replaying forever', async () => {
    let posts = 0;
    const network = mockTransport(record => {
        if (record.packet && ++posts % 2 === 0) return { response: { ok: false, reset: true } };
    });
    const inspector = PerformanceInspector.start({ endpoint: 'http://127.0.0.1:1234' });
    try {
        const completion = inspector.sendReport();
        for (let i = 0; i < 1000; i++) director.scene.addChild(new Node(`retained-${i}`));
        inspector.snapshot('before reset');
        inspector.stop();
        await assert.rejects(completion, /repeatedly requested a stream reset/);
        assert.equal(posts, 4);
        assert.equal(network.maximum, 1);
        assert.equal(inspector.finalFlush, false);
        assert.equal(inspector.objects.entries.size, 0);
    } finally { await finishTransport(inspector, network); }
});
