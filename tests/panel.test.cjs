const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '../examples/demo-report.json'), 'utf8'));
const flush = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

// A deliberately small DOM model exercises the real panel controller without a browser dependency.
class Element {
    constructor(id, tag = 'div') {
        this.id = id; this.tag = tag; this.value = ''; this.checked = false; this.dataset = {};
        this.textContent = ''; this.writes = 0; this.html = ''; this.classes = new Set();
        this.classList = { toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name), remove: name => this.classes.delete(name) };
    }
    set innerHTML(value) {
        this.html = value; ++this.writes;
        if (this.tag === 'select') this.value = /<option value="([^"]*)"/.exec(value)?.[1] || '';
    }
    get innerHTML() { return this.html; }
    querySelectorAll() { return []; }
}
function report(overrides = {}) {
    return {
        ...fixture,
        config: { ...fixture.config, maxEvents: 2000 },
        snapshots: fixture.snapshots.map(({ objects, assets, ...summary }) => ({ ...summary, objectCount: objects.length, assetCount: assets.length })),
        resourceEvents: undefined, samplesStart: 0, samplesNext: fixture.samples.length, samplesReset: true,
        sampleCount: fixture.samples.length, resourceEventCount: fixture.resourceEvents.length, resourceRevision: 1,
        ...overrides,
    };
}
function update(overrides = {}) {
    return {
        selected: fixture.session.id, revision: 1, error: '', report: report(),
        capture: { sampleIntervalMs: 1000, captureStacks: false }, outputDirectory: 'PITemp',
        sessions: [{ id: fixture.session.id, online: true, imported: false }], ...overrides,
    };
}
function panel(initial = update()) {
    const ids = new Map(), nav = ['overview', 'objects', 'resources', 'coverage'].map(id => {
        const button = new Element(`nav-${id}`, 'button'); button.dataset.tab = id; return button;
    });
    const template = fs.readFileSync(path.join(__dirname, '../static/panel.html'), 'utf8');
    for (const match of template.matchAll(/<(\w+)[^>]*\bid="([^"]+)"/g)) ids.set(match[2], new Element(match[2], match[1]));
    const app = ids.get('app');
    app.querySelector = selector => ids.get(selector.slice(1));
    app.querySelectorAll = selector => selector === 'nav button' ? nav : selector === '.tab'
        ? ['overview', 'objects', 'resources', 'coverage'].map(id => ids.get(id))
        : selector === 'button,select,input' ? [...ids.values(), ...nav].filter(e => ['button', 'select', 'input'].includes(e.tag)) : [];
    let timer, current = initial, queued = [], stateHandler, snapshotHandler, resourceHandler;
    const calls = [], intervals = new Set();
    const request = (name, message, ...args) => {
        calls.push({ message, args });
        if (message === 'get-state') {
            if (stateHandler) return stateHandler(...args);
            if (queued.length) { current = queued.shift(); return current; }
            if (calls.filter(c => c.message === message).length === 1) return current;
            const { report: unused, ...metadata } = current; return metadata;
        }
        if (message === 'get-snapshot') return snapshotHandler ? snapshotHandler(...args) : fixture.snapshots.find(s => s.id === args[0]) || null;
        if (message === 'get-resource-events') return resourceHandler ? resourceHandler(...args) : { start: 0, next: 0, end: 0, reset: true, total: 0, events: [] };
        return undefined;
    };
    const code = fs.readFileSync(path.join(__dirname, '../dist/src/panels/default/index.js'), 'utf8');
    const module = { exports: {} };
    vm.runInNewContext(code, {
        require, module, exports: module.exports, __dirname: path.join(__dirname, '../dist/src/panels/default'),
        Editor: { Panel: { define: options => options }, Message: { request } },
        setInterval: callback => { timer = callback; const token = {}; intervals.add(token); return token; },
        clearInterval: token => intervals.delete(token),
    });
    const controller = { $: { app } };
    module.exports.ready.call(controller);
    return {
        ids, calls, intervals,
        queue: value => queued.push(value),
        poll: async () => { timer(); await flush(); },
        click: async id => { nav.find(b => b.dataset.tab === id).onclick(); await flush(); },
        close: () => module.exports.close.call(controller),
        snapshots: handler => { snapshotHandler = handler; },
        resources: handler => { resourceHandler = handler; },
        states: handler => { stateHandler = handler; },
    };
}

