const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('Creator preview contribution injects one relative plugin URL and serves config on the preview origin', async t => {
    const config = { endpoint: 'http://127.0.0.1:12345', token: 'a'.repeat(48), sampleIntervalMs: 1000, captureStacks: false };
    let fail = false;
    global.Editor = { Message: { request: async (name, method) => {
        assert.equal(name, 'cocos-performance-inspector'); assert.equal(method, 'get-preview-config');
        if (fail) throw new Error('disabled');
        return config;
    } } };
    t.after(() => { delete global.Editor; });
    const preview = require('../dist/src/editor/preview');
    const settings = { plugins: { jsList: ['existing.js'] } };
    await preview.onSettingsBrowser(settings); await preview.onSettingsBrowser(settings);
    assert.deepEqual(settings.plugins.jsList, ['cocos-performance-inspector/auto.js', 'existing.js']);
    const legacySettings = { jsList: [] };
    await preview.onSettingsBrowser(legacySettings);
    assert.deepEqual(legacySettings.jsList, ['cocos-performance-inspector/auto.js']);
    const response = () => ({ headers: {}, code: 200, setHeader(k, v) { this.headers[k] = v; },
        status(n) { this.code = n; return this; }, send(body) { this.body = body; }, json(body) { this.body = body; }, sendFile(file) { this.file = file; } });
    const req = { headers: { host: 'localhost:7456', referer: 'http://localhost:7456/' } };
    const script = response(); preview.get[0].handle(req, script);
    assert.ok(fs.existsSync(script.file));
    assert.match(script.file.replace(/\\/g, '/'), /dist\/runtime\/auto-preview.js$/);
    assert.equal(script.headers['Cache-Control'], 'no-store');
    const res = response(); await preview.get[1].handle(req, res);
    assert.deepEqual(res.body, config);
    for (const headers of [{ host: '192.168.1.2:7456' }, { host: 'localhost:7456', origin: 'https://evil.example' },
        { host: 'localhost:7456', 'sec-fetch-site': 'cross-site' }]) {
        const res = response(); await preview.get[1].handle({ headers }, res); assert.equal(res.code, 403);
    }
    fail = true;
    const offline = response(); await preview.get[1].handle(req, offline); assert.equal(offline.code, 503);
});

function browser(options = {}) {
    const timers = new Map(), listeners = new Map(), registry = new Map(); let serial = 0;
    class Bus {
        constructor() { this.events = []; }
        on(type, fn, target) { this.events.push({ type, fn, target }); }
        once(type, fn, target) { this.events.push({ type, fn, target, once: true }); }
        off(type, fn) { this.events = this.events.filter(e => e.type !== type || e.fn !== fn); }
        emit(type, ...args) { for (const e of [...this.events]) if (e.type === type) { if (e.once) this.off(type, e.fn); e.fn.apply(e.target, args); } }
    }
    class Node extends Bus {
        constructor(name = '') { super(); this.name = name; this.uuid = name; this.children = []; this.components = []; this.isValid = true; this.activeInHierarchy = true; }
        getComponents() { return this.components; }
    }
    class Component {}
    class Asset { addRef() {} decRef() {} }
    class Bundle {}
    class Tween {}
    const scene = new Node('scene'), director = new Bus(), game = new Bus();
    director.root = options.notReady ? null : { device: { numDrawCalls: 1, memoryStatus: { textureSize: 1, bufferSize: 1 } } };
    director.getScene = () => scene; director._persistRootNodes = {};
    const manager = { assets: new Map() };
    const cc = { Node, Component, Asset, AssetManager: { Bundle }, Tween, EventTarget: Bus,
        assetManager: manager, director, game,
        Director: { EVENT_AFTER_DRAW: 'after-draw', EVENT_BEFORE_UPDATE: 'before-update', EVENT_BEFORE_SCENE_LAUNCH: 'before-scene' },
        Game: { EVENT_ENGINE_INITED: 'engine-init', EVENT_POST_PROJECT_INIT: 'project-init' },
        TweenSystem: { instance: { ActionManager: { _hashTargets: new Map() } } },
        sys: { platform: 'browser' }, isValid: value => !!value && value.isValid !== false,
        js: { getClassByName: name => registry.get(name) } };
    let config = { endpoint: 'http://127.0.0.1:12345', token: 'a'.repeat(48), sampleIntervalMs: 1000, captureStacks: false };
    let fail = false;
    const XHR = class {
        open() {} setRequestHeader() {} send(body) {
            const packet = body ? JSON.parse(body) : null;
            this.status = 200;
            this.responseText = JSON.stringify(packet?.protocolVersion === 1
                ? { ok: true, streamId: packet.streamId, sequence: packet.sequence }
                : { commands: [] });
            this.onload?.();
        }
    };
    const sandbox = { console, URL, AbortController, WeakRef, TextEncoder, Date, Math,
        location: { href: 'http://localhost:7456/', origin: 'http://localhost:7456' },
        document: { hidden: false, currentScript: { src: 'http://localhost:7456/plugins/cocos-performance-inspector/auto.js' } },
        performance: { now: () => 100, memory: { usedJSHeapSize: 1024 } }, XMLHttpRequest: XHR,
        setInterval(fn, ms) { const id = ++serial; timers.set(id, { fn, ms, interval: true }); return id; },
        clearInterval(id) { timers.delete(id); }, setTimeout(fn, ms) { const id = ++serial; timers.set(id, { fn, ms }); return id; },
        clearTimeout(id) { timers.delete(id); },
        fetch: async () => ({ ok: !fail, status: fail ? 503 : 200, json: async () => ({ ...config }) }),
        System: { import: async name => { assert.equal(name, 'cc'); return cc; } },
        addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name) { listeners.delete(name); },
    };
    sandbox.window = sandbox;
    const context = vm.createContext(sandbox);
    const bundle = fs.readFileSync(path.join(__dirname, '../dist/runtime/auto-preview.js'), 'utf8');
    const evaluate = () => vm.runInContext(bundle, context);
    const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
    return { context, cc, director, game, scene, registry, timers, listeners, evaluate, flush,
        setConfig(next) { config = { ...config, ...next }; }, fail(value) { fail = value; },
        controller: () => context.__COCOS_PERFORMANCE_INSPECTOR_AUTO__ };
}

test('precompiled bundle starts without project scripts, survives scenes, refreshes config and cleans up', async () => {
    const b = browser(); b.evaluate(); await b.flush();
    const controller = b.controller(); assert.ok(controller.instance);
    const instance = controller.instance;
    assert.equal(instance.config.captureStacks, false);
    const id = instance.getReport().session.id;
    const timerCount = b.timers.size;
    b.evaluate(); await b.flush();
    assert.equal(b.controller(), controller);
    assert.equal(b.controller().instance.getReport().session.id, id);
    assert.equal(b.timers.size, timerCount);
    b.director.emit('before-scene'); assert.equal(controller.instance, instance);
    b.setConfig({ endpoint: 'http://127.0.0.1:54321', token: 'b'.repeat(48), captureStacks: true });
    await controller.refresh(); await b.flush();
    assert.notEqual(controller.instance, instance);
    assert.equal(controller.instance.config.captureStacks, true);
    assert.equal(instance.running, false);
    b.fail(true); await controller.refresh(); await controller.refresh();
    assert.equal(controller.instance, undefined);
    b.fail(false); await controller.refresh(); await b.flush(); assert.ok(controller.instance);
    b.listeners.get('pagehide')();
    assert.equal(b.controller(), undefined);
    assert.equal(b.timers.size, 0);
    assert.equal(b.director.events.filter(e => e.type === 'after-draw').length, 0);
});

test('auto startup waits for engine and suppresses legacy Bootstrap without modifying scenes', async () => {
    const b = browser({ notReady: true });
    let legacyStarts = 0, legacyStops = 0;
    class Legacy extends b.cc.Component { onLoad() { legacyStarts++; } }
    const original = Legacy.prototype.onLoad;
    const component = new Legacy(); component.owned = { stop() { legacyStops++; } };
    b.scene.components.push(component);
    b.evaluate(); await b.flush(); assert.equal(b.controller().instance, undefined);
    b.registry.set('PerformanceInspectorBootstrap', Legacy);
    b.game.emit('project-init');
    assert.equal(legacyStops, 1); component.onLoad(); assert.equal(legacyStarts, 0);
    b.director.root = { device: {} }; b.game.emit('engine-init'); await b.flush();
    assert.ok(b.controller().instance);
    b.controller().dispose(); assert.equal(Legacy.prototype.onLoad, original);
    component.onLoad(); assert.equal(legacyStarts, 1);
});