test('panel polls incremental samples and leaves unchanged charts and hidden details alone', async t => {
    const samples = Array.from({ length: 240 }, (_, i) => ({ ...fixture.samples[0], time: (i + 10) * 1000 }));
    const h = panel(update({ report: report({ samples, samplesStart: 10, samplesNext: 250, sampleCount: 250 }) }));
    t.after(h.close); await flush();
    assert.equal(h.calls.filter(c => c.message === 'get-snapshot' || c.message === 'get-resource-events').length, 0);
    const chart = h.ids.get('fps-chart'), writes = chart.writes;
    assert.match(chart.innerHTML, /10s/);
    await h.poll();
    assert.equal(chart.writes, writes);
    const cursor = h.calls.filter(c => c.message === 'get-state').at(-1).args[0];
    assert.equal(cursor.sessionId, fixture.session.id); assert.equal(cursor.revision, 1); assert.equal(cursor.sampleOffset, 250);
    h.queue(update({ revision: 2, report: report({ samples: [250, 251].map(i => ({ ...fixture.samples[0], time: i * 1000 })), samplesStart: 250, samplesNext: 252, samplesReset: false, sampleCount: 252 }) }));
    await h.poll();
    assert.equal(chart.writes, writes + 1); assert.match(chart.innerHTML, /12s/); assert.match(chart.innerHTML, /251s/);
    await h.click('coverage');
    assert.match(h.ids.get('buffers').textContent, /保留 252 个样本/);
    h.queue(update({ revision: 2, report: undefined, sessions: [{ id: fixture.session.id, online: false, imported: false }] }));
    await h.poll();
    assert.equal(h.ids.get('connection').textContent, '离线报告');
    assert.equal(h.ids.get('snapshot').disabled, true);
    assert.equal(chart.writes, writes + 1);
});

test('panel fetches only the selected snapshots, deduplicates requests, and releases details on leaving the tab', async t => {
    const h = panel(); t.after(h.close); await flush();
    const waiting = new Map(fixture.snapshots.map(s => [s.id, defer()]));
    h.snapshots(id => waiting.get(id).promise);
    await h.click('objects'); await h.click('objects');
    let requests = h.calls.filter(c => c.message === 'get-snapshot');
    assert.equal(requests.length, 2);
    const first = fixture.snapshots[0], last = fixture.snapshots.at(-1);
    assert.deepEqual(requests.map(c => c.args[0]), [first.id, last.id]);
    await h.click('overview');
    waiting.get(first.id).resolve(first); waiting.get(last.id).resolve(last); await flush();
    assert.equal(h.ids.get('objects-table').innerHTML, '');
    await h.click('objects');
    assert.equal(h.calls.filter(c => c.message === 'get-snapshot').length, 4);
    assert.match(h.ids.get('objects-table').innerHTML, /条对象记录/);
    const writes = h.ids.get('objects-table').writes;
    h.queue(update({ revision: 2 })); await h.poll();
    assert.equal(h.calls.filter(c => c.message === 'get-snapshot').length, 4);
    assert.equal(h.ids.get('objects-table').writes, writes);
    h.snapshots(id => fixture.snapshots.find(s => s.id === id));
    h.ids.get('after').value = fixture.snapshots[1].id; h.ids.get('after').onchange(); await flush();
    requests = h.calls.filter(c => c.message === 'get-snapshot');
    assert.equal(requests.length, 5); assert.equal(requests.at(-1).args[0], fixture.snapshots[1].id);
    h.ids.get('object-filter').value = first.objects[0].id; h.ids.get('object-filter').oninput();
    assert.match(h.ids.get('objects-table').innerHTML, /条对象记录/);
    await h.click('overview');
    assert.equal(h.ids.get('objects-table').innerHTML, ''); assert.equal(h.ids.get('snapshot-diff').innerHTML, '');
});

test('panel loads resource pages only while visible and bounds retained events', async t => {
    const h = panel(update({ report: report({ resourceEventCount: 2100 }) })); t.after(h.close); await flush();
    const all = Array.from({ length: 2100 }, (_, i) => ({ time: i * 1000, operation: 'load', key: `resource-${i}` }));
    h.resources(offset => { const start = offset ?? 0, next = Math.min(start + 256, all.length); return { start, next, end: all.length, total: all.length, reset: offset == null, events: all.slice(start, next) }; });
    await h.click('resources');
    for (let i = 0; i < 8; ++i) await h.poll();
    let requests = h.calls.filter(c => c.message === 'get-resource-events');
    assert.equal(requests.length, 9); assert.equal(requests[1].args[0], 256);
    assert.match(h.ids.get('resource-table').innerHTML, /2000 条记录/);
    assert.match(h.ids.get('resource-table').innerHTML, /resource-2099/);
    assert.doesNotMatch(h.ids.get('resource-table').innerHTML, /resource-0</);
    await h.poll(); assert.equal(h.calls.filter(c => c.message === 'get-resource-events').length, 9);
    await h.click('overview');
    assert.equal(h.ids.get('resource-table').innerHTML, '');
    await h.poll(); assert.equal(h.calls.filter(c => c.message === 'get-resource-events').length, 9);
    await h.click('resources');
    requests = h.calls.filter(c => c.message === 'get-resource-events');
    assert.equal(requests.length, 10); assert.equal(requests.at(-1).args[0], undefined);
});

test('panel ignores resource responses from an old tab and all responses after closing', async () => {
    const h = panel(); await flush();
    const pending = defer(); h.resources(() => pending.promise);
    await h.click('resources'); await h.click('resources');
    assert.equal(h.calls.filter(c => c.message === 'get-resource-events').length, 1);
    await h.click('overview');
    pending.resolve({ start: 0, next: 1, end: 1, total: 1, reset: true, events: [{ time: 0, operation: 'load', key: 'stale-resource' }] }); await flush();
    assert.equal(h.ids.get('resource-table').innerHTML, '');
    const state = defer(); h.states(() => state.promise);
    const poll = h.poll();
    h.close();
    const writes = h.ids.get('fps-chart').writes;
    state.resolve(update({ revision: 99 })); await poll;
    assert.equal(h.ids.get('fps-chart').writes, writes); assert.equal(h.intervals.size, 0);
    assert.equal(h.ids.get('html').onclick, null);
});

test('panel discards in-flight state and snapshot data when selecting another session', async t => {
    const h = panel(); t.after(h.close); await flush();
    const oldSnapshots = defer();
    h.snapshots(() => oldSnapshots.promise);
    await h.click('objects');
    const oldState = defer(); let stateRequests = 0;
    const replacement = fixture.snapshots.slice(0, 2).map(snapshot => ({
        ...snapshot, id: `${snapshot.id}-second`, objects: snapshot.objects.map(object => ({ ...object, label: 'NEW-SESSION-OBJECT' })),
    }));
    const second = update({
        selected: 'second-session', revision: 1,
        sessions: [{ id: 'second-session', online: true, imported: false }],
        report: report({ snapshots: replacement.map(({ objects, assets, ...summary }) => ({ ...summary, objectCount: objects.length, assetCount: assets.length })) }),
    });
    h.states(() => ++stateRequests === 1 ? oldState.promise : second);
    await h.poll();
    h.ids.get('session').value = 'second-session'; h.ids.get('session').onchange(); await flush();
    h.snapshots(id => replacement.find(snapshot => snapshot.id === id));
    oldState.resolve(update({ revision: 999 })); await flush();
    oldSnapshots.resolve({ ...fixture.snapshots[0], objects: [{ ...fixture.snapshots[0].objects[0], label: 'OLD-SESSION-OBJECT' }] }); await flush();
    assert.equal(h.ids.get('session').value, 'second-session');
    assert.match(h.ids.get('objects-table').innerHTML, /NEW-SESSION-OBJECT/);
    assert.doesNotMatch(h.ids.get('objects-table').innerHTML, /OLD-SESSION-OBJECT/);
    assert.equal(stateRequests, 2);
});

test('panel invalidates in-flight details when the same session starts a replacement stream', async t => {
    const objects = panel(); t.after(objects.close); await flush();
    const staleSnapshot = defer(); objects.snapshots(() => staleSnapshot.promise);
    await objects.click('objects');
    const replacements = fixture.snapshots.map(snapshot => ({
        ...snapshot, objects: snapshot.objects.map(object => ({ ...object, label: 'NEW-STREAM-OBJECT' })),
    }));
    objects.snapshots(id => replacements.find(snapshot => snapshot.id === id));
    objects.queue(update({ revision: 2, report: report({ samplesReset: true, resourceRevision: 2 }) }));
    await objects.poll();
    assert.equal(objects.calls.filter(c => c.message === 'get-snapshot').length, 4);
    assert.match(objects.ids.get('objects-table').innerHTML, /NEW-STREAM-OBJECT/);
    staleSnapshot.resolve({ ...fixture.snapshots[0], objects: [{ ...fixture.snapshots[0].objects[0], label: 'OLD-STREAM-OBJECT' }] }); await flush();
    assert.doesNotMatch(objects.ids.get('objects-table').innerHTML, /OLD-STREAM-OBJECT/);

    const resources = panel(); t.after(resources.close); await flush();
    resources.resources(() => ({ start: 0, next: 1, end: 1, total: 1, reset: true, events: [{ time: 0, operation: 'load', key: 'initial-resource' }] }));
    await resources.click('resources');
    const stalePage = defer(); resources.resources(() => stalePage.promise);
    resources.queue(update({ revision: 2, report: report({ samplesReset: false, resourceRevision: 2 }) }));
    await resources.poll();
    assert.equal(resources.calls.filter(c => c.message === 'get-resource-events').at(-1).args[0], 1);
    resources.resources(() => ({ start: 0, next: 1, end: 1, total: 1, reset: true, events: [{ time: 0, operation: 'load', key: 'NEW-STREAM-RESOURCE' }] }));
    resources.queue(update({ revision: 3, report: report({ samplesReset: true, resourceRevision: 3 }) }));
    await resources.poll();
    assert.equal(resources.calls.filter(c => c.message === 'get-resource-events').at(-1).args[0], undefined);
    assert.match(resources.ids.get('resource-table').innerHTML, /NEW-STREAM-RESOURCE/);
    stalePage.resolve({ start: 1, next: 2, end: 2, total: 2, reset: false, events: [{ time: 1, operation: 'load', key: 'OLD-STREAM-RESOURCE' }] }); await flush();
    assert.doesNotMatch(resources.ids.get('resource-table').innerHTML, /OLD-STREAM-RESOURCE|initial-resource/);
});
