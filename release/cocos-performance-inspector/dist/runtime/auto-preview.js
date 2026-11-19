/* Cocos Performance Inspector 1.2.0: precompiled browser-preview runtime */
(function(){
  'use strict';
  var source = document.currentScript && document.currentScript.src;
  if (!source || !globalThis.System || typeof System.import !== 'function') return;
  var configUrl = new URL('config.json', source).href;
  System.import('cc').then(function(cc){
    var modules = {"runtime/AutoPreview.ts": function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startAutoPreview = exports.AUTO_PREVIEW_KEY = void 0;
const cc_1 = require("cc");
const preview_1 = require("../src/shared/preview");
const PerformanceInspector_1 = require("./PerformanceInspector");
exports.AUTO_PREVIEW_KEY = '__COCOS_PERFORMANCE_INSPECTOR_AUTO__';
const VERSION = '1.2.0';
/** Runs only from Creator's browser-preview plugin list. No scene component or asset import. */
function startAutoPreview(configUrl) {
    const globals = globalThis;
    const url = new URL(configUrl, location.href);
    if (url.origin !== location.origin)
        throw new Error('自动接入配置必须来自当前预览服务');
    const previous = globals[exports.AUTO_PREVIEW_KEY];
    if (previous?.version === VERSION && previous.url === url.href) {
        void previous.refresh();
        return previous;
    }
    previous?.dispose();
    let disposed = false, pending = false, failures = 0, signature = '';
    let abort;
    let connection;
    let legacy;
    const stopInstance = () => {
        controller.instance?.stop();
        controller.instance = undefined;
        signature = '';
    };
    // Projects upgrading from 1.0 may still contain the old component. Suppress its
    // onLoad only in this preview, and stop any instance it already owns.
    const takeOverLegacy = () => {
        const ctor = cc_1.js.getClassByName('PerformanceInspectorBootstrap');
        if (!ctor?.prototype || legacy)
            return;
        const prototype = ctor.prototype, original = prototype.onLoad;
        if (typeof original !== 'function')
            return;
        const wrapper = function () {
            if (!disposed) {
                this.owned?.stop();
                this.owned = undefined;
                return;
            }
            return original.call(this);
        };
        legacy = { prototype, original, wrapper };
        prototype.onLoad = wrapper;
        const queue = [cc_1.director.getScene(), ...Object.values(cc_1.director._persistRootNodes || {})];
        const seen = new Set();
        while (queue.length) {
            const node = queue.pop();
            if (!node || seen.has(node))
                continue;
            seen.add(node);
            for (const component of node.getComponents(cc_1.Component)) {
                if (component instanceof ctor) {
                    component.owned?.stop();
                    component.owned = undefined;
                }
            }
            queue.push(...node.children);
        }
    };
    const startWhenReady = () => {
        if (disposed || !connection)
            return;
        if (!cc_1.director.root)
            return;
        cc_1.game.off(cc_1.Game.EVENT_ENGINE_INITED, startWhenReady);
        cc_1.director.off(cc_1.Director.EVENT_BEFORE_UPDATE, startWhenReady);
        takeOverLegacy();
        const nextSignature = JSON.stringify(connection);
        if (controller.instance && signature === nextSignature)
            return;
        stopInstance();
        controller.instance = PerformanceInspector_1.PerformanceInspector.start(connection);
        signature = nextSignature;
    };
    const controller = {
        version: VERSION, url: url.href,
        async refresh() {
            if (pending || disposed)
                return;
            pending = true;
            abort = new AbortController();
            const timeout = setTimeout(() => abort?.abort(), 3000);
            try {
                const response = await fetch(url.href, { cache: 'no-store', credentials: 'same-origin', signal: abort.signal });
                if (!response.ok)
                    throw new Error(`自动接入服务 HTTP ${response.status}`);
                const input = await response.json();
                const endpoint = new URL(input.endpoint);
                if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !/^[a-f0-9]{48}$/.test(input.token)) {
                    throw new Error('自动接入配置无效');
                }
                if (disposed)
                    return;
                connection = { endpoint: input.endpoint, token: input.token, ...(0, preview_1.captureSettings)(input) };
                failures = 0;
                startWhenReady();
            }
            catch {
                if (!disposed && ++failures >= 2)
                    stopInstance();
            }
            finally {
                clearTimeout(timeout);
                pending = false;
                abort = undefined;
            }
        },
        dispose() {
            if (disposed)
                return;
            disposed = true;
            clearInterval(heartbeat);
            abort?.abort();
            cc_1.game.off(cc_1.Game.EVENT_ENGINE_INITED, startWhenReady);
            cc_1.game.off(cc_1.Game.EVENT_POST_PROJECT_INIT, takeOverLegacy);
            cc_1.director.off(cc_1.Director.EVENT_BEFORE_UPDATE, startWhenReady);
            cc_1.director.off(cc_1.Director.EVENT_BEFORE_SCENE_LAUNCH, takeOverLegacy);
            window.removeEventListener('pagehide', controller.dispose);
            stopInstance();
            if (legacy && legacy.prototype.onLoad === legacy.wrapper)
                legacy.prototype.onLoad = legacy.original;
            if (globals[exports.AUTO_PREVIEW_KEY] === controller)
                delete globals[exports.AUTO_PREVIEW_KEY];
        },
    };
    globals[exports.AUTO_PREVIEW_KEY] = controller;
    cc_1.game.once(cc_1.Game.EVENT_ENGINE_INITED, startWhenReady);
    cc_1.game.once(cc_1.Game.EVENT_POST_PROJECT_INIT, takeOverLegacy);
    cc_1.director.once(cc_1.Director.EVENT_BEFORE_UPDATE, startWhenReady);
    cc_1.director.on(cc_1.Director.EVENT_BEFORE_SCENE_LAUNCH, takeOverLegacy);
    window.addEventListener('pagehide', controller.dispose);
    const heartbeat = setInterval(() => { void controller.refresh(); }, 5000);
    void controller.refresh();
    return controller;
}
exports.startAutoPreview = startAutoPreview;

},
"src/shared/preview.ts": function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.captureSettings = exports.DEFAULT_CAPTURE_SETTINGS = void 0;
exports.DEFAULT_CAPTURE_SETTINGS = { sampleIntervalMs: 1000, captureStacks: false };
function captureSettings(value) {
    const input = value;
    if (!input || typeof input.captureStacks !== 'boolean' || !Number.isInteger(input.sampleIntervalMs) ||
        input.sampleIntervalMs < 250 || input.sampleIntervalMs > 10000) {
        throw new Error('采样间隔须为 250–10000 ms，调用栈开关须为布尔值');
    }
    return { sampleIntervalMs: input.sampleIntervalMs, captureStacks: input.captureStacks };
}
exports.captureSettings = captureSettings;

},
"runtime/PerformanceInspector.ts": function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PerformanceInspector = void 0;
const cc_1 = require("cc");
const cc = require("cc");
const analyzer_1 = require("../src/core/analyzer");
const model_1 = require("../src/shared/model");
const hooks_1 = require("./hooks");
const objects_1 = require("./objects");
const resources_1 = require("./resources");
const transport_1 = require("./transport");
const reportBudget_1 = require("./reportBudget");
const streamSender_1 = require("./streamSender");
/** Debug-only singleton. Call stop() to remove every installed hook and timer. */
class PerformanceInspector {
    static start(options = {}) {
        if (PerformanceInspector.current)
            return PerformanceInspector.current;
        const inspector = new PerformanceInspector(options);
        PerformanceInspector.current = inspector;
        inspector.begin();
        return inspector;
    }
    constructor(options) {
        this.started = (0, hooks_1.clock)();
        this.startedAt = new Date().toISOString();
        this.id = `cpi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
        this.hooks = new hooks_1.HookScope();
        this.samples = [];
        this.snapshots = [];
        this.events = [];
        this.dropped = { samples: 0, events: 0, objects: 0, snapshots: 0 };
        this.running = false;
        this.finalFlush = false;
        this.transportResets = 0;
        this.sender = new streamSender_1.IncrementalStreamSender(() => this.streamSource());
        this.transportStatus = 'Offline: endpoint not configured.';
        this.frames = [];
        this.frameCount = 0;
        this.frameTotal = 0;
        this.slowFrames = 0;
        this.frameMax = 0;
        this.lastFrame = 0;
        this.snapshotSerial = 0;
        this.onFrame = () => {
            const time = (0, hooks_1.clock)();
            if (typeof document !== 'undefined' && document.hidden) {
                this.lastFrame = 0;
                return;
            }
            if (this.lastFrame > 0) {
                const dt = Math.max(0, time - this.lastFrame);
                this.frameCount++;
                this.frameTotal += dt;
                this.frameMax = Math.max(this.frameMax, dt);
                if (dt > this.config.slowFrameMs)
                    this.slowFrames++;
                if (this.frames.length < 6000)
                    this.frames.push(dt);
            }
            this.lastFrame = time;
        };
        this.config = (0, model_1.normalizeConfig)(options);
        // 10 snapshots × (10000 objects + 10000 asset details) stays under the importer's aggregate record limit.
        this.config.maxObjects = Math.min(10000, this.config.maxObjects);
        this.endpoint = (options.endpoint || '').trim().replace(/\/+$/, '');
        this.token = options.token || '';
        this.transportIntervalMs = Math.max(2000, options.transportIntervalMs || 3000);
        this.objects = new objects_1.ObjectTracker(this.config, () => this.elapsed(), () => this.dropped.objects++);
        this.resources = new resources_1.ResourceTracker(this.config, () => this.elapsed(), event => this.pushEvent(event));
    }
    elapsed() { return Math.max(0, (0, hooks_1.clock)() - this.started); }
    scene() { return String(cc_1.director.getScene()?.name || '(no scene)').slice(0, 2048); }
    begin() {
        this.running = true;
        this.objects.install(this.hooks);
        this.resources.install(this.hooks);
        this.objects.trackEventTarget(cc_1.director);
        this.objects.ignoreCallback(this.onFrame);
        cc_1.director.on(cc_1.Director.EVENT_AFTER_DRAW, this.onFrame);
        this.captureSnapshot('开始采集 / baseline');
        this.sampleTimer = setInterval(() => this.sample(), this.config.sampleIntervalMs);
        if (this.endpoint) {
            this.transportStatus = 'Awaiting first connection.';
            this.transportTimer = setInterval(() => { void this.tickTransport(); }, this.transportIntervalMs);
            void this.tickTransport();
        }
    }
    pushEvent(event) {
        if (!this.running)
            return;
        if (this.events.length >= this.config.maxEvents) {
            this.events.shift();
            this.dropped.events++;
        }
        this.events.push(event);
    }
    metrics() {
        const finite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
        const device = cc_1.director.root?.device;
        return {
            heapBytes: finite(typeof performance !== 'undefined' ? performance.memory?.usedJSHeapSize : undefined),
            drawCalls: finite(device?.numDrawCalls), textureBytes: finite(device?.memoryStatus?.textureSize), bufferBytes: finite(device?.memoryStatus?.bufferSize),
        };
    }
    sample() {
        if (!this.running)
            return;
        const objects = this.objects.scan();
        const assets = this.resources.inventory(0);
        const sorted = this.frames.slice().sort((a, b) => a - b);
        const sample = {
            time: this.elapsed(), scene: this.scene(), ...objects.counts, assets: assets.count, ...this.metrics(),
            fps: this.frameTotal > 0 ? this.frameCount * 1000 / this.frameTotal : 0,
            frameMs: this.frameCount > 0 ? this.frameTotal / this.frameCount : 0,
            p95Ms: sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * .95) - 1)] : 0,
            maxFrameMs: this.frameMax, slowFrames: this.slowFrames,
        };
        if (this.samples.length >= this.config.maxSamples) {
            this.samples.shift();
            this.dropped.samples++;
        }
        this.samples.push(sample);
        this.frames = [];
        this.frameCount = 0;
        this.frameTotal = 0;
        this.slowFrames = 0;
        this.frameMax = 0;
    }
    captureSnapshot(label) {
        if (!this.running)
            throw new Error('Inspector is stopped. Start a new session before capturing snapshots.');
        const inventory = this.objects.scan();
        const assets = this.resources.inventory(this.config.maxObjects);
        const snapshot = {
            id: `${this.id}-snapshot-${++this.snapshotSerial}`, label: String(label).slice(0, 200), time: this.elapsed(), scene: this.scene(),
            counts: { ...inventory.counts, assets: assets.count }, objects: inventory.objects, assets: assets.assets,
            truncated: inventory.truncated || assets.truncated,
        };
        if (this.snapshots.length >= 10) {
            this.snapshots.shift();
            this.dropped.snapshots++;
        }
        this.snapshots.push(snapshot);
        return snapshot;
    }
    snapshot(label = '手动快照') {
        return JSON.parse(JSON.stringify(this.captureSnapshot(label)));
    }
    mark(label) { return this.snapshot(label); }
    trackEventTarget(emitter) { this.objects.trackEventTarget(emitter); }
    capabilities() {
        const metrics = this.metrics();
        return [
            ...this.objects.capabilities(),
            { name: 'js-heap', available: metrics.heapBytes !== null, detail: 'Chromium performance.memory usedJSHeapSize when available. Shared/isolate JS heap estimate; unavailable on most native/mobile runtimes. Native RSS and GC retaining paths are not measured.' },
            { name: 'gpu-counters', available: metrics.drawCalls !== null, detail: 'Current engine device drawCalls and memoryStatus textureSize/bufferSize. Engine allocation counters, not total GPU process memory.' },
            this.resources.capability(),
            { name: 'editor-transport', available: !!this.endpoint && this.transportStatus === 'Connected', detail: this.transportStatus },
            { name: 'bounded-recording', available: true, detail: `Samples ≤ ${this.config.maxSamples}; resource events ≤ ${this.config.maxEvents}; object records ≤ ${this.config.maxObjects}; snapshots ≤ 10. Call stacks are ${this.config.captureStacks ? 'enabled' : 'disabled'}. Frame percentiles use up to 6000 frames per interval. Observer adds scan/hook/serialization overhead.` },
        ];
    }
    getReport() {
        const report = {
            schemaVersion: 1,
            session: { id: this.id, startedAt: this.startedAt, endedAt: this.endedAt || new Date().toISOString(),
                engine: String(cc.VERSION || cc.ENGINE_VERSION || 'Cocos Creator 3.8.x'), platform: String(cc_1.sys.platform) },
            config: { ...this.config }, samples: this.samples, snapshots: this.snapshots, resourceEvents: this.events,
            findings: [], capabilities: this.finalCapabilities || this.capabilities(), dropped: { ...this.dropped },
        };
        report.findings = (0, analyzer_1.analyzeReport)(report);
        // Returning plain detached data prevents callers from altering the collector buffers.
        return (0, reportBudget_1.fitReportToBudget)(report);
    }
    streamSource() {
        return {
            session: { id: this.id, startedAt: this.startedAt, endedAt: this.endedAt || new Date().toISOString(),
                engine: String(cc.VERSION || cc.ENGINE_VERSION || 'Cocos Creator 3.8.x'), platform: String(cc_1.sys.platform) },
            config: this.config, samples: this.samples, snapshots: this.snapshots, resourceEvents: this.events,
            capabilities: this.finalCapabilities || this.capabilities(), dropped: this.dropped,
        };
    }
    /** Flush a bounded batch of new records. Complete offline reports are assembled only on demand. */
    async sendReport() {
        if (!this.endpoint)
            throw new Error('Inspector endpoint is empty; export getReport() for offline import.');
        return this.startTransport(false);
    }
    async tickTransport() {
        if (!this.running)
            return;
        try {
            await this.startTransport(true);
        }
        catch { /* Transport status is exposed through capabilities; the next tick retries the same packet. */ }
    }
    startTransport(pollCommands) {
        if (this.transportTask)
            return this.transportTask;
        const task = this.transportCycle(pollCommands);
        this.transportTask = task;
        void task.finally(() => { if (this.transportTask === task)
            this.transportTask = undefined; }).catch(() => { });
        return task;
    }
    async flushPackets(limit, heartbeat = false) {
        for (let count = 0; count < limit; count++) {
            const prepared = this.sender.nextPacket(heartbeat && count === 0);
            if (!prepared)
                return;
            const ack = await (0, transport_1.requestJSONBody)(`${this.endpoint}/stream`, this.token, prepared.body);
            if (this.sender.acknowledge(ack))
                this.transportStatus = 'Connected';
            else if (++this.transportResets >= 2)
                throw new Error('Inspector receiver repeatedly requested a stream reset.');
        }
    }
    async transportCycle(pollCommands) {
        this.transportResets = 0;
        try {
            await this.flushPackets(3, true);
            if (this.running && pollCommands) {
                const response = await (0, transport_1.requestJSON)(`${this.endpoint}/commands?session=${encodeURIComponent(this.id)}`, this.token);
                if (this.running && Array.isArray(response?.commands))
                    for (const command of response.commands.slice(0, 10)) {
                        if (command?.type === 'snapshot')
                            this.captureSnapshot(String(command.label || '编辑器快照'));
                    }
            }
            await this.flushPackets(1);
            // stop() may run while a request is in flight. It joins this same task and never
            // starts a competing final upload. Yield between batches; keep no packet queue.
            while (this.finalFlush && this.sender.hasPendingData()) {
                await new Promise(resolve => setTimeout(resolve, 0));
                await this.flushPackets(4);
            }
            // If stop occurred after the last packet was prepared, publish the final endedAt.
            if (this.finalFlush)
                await this.flushPackets(1, true);
        }
        catch (error) {
            this.transportStatus = String(error?.message || error);
            throw error;
        }
        finally {
            if (!this.running)
                this.finalFlush = false;
        }
    }
    /** Browser download. In JSB use getReport() plus the project's own file I/O, or sendReport(). */
    downloadReport(filename = `performance-${this.id}.json`) {
        if (typeof document === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
            throw new Error('Browser download unavailable. Use getReport() or sendReport().');
        }
        const url = URL.createObjectURL(new Blob([JSON.stringify(this.getReport())], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    stop() {
        if (!this.running)
            return;
        this.sample();
        this.captureSnapshot('停止采集 / final');
        this.finalCapabilities = this.capabilities();
        this.running = false;
        this.endedAt = new Date().toISOString();
        if (this.sampleTimer !== undefined)
            clearInterval(this.sampleTimer);
        if (this.transportTimer !== undefined)
            clearInterval(this.transportTimer);
        cc_1.director.off(cc_1.Director.EVENT_AFTER_DRAW, this.onFrame);
        this.resources.dispose();
        this.hooks.dispose();
        this.objects.dispose();
        this.frames = [];
        if (PerformanceInspector.current === this)
            PerformanceInspector.current = undefined;
        if (this.endpoint) {
            this.finalFlush = true;
            void this.startTransport(false).catch(() => { });
        }
    }
}
exports.PerformanceInspector = PerformanceInspector;

},
"src/core/analyzer.ts": function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeReport = exports.compareSnapshots = void 0;
/** Stable runtime IDs are compared; matching names do not imply matching objects. */
function compareSnapshots(before, after) {
    const first = new Set(before.objects.map(o => o.id));
    const last = new Set(after.objects.map(o => o.id));
    const firstAssets = new Set(before.assets.map(a => a.id));
    const lastAssets = new Set(after.assets.map(a => a.id));
    const countDelta = {};
    for (const kind of ['nodes', 'components', 'assets', 'tweens', 'listeners']) {
        countDelta[kind] = after.counts[kind] - before.counts[kind];
    }
    return {
        sameScene: before.scene === after.scene, incomplete: before.truncated || after.truncated,
        countDelta, added: after.objects.filter(o => !first.has(o.id)), removed: before.objects.filter(o => !last.has(o.id)),
        addedAssets: after.assets.filter(a => !firstAssets.has(a.id)), removedAssets: before.assets.filter(a => !lastAssets.has(a.id)),
    };
}
exports.compareSnapshots = compareSnapshots;
const MB = 1024 * 1024;
const fmt = (n) => n.toFixed(1);
function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const i = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2;
}
/** Heuristic diagnostics only: these observations do not establish GC reachability. */
function analyzeReport(report) {
    const result = [];
    const { samples, config, snapshots, resourceEvents } = report;
    const push = (finding) => result.push(finding);
    let bestStart = 0, bestLength = 0, runStart = 0, runLength = 0;
    for (let index = 0; index < samples.length; index++) {
        const sample = samples[index];
        if (sample.fps < config.lowFps && sample.frameMs > 0) {
            if (runLength === 0)
                runStart = index;
            runLength++;
            if (runLength > bestLength) {
                bestStart = runStart;
                bestLength = runLength;
            }
        }
        else
            runLength = 0;
    }
    const best = samples.slice(bestStart, bestStart + bestLength);
    if (best.length >= 3 && best[best.length - 1].time - best[0].time >= Math.max(1000, config.sampleIntervalMs * 2)) {
        const average = best.reduce((sum, s) => sum + s.fps, 0) / best.length;
        const seconds = (best[best.length - 1].time - best[0].time) / 1000;
        push({ id: 'performance-low-fps', category: 'performance', severity: average < config.lowFps / 2 && seconds >= 10 ? 'critical' : 'warning',
            title: '检测到持续低帧率', evidence: `${fmt(best[0].time / 1000)}–${fmt(best[best.length - 1].time / 1000)} 秒的 ${best.length} 个连续采样均低于 ${config.lowFps} FPS，平均 ${fmt(average)} FPS。`,
            suggestion: '复现同一操作并检查 CPU 时间、Draw Call 和资源加载记录；后台页或主动限帧也可能降低 FPS。' });
    }
    const spikes = samples.filter(s => s.maxFrameMs >= config.slowFrameMs);
    if (spikes.length) {
        const slowFrames = samples.reduce((n, s) => n + s.slowFrames, 0);
        push({ id: 'performance-frame-spikes', category: 'performance', severity: 'warning', title: '检测到长帧',
            evidence: `${spikes.length} 个采样区间出现至少 ${config.slowFrameMs} ms 的长帧，最长 ${fmt(spikes.reduce((n, s) => Math.max(n, s.maxFrameMs), 0))} ms；记录到 ${slowFrames} 个慢帧。`,
            suggestion: '对照长帧时间点复现资源加载、实例化、布局或大量销毁操作。启动、切场景与后台恢复产生的长帧需要单独判断。' });
    }
    // Compare four window medians and a least-squares trend. Using all successive
    // samples alone would mistake a GC sawtooth or one isolated allocation for a leak.
    const memory = samples.filter(s => s.heapBytes !== null).slice(-config.memoryWindow);
    if (memory.length >= config.memoryWindow) {
        const elapsed = memory[memory.length - 1].time - memory[0].time;
        const requiredMs = Math.max(10000, (config.memoryWindow - 1) * config.sampleIntervalMs * 0.8);
        const quarter = Math.max(1, Math.floor(memory.length / 4));
        const groups = [0, 1, 2, 3].map(i => memory.slice(i * quarter, i === 3 ? undefined : (i + 1) * quarter));
        const levels = groups.map(g => median(g.map(s => s.heapBytes)));
        const growth = (levels[3] - levels[0]) / MB;
        const origin = memory[0].time;
        const xs = memory.map(s => (s.time - origin) / 60000);
        const ys = memory.map(s => s.heapBytes / MB);
        const mx = xs.reduce((n, x) => n + x, 0) / xs.length;
        const my = ys.reduce((n, y) => n + y, 0) / ys.length;
        const covariance = xs.reduce((n, x, i) => n + (x - mx) * (ys[i] - my), 0);
        const variance = xs.reduce((n, x) => n + (x - mx) ** 2, 0);
        const slope = variance > 0 ? covariance / variance : 0;
        const risingGroups = levels.every((v, i) => i === 0 || v > levels[i - 1]);
        if (elapsed >= requiredMs && growth >= config.memoryGrowthMB && slope >= config.memorySlopeMBPerMin && risingGroups) {
            push({ id: 'memory-sustained-growth', category: 'memory', severity: 'warning', title: 'JS 堆内存持续增长嫌疑',
                evidence: `最近 ${memory.length} 个有效采样覆盖 ${fmt(elapsed / 1000)} 秒，四段中位数持续上升，首尾增加 ${fmt(growth)} MiB，线性趋势 ${fmt(slope)} MiB/分钟。`,
                suggestion: '在相同场景反复进入/退出同一功能，静置后再次比较快照，并使用浏览器 Heap Snapshot 检查保留路径。缓存预热与 GC 时机也会造成增长；此结果不能证明内存泄漏。' });
        }
    }
    if (snapshots.length >= 2) {
        const after = snapshots[snapshots.length - 1];
        const before = snapshots.slice(0, -1).find(s => s.scene === after.scene);
        if (before) {
            const diff = compareSnapshots(before, after);
            const growth = ['nodes', 'components', 'tweens', 'listeners'].filter(k => diff.countDelta[k] > 0);
            if (growth.length) {
                const names = { nodes: 'Node', components: 'Component', tweens: 'Tween', listeners: '监听器' };
                push({ id: 'object-snapshot-growth', category: 'object', severity: 'info', title: '同场景快照对象数量净增长',
                    evidence: `“${before.label}” → “${after.label}”：${growth.map(k => `${names[k]} +${diff.countDelta[k]}`).join('，')}。${diff.incomplete ? '对象明细已截断，差异列表不完整。' : ''}`,
                    suggestion: '确认两次快照位于相同业务状态、完成销毁与异步回调后采集。重复相同生命周期仍持续增长时，按对象 ID、节点路径和注册堆栈排查；单次增长可能是正常业务。',
                    objectIds: diff.added.slice(0, 50).map(o => o.id) });
            }
            const previousIds = new Set(before.assets.map(a => a.id));
            const retainedAssets = after.assets.filter(a => a.refCount > 0 && previousIds.has(a.id));
            if (retainedAssets.length && diff.countDelta.assets > 0) {
                push({ id: 'resource-cache-growth', category: 'resource', severity: 'info', title: '资源缓存增长且仍有引用',
                    evidence: `相同场景资源数净增 ${diff.countDelta.assets}，${retainedAssets.length} 个跨快照缓存资源的 refCount > 0。`,
                    suggestion: '对照资源 UUID、addRef/decRef 与 release 请求检查持有者。缓存存在或 refCount > 0 本身不代表泄漏，release 请求也不等于物理内存立即释放。',
                    objectIds: retainedAssets.slice(0, 50).map(a => a.id) });
            }
        }
    }
    const last = snapshots[snapshots.length - 1];
    if (last) {
        const retained = last.objects.filter(o => (o.kind === 'node' || o.kind === 'component') &&
            (o.destroyed || last.time - o.lastSeenAt >= config.staleObjectMs));
        if (retained.length)
            push({ id: 'object-retained-engine-objects', category: 'object', severity: 'info', title: '已销毁或长期离树对象仍可被观察到',
                evidence: `最近快照中 ${retained.filter(o => o.kind === 'node').length} 个 Node、${retained.filter(o => o.kind === 'component').length} 个 Component 已销毁或超过 ${fmt(config.staleObjectMs / 1000)} 秒未在场景树中出现，但弱引用仍可访问。示例：${retained.slice(0, 3).map(o => o.path || o.label).join('；')}。`,
                suggestion: '检查对象池、全局数组、闭包及事件/Tween 的持有关系。对象池可能有意保留对象，GC 也可能尚未执行；请在同一业务状态下复测，并使用 Heap Snapshot 的保留路径确认。弱引用可访问本身不是泄漏证明。',
                objectIds: retained.slice(0, 50).map(o => o.id) });
        const destroyed = last.objects.filter(o => (o.kind === 'listener' || o.kind === 'tween') && o.destroyed);
        if (destroyed.length)
            push({ id: 'object-destroyed-target', category: 'object', severity: 'warning', title: '已销毁目标仍有关联记录',
                evidence: `最近快照发现 ${destroyed.length} 个关联已销毁目标的 Tween 或监听器记录。示例：${destroyed.slice(0, 3).map(o => o.path || o.label).join('；')}。`,
                suggestion: '检查 onDestroy 中的事件解绑、Tween.stop/stopAllByTarget 和跨场景对象持有。该记录表示采集器观察到的关联，需要结合注册堆栈与业务生命周期确认。',
                objectIds: destroyed.slice(0, 50).map(o => o.id) });
        const stale = last.objects.filter(o => (o.kind === 'tween' || o.kind === 'listener') && last.time - o.createdAt >= config.staleObjectMs && !o.destroyed);
        if (stale.length)
            push({ id: 'object-long-lived-handles', category: 'object', severity: 'info', title: '存在长期活动的 Tween / 监听器',
                evidence: `${stale.length} 个活动记录已超过 ${fmt(config.staleObjectMs / 1000)} 秒。长期运行的动画和全局事件可能是正常行为。`,
                suggestion: '优先检查临时界面注册的监听器和循环 Tween；全局系统或常驻节点的长期记录可作为正常基线。', objectIds: stale.slice(0, 50).map(o => o.id) });
    }
    const errors = resourceEvents.filter(e => e.operation === 'error');
    if (errors.length)
        push({ id: 'resource-load-errors', category: 'resource', severity: 'warning', title: '资源加载错误',
            evidence: `捕获 ${errors.length} 次加载错误。示例：${errors.slice(0, 3).map(e => e.key).join('；')}。`, suggestion: '检查路径、Bundle 生命周期和回调错误；查看事件详情及可选调用堆栈。' });
    const slow = resourceEvents.filter(e => e.operation === 'load' && (e.durationMs || 0) >= 500);
    if (slow.length)
        push({ id: 'resource-slow-loads', category: 'resource', severity: 'info', title: '资源加载耗时较高',
            evidence: `${slow.length} 次加载调用耗时至少 500 ms；最长 ${fmt(slow.reduce((n, e) => Math.max(n, e.durationMs || 0), 0))} ms。`,
            suggestion: '区分网络下载、缓存命中与解析/实例化耗时。可按资源标识定位调用栈；加载回调耗时不是 GPU 或物理内存分配量。' });
    return result;
}
exports.analyzeReport = analyzeReport;

},
"src/shared/model.ts": function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeConfig = exports.DEFAULT_CONFIG = void 0;
exports.DEFAULT_CONFIG = {
    sampleIntervalMs: 1000, maxSamples: 1800, maxEvents: 2000, maxObjects: 10000,
    lowFps: 45, slowFrameMs: 50, memoryWindow: 30, memoryGrowthMB: 8,
    memorySlopeMBPerMin: 2, captureStacks: false, staleObjectMs: 30000,
};
function normalizeConfig(input = {}) {
    const value = { ...exports.DEFAULT_CONFIG };
    for (const key of Object.keys(exports.DEFAULT_CONFIG)) {
        const candidate = input[key];
        if (key === 'captureStacks') {
            value.captureStacks = candidate === true;
        }
        else if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
            value[key] = candidate;
        }
    }
    value.sampleIntervalMs = Math.max(250, value.sampleIntervalMs);
    for (const key of ['maxSamples', 'maxEvents', 'maxObjects', 'memoryWindow']) {
        value[key] = Math.min(100000, Math.max(key === 'memoryWindow' ? 5 : 10, Math.floor(value[key])));
    }
    return value;
}
exports.normalizeConfig = normalizeConfig;

},
"runtime/hooks.ts": function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.short = exports.clock = exports.weak = exports.HookScope = void 0;
/** Hooks never replace user callbacks or own engine objects. Dispose only restores our wrapper. */
class HookScope {
    constructor() {
        this.disposers = [];
    }
    wrap(owner, key, factory) {
        if (!owner || typeof owner[key] !== 'function')
            return false;
        const descriptor = Object.getOwnPropertyDescriptor(owner, key);
        const original = owner[key];
        const wrapped = factory(original);
        try {
            Object.defineProperty(owner, key, { configurable: true, writable: true, enumerable: descriptor?.enumerable ?? false, value: wrapped });
            this.disposers.push(() => {
                if (owner[key] !== wrapped)
                    return; // A subsequently installed tool owns this slot now.
                if (descriptor)
                    Object.defineProperty(owner, key, descriptor);
                else
                    delete owner[key];
            });
            return true;
        }
        catch {
            return false;
        }
    }
    dispose() {
        for (const dispose of this.disposers.reverse())
            dispose();
        this.disposers = [];
    }
}
exports.HookScope = HookScope;
function weak(value) {
    const Ref = globalThis.WeakRef;
    return typeof Ref === 'function' && value && (typeof value === 'object' || typeof value === 'function') ? new Ref(value) : undefined;
}
exports.weak = weak;
function clock() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}
exports.clock = clock;
function short(value, limit = 500) {
    try {
        const result = typeof value === 'string' ? value : JSON.stringify(value);
        return String(result ?? value).slice(0, limit);
    }
    catch {
        return String(value).slice(0, limit);
    }
}
exports.short = short;

},
"runtime/objects.ts": function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ObjectTracker = void 0;
const cc_1 = require("cc");
const cc = require("cc");
const hooks_1 = require("./hooks");
/** All engine references in persistent registries are weak. Snapshots contain strings/numbers only. */
class ObjectTracker {
    constructor(config, now, onDrop) {
        this.config = config;
        this.now = now;
        this.onDrop = onDrop;
        this.ids = new WeakMap();
        this.serial = 0;
        this.entries = new Map();
        this.emitters = new Map();
        this.observed = new Set();
        this.scannedTables = new Set();
        this.ignoredCallbacks = new WeakSet();
        this.inScan = false;
        this.overflow = false;
        this.tweenSupported = false;
        this.eventTableSupported = false;
        this.enabled = true;
    }
    identity(object) {
        if (!object || (typeof object !== 'object' && typeof object !== 'function'))
            return String(object);
        let id = this.ids.get(object);
        if (!id) {
            id = String(++this.serial);
            this.ids.set(object, id);
        }
        return id;
    }
    path(node) {
        const parts = [];
        let current = node;
        while (current && parts.length < 40) {
            parts.unshift((0, hooks_1.short)(current.name || '(unnamed)', 80));
            current = current.parent;
        }
        return parts.join('/').slice(0, 2048);
    }
    destroyed(value) {
        return !!value && typeof value === 'object' && 'isValid' in value && !(0, cc_1.isValid)(value, true);
    }
    record(id, kind, label, ref, details, path, stack) {
        label = label.slice(0, 2048);
        details = details?.slice(0, 2048);
        path = path?.slice(0, 2048);
        stack = stack?.slice(0, 16384);
        if (this.inScan)
            this.observed.add(id);
        let entry = this.entries.get(id);
        const time = this.now();
        if (!entry) {
            if (this.entries.size >= this.config.maxObjects) {
                const oldest = this.entries.keys().next().value;
                if (oldest !== undefined)
                    this.entries.delete(oldest);
                this.overflow = true;
                this.onDrop();
            }
            entry = { value: { id, kind, label, createdAt: time, lastSeenAt: time, details, path, stack }, ref: (0, hooks_1.weak)(ref) };
            this.entries.set(id, entry);
        }
        else {
            Object.assign(entry.value, { label, lastSeenAt: time, details, path });
            if (stack && !entry.value.stack)
                entry.value.stack = stack;
        }
    }
    stack() { return this.config.captureStacks ? new Error().stack?.split('\n').slice(3, 15).join('\n') : undefined; }
    listenerId(emitter, type, callback, target, capture) {
        let typeKey = String(type);
        if (typeKey.length > 200) {
            let hash = 2166136261;
            for (let i = 0; i < typeKey.length; i++)
                hash = Math.imul(hash ^ typeKey.charCodeAt(i), 16777619);
            typeKey = `${typeKey.slice(0, 100)}#${(hash >>> 0).toString(16)}:${typeKey.length}`;
        }
        return `listener:${this.identity(emitter)}:${typeKey}:${this.identity(callback)}:${this.identity(target)}:${capture}`;
    }
    watchEmitter(emitter) {
        const ref = (0, hooks_1.weak)(emitter);
        if (!ref)
            return;
        const id = this.identity(emitter);
        if (!this.emitters.has(id) && this.emitters.size >= this.config.maxObjects) {
            const oldest = this.emitters.keys().next().value;
            if (oldest !== undefined)
                this.emitters.delete(oldest);
            this.overflow = true;
            this.onDrop();
        }
        this.emitters.set(id, ref);
    }
    /** Discover an Eventify-derived/custom event bus that predates profiler startup. */
    trackEventTarget(emitter) { if (this.enabled)
        this.watchEmitter(emitter); }
    ignoreCallback(callback) { this.ignoredCallbacks.add(callback); }
    install(scope) {
        const tracker = this;
        for (const owner of [cc_1.EventTarget.prototype, cc_1.Node.prototype]) {
            for (const key of ['on', 'once']) {
                scope.wrap(owner, key, original => function (...args) {
                    if (!tracker.enabled)
                        return original.apply(this, args);
                    const result = original.apply(this, args);
                    tracker.watchEmitter(this);
                    if (typeof args[1] === 'function' && !tracker.ignoredCallbacks.has(args[1])) {
                        const isNode = this instanceof cc_1.Node;
                        const capture = isNode && !!args[3];
                        const id = tracker.listenerId(this, args[0], args[1], args[2], capture);
                        tracker.record(id, 'listener', `${this.name || this.constructor?.name || 'EventTarget'}:${String(args[0])}`, this, 'Observed registration; reconciled against live callback tables at sampling.', args[2] instanceof cc_1.Component ? tracker.path(args[2].node) : args[2] instanceof cc_1.Node ? tracker.path(args[2]) : undefined, tracker.stack());
                    }
                    return result;
                });
            }
        }
        scope.wrap(cc_1.Tween.prototype, 'start', original => function (...args) {
            if (!tracker.enabled)
                return original.apply(this, args);
            const result = original.apply(this, args);
            if (this._finalAction && this._target) {
                tracker.record(`tween:${tracker.identity(this._finalAction)}`, 'tween', `Tween → ${this._target.name || this._target.constructor?.name || 'Object'}`, this._finalAction, 'Active action; lifecycle reconciled against ActionManager.', undefined, tracker.stack());
            }
            return result;
        });
    }
    scanEmitter(emitter) {
        if (this.destroyed(emitter))
            return 0;
        const processor = emitter instanceof cc_1.Node ? emitter.eventProcessor || emitter._eventProcessor : undefined;
        const tables = processor
            ? [[processor.bubblingTarget?._callbackTable, false], [processor.capturingTarget?._callbackTable, true]]
            : [[emitter._callbackTable, false]];
        let count = 0;
        for (const [table, capture] of tables) {
            if (!table || typeof table !== 'object')
                continue;
            if (this.scannedTables.has(table))
                continue;
            this.scannedTables.add(table);
            this.eventTableSupported = true;
            for (const type of Object.keys(table)) {
                const infos = table[type]?.callbackInfos;
                if (!Array.isArray(infos))
                    continue;
                for (const info of infos) {
                    if (!info || typeof info.callback !== 'function' || this.ignoredCallbacks.has(info.callback))
                        continue;
                    const target = info.target;
                    const id = this.listenerId(emitter, type, info.callback, target, capture);
                    const targetDestroyed = this.destroyed(target);
                    const targetNode = target instanceof cc_1.Component ? target.node : target instanceof cc_1.Node ? target : undefined;
                    this.record(id, 'listener', `${emitter.name || emitter.constructor?.name || 'EventTarget'}:${type} → ${target?.name || target?.constructor?.name || '(no target)'}`, emitter, `callback=${info.callback.name || '(anonymous)'}; once=${!!info.once}; capture=${capture}; targetDestroyed=${targetDestroyed}`, targetNode ? this.path(targetNode) : undefined);
                    const entry = this.entries.get(id);
                    if (entry)
                        entry.value.destroyed = targetDestroyed;
                    count++;
                }
            }
        }
        return count;
    }
    scan() {
        this.inScan = true;
        this.observed.clear();
        this.scannedTables.clear();
        const counts = { nodes: 0, components: 0, tweens: 0, listeners: 0 };
        const scene = cc_1.director.getScene();
        const queue = scene ? [scene] : [];
        // 3.8.x stores persistent roots here; normally they already belong to the current scene.
        const persistent = cc_1.director._persistRootNodes;
        if (persistent && typeof persistent === 'object')
            queue.push(...Object.values(persistent));
        const visited = new Set();
        const scannedEmitters = new Set();
        while (queue.length) {
            const node = queue.pop();
            if (!node || visited.has(node) || !(0, cc_1.isValid)(node, true))
                continue;
            visited.add(node);
            const path = this.path(node);
            const id = `node:${this.identity(node)}`;
            counts.nodes++;
            this.record(id, 'node', (0, hooks_1.short)(node.name || '(unnamed)', 150), node, `uuid=${node.uuid}; active=${node.activeInHierarchy}; persistent=${!!persistent?.[node.uuid]}`, path);
            const nodeEntry = this.entries.get(id);
            if (nodeEntry)
                nodeEntry.value.destroyed = false;
            for (const component of node.getComponents(cc_1.Component)) {
                if (!(0, cc_1.isValid)(component, true))
                    continue;
                counts.components++;
                const cid = `component:${this.identity(component)}`;
                this.record(cid, 'component', component.constructor.name, component, `enabled=${component.enabled}; node=${node.uuid}`, path);
                const entry = this.entries.get(cid);
                if (entry)
                    entry.value.destroyed = false;
            }
            counts.listeners += this.scanEmitter(node);
            scannedEmitters.add(node);
            queue.push(...node.children);
        }
        for (const [id, ref] of this.emitters) {
            const emitter = ref.deref();
            if (!emitter || this.destroyed(emitter)) {
                this.emitters.delete(id);
                continue;
            }
            if (!scannedEmitters.has(emitter))
                counts.listeners += this.scanEmitter(emitter);
        }
        const manager = cc.TweenSystem?.instance?.ActionManager;
        const targets = manager?._hashTargets;
        this.tweenSupported = targets instanceof Map;
        if (this.tweenSupported) {
            targets.forEach((entry, target) => {
                if (!Array.isArray(entry.actions))
                    return;
                for (const action of entry.actions) {
                    if (!action)
                        continue;
                    const id = `tween:${this.identity(action)}`;
                    const destroyed = this.destroyed(target);
                    this.record(id, 'tween', `Tween → ${target?.name || target?.constructor?.name || 'Object'}`, action, `paused=${!!entry.paused}; targetDestroyed=${destroyed}`, target instanceof cc_1.Component ? this.path(target.node) : target instanceof cc_1.Node ? this.path(target) : undefined);
                    const tracked = this.entries.get(id);
                    if (tracked)
                        tracked.value.destroyed = destroyed;
                    counts.tweens++;
                }
            });
        }
        const objects = [];
        for (const [id, entry] of this.entries) {
            const record = entry.value;
            if (this.observed.has(id)) {
                objects.push({ ...record });
                continue;
            }
            if (record.kind === 'listener' || record.kind === 'tween') {
                this.entries.delete(id);
                continue;
            }
            const object = entry.ref?.deref();
            if (!object) {
                this.entries.delete(id);
                continue;
            }
            record.destroyed = this.destroyed(object);
            record.details = record.destroyed
                ? 'Destroyed engine object still observable via WeakRef. GC has not been forced; this alone is not proof of a leak.'
                : 'Previously observed object is outside the current scene tree. It may be intentionally pooled or retained.';
            objects.push({ ...record });
        }
        this.inScan = false;
        this.scannedTables.clear();
        return { counts, objects, truncated: this.overflow };
    }
    capabilities() {
        return [
            { name: 'scene-objects', available: true, detail: 'Current scene and persistent roots, including inactive nodes/components. Detached objects are observable only after first scene observation.' },
            { name: 'weak-object-retention', available: typeof globalThis.WeakRef === 'function', detail: 'WeakRef observation is a leak clue, not a retaining path or GC proof. Without WeakRef, detached/destroyed retention and global event-bus lifetime cannot be tracked.' },
            { name: 'event-listeners', available: this.eventTableSupported, detail: '3.8.x callback tables: current Nodes and EventTarget.on/once observed since startup; once/off/targetOff/removeAll are reconciled from actual tables. Custom Eventify buses can call trackEventTarget(). No DOM/custom-emitter coverage.' },
            { name: 'active-tweens', available: this.tweenSupported, detail: '3.8.x ActionManager._hashTargets inventory. Includes existing actions; completed/stopped actions are removed at next sample. Private-field compatibility is checked.' },
        ];
    }
    dispose() { this.enabled = false; this.entries.clear(); this.emitters.clear(); this.observed.clear(); this.scannedTables.clear(); this.ids = new WeakMap(); this.ignoredCallbacks = new WeakSet(); }
}
exports.ObjectTracker = ObjectTracker;

},
"runtime/resources.ts": function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResourceTracker = void 0;
const cc_1 = require("cc");
const hooks_1 = require("./hooks");
/** Capture public API requests/completions. A release request does not imply memory has been reclaimed. */
class ResourceTracker {
    constructor(config, now, emit) {
        this.config = config;
        this.now = now;
        this.emit = emit;
        this.loadDepth = 0;
        this.releaseDepth = 0;
        this.enabled = true;
        this.coverage = [];
        this.missing = [];
    }
    stack() { return this.config.captureStacks ? new Error().stack?.split('\n').slice(3, 15).join('\n').slice(0, 16384) : undefined; }
    key(value) { return (0, hooks_1.short)(value?.uuid || value?._uuid || value?.name || value); }
    load(scope, owner, method, mode) {
        const tracker = this;
        return scope.wrap(owner, method, original => function (...args) {
            if (!tracker.enabled)
                return original.apply(this, args);
            if (tracker.loadDepth)
                return original.apply(this, args);
            const started = (0, hooks_1.clock)();
            const trace = tracker.stack();
            let options = args[1];
            let progress = args[2];
            let callback = args[3];
            if (mode === 'simple') {
                callback = typeof args[1] === 'function' ? args[1] : args[2];
                options = typeof args[1] === 'function' ? null : args[1];
            }
            else if (callback === undefined) {
                const isType = mode === 'bundle' && typeof options === 'function' && (options === cc_1.Asset || options.prototype instanceof cc_1.Asset);
                const callbackAtSecond = mode === 'any' ? typeof options === 'function' : !isType;
                if (progress) {
                    callback = progress;
                    if (!callbackAtSecond)
                        progress = null;
                }
                else if (progress === undefined && callbackAtSecond) {
                    callback = options;
                    options = null;
                    progress = null;
                }
                if (args[2] !== undefined && callbackAtSecond) {
                    progress = args[1];
                    options = null;
                }
            }
            const originalCallback = typeof callback === 'function' ? callback : undefined;
            const bundleName = mode === 'bundle' ? this.name : options?.bundle;
            const key = `${bundleName ? `${bundleName}:` : ''}${tracker.key(args[0])}`;
            let completed = false;
            const completion = function (error, result, ...rest) {
                if (!completed && tracker.enabled) {
                    completed = true;
                    tracker.emit({ time: tracker.now(), operation: error ? 'error' : 'load', key,
                        type: method, durationMs: (0, hooks_1.clock)() - started, stack: trace,
                        details: error ? (0, hooks_1.short)(error?.message || error) : `Completed ${method}; result=${Array.isArray(result) ? `${result.length} assets` : tracker.key(result)}` });
                }
                return originalCallback?.apply(this, [error, result, ...rest]);
            };
            const normalized = mode === 'simple' ? [args[0], options, completion] : [args[0], options, progress, completion];
            tracker.loadDepth++;
            try {
                return original.apply(this, normalized);
            }
            catch (error) {
                if (tracker.enabled && !completed)
                    tracker.emit({ time: tracker.now(), operation: 'error', key, type: method,
                        durationMs: (0, hooks_1.clock)() - started, stack: trace, details: (0, hooks_1.short)(error?.message || error) });
                throw error;
            }
            finally {
                tracker.loadDepth--;
            }
        });
    }
    release(scope, owner, method) {
        const tracker = this;
        return scope.wrap(owner, method, original => function (...args) {
            if (!tracker.enabled)
                return original.apply(this, args);
            if (tracker.releaseDepth)
                return original.apply(this, args);
            const key = method.includes('All') || method === 'releaseUnusedAssets' ? `${this.name || 'assetManager'}:*` : tracker.key(args[0]);
            const stack = tracker.stack();
            tracker.releaseDepth++;
            try {
                const result = original.apply(this, args);
                if (tracker.enabled)
                    tracker.emit({ time: tracker.now(), operation: 'release', key, type: method,
                        stack, details: 'Release API requested. Check subsequent asset cache/refCount snapshots; this does not prove CPU/GPU/JS memory reclamation.' });
                return result;
            }
            finally {
                tracker.releaseDepth--;
            }
        });
    }
    install(scope) {
        const observed = (name, success) => (success ? this.coverage : this.missing).push(name);
        observed('assetManager.loadAny', this.load(scope, cc_1.assetManager, 'loadAny', 'any'));
        observed('assetManager.loadRemote', this.load(scope, cc_1.assetManager, 'loadRemote', 'simple'));
        observed('assetManager.loadBundle', this.load(scope, cc_1.assetManager, 'loadBundle', 'simple'));
        const bundle = cc_1.AssetManager.Bundle?.prototype;
        observed('Bundle.load', this.load(scope, bundle, 'load', 'bundle'));
        observed('Bundle.loadDir', this.load(scope, bundle, 'loadDir', 'bundle'));
        for (const key of ['releaseAsset', 'releaseAll', 'releaseUnusedAssets'])
            observed(`assetManager.${key}`, this.release(scope, cc_1.assetManager, key));
        for (const key of ['release', 'releaseAll', 'releaseUnusedAssets'])
            observed(`Bundle.${key}`, this.release(scope, bundle, key));
        const tracker = this;
        for (const method of ['addRef', 'decRef']) {
            observed(`Asset.${method}`, scope.wrap(cc_1.Asset.prototype, method, original => function (...args) {
                if (!tracker.enabled)
                    return original.apply(this, args);
                const stack = tracker.stack();
                const key = tracker.key(this);
                const result = original.apply(this, args);
                if (tracker.enabled)
                    tracker.emit({ time: tracker.now(), operation: method, key, type: this.constructor.name,
                        refCount: this.refCount, stack, details: `${method} invocation observed; refCount=${this.refCount}` });
                return result;
            }));
        }
    }
    capability() {
        return { name: 'resource-lifecycle', available: this.coverage.length > 0,
            detail: `Observed after startup: ${this.coverage.join(', ') || 'none'}. Missing/unpatchable APIs: ${this.missing.join(', ') || 'none'}. Nested load/release calls are deduplicated. Release events are API requests, not proof of reclamation.` };
    }
    inventory(limit) {
        const assets = [];
        let count = 0;
        cc_1.assetManager.assets.forEach((asset, id) => {
            count++;
            if (assets.length < limit)
                assets.push({ id: (0, hooks_1.short)(id), name: (0, hooks_1.short)(asset.name), type: asset.constructor.name, refCount: asset.refCount });
        });
        return { count, assets, truncated: count > limit };
    }
    dispose() { this.enabled = false; }
}
exports.ResourceTracker = ResourceTracker;

},
"runtime/transport.ts": function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestJSONBody = exports.requestJSON = void 0;
/** XHR is available in both Cocos web preview and JSB; no Node dependency is bundled. */
function requestJSON(url, token, data) {
    return requestJSONBody(url, token, data === undefined ? undefined : JSON.stringify(data));
}
exports.requestJSON = requestJSON;
/** Reuse the exact serialized pending packet on retries; do not serialize it again. */
function requestJSONBody(url, token, body) {
    return new Promise((resolve, reject) => {
        if (typeof XMLHttpRequest === 'undefined') {
            reject(new Error('XMLHttpRequest unavailable; use getReport() to export offline.'));
            return;
        }
        const xhr = new XMLHttpRequest();
        xhr.open(body === undefined ? 'GET' : 'POST', url, true);
        xhr.timeout = 5000;
        xhr.setRequestHeader('X-Inspector-Token', token);
        if (body !== undefined)
            xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.onload = () => {
            if (xhr.status < 200 || xhr.status >= 300) {
                reject(new Error(`Inspector transport HTTP ${xhr.status}`));
                return;
            }
            try {
                resolve(xhr.responseText ? JSON.parse(xhr.responseText) : {});
            }
            catch {
                reject(new Error('Inspector transport returned invalid JSON'));
            }
        };
        xhr.onerror = () => reject(new Error('Inspector transport unavailable. Check endpoint/token, CORS and preview protocol.'));
        xhr.ontimeout = () => reject(new Error('Inspector transport timed out'));
        xhr.send(body === undefined ? null : body);
    });
}
exports.requestJSONBody = requestJSONBody;

},
"runtime/reportBudget.ts": function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.utf8Bytes = exports.fitReportToBudget = exports.REPORT_BUDGET_BYTES = void 0;
var reportBudget_1 = require("../src/core/reportBudget");
Object.defineProperty(exports, "REPORT_BUDGET_BYTES", { enumerable: true, get: function () { return reportBudget_1.REPORT_BUDGET_BYTES; } });
Object.defineProperty(exports, "fitReportToBudget", { enumerable: true, get: function () { return reportBudget_1.fitReportToBudget; } });
Object.defineProperty(exports, "utf8Bytes", { enumerable: true, get: function () { return reportBudget_1.utf8Bytes; } });

},
"src/core/reportBudget.ts": function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fitReportToBudget = exports.utf8Bytes = exports.REPORT_BUDGET_BYTES = void 0;
const analyzer_1 = require("./analyzer");
exports.REPORT_BUDGET_BYTES = 8 * 1024 * 1024;
/** JSB does not consistently expose TextEncoder; compute UTF-8 size without platform APIs. */
function utf8Bytes(value) {
    let bytes = 0;
    for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code < 0x80)
            bytes++;
        else if (code < 0x800)
            bytes += 2;
        else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) {
            bytes += 4;
            i++;
        }
        else
            bytes += 3;
    }
    return bytes;
}
exports.utf8Bytes = utf8Bytes;
function priority(object, snapshot) {
    if (object.destroyed)
        return 0;
    if (snapshot.time - object.lastSeenAt >= 30000)
        return 1;
    if (object.kind === 'listener' || object.kind === 'tween')
        return 2;
    return 3;
}
/** Bound every exported report to the editor's importer size limit; never mutate collector buffers. */
function fitReportToBudget(source, budgetBytes = exports.REPORT_BUDGET_BYTES) {
    const budget = Math.max(65536, budgetBytes);
    let serialized = JSON.stringify(source);
    if (utf8Bytes(serialized) <= budget)
        return JSON.parse(serialized);
    serialized = '';
    const report = {
        ...source, samples: [...source.samples], resourceEvents: source.resourceEvents.map(event => ({ ...event })),
        snapshots: source.snapshots.map(snapshot => ({ ...snapshot, objects: [...snapshot.objects], assets: [...snapshot.assets] })),
        capabilities: [...source.capabilities], dropped: { ...source.dropped },
    };
    report.capabilities.push({ name: 'report-detail-budget', available: true,
        detail: `Export payload limited to ${Math.floor(budget / 1024)} KiB UTF-8. When oversized, intermediate snapshots, older event stacks and some detail/sample records are omitted. Snapshot counts are preserved; truncated=true marks incomplete object/asset lists. Destroyed/stale handles receive priority. Original bounded collector buffers are unchanged. Findings are recomputed from exported data.` });
    if (report.snapshots.length > 2) {
        const removed = report.snapshots.slice(1, -1);
        report.dropped.snapshots += removed.length;
        report.dropped.objects += removed.reduce((count, snapshot) => count + snapshot.objects.length + snapshot.assets.length, 0);
        report.snapshots = [report.snapshots[0], report.snapshots[report.snapshots.length - 1]];
    }
    // Preserve useful stacks for recent activity; old call stacks can dominate a report.
    report.resourceEvents = report.resourceEvents.map((event, index) => index < report.resourceEvents.length - 64 && event.stack
        ? { ...event, stack: event.stack.slice(0, 512) } : event);
    for (const snapshot of report.snapshots) {
        snapshot.objects.sort((a, b) => priority(a, snapshot) - priority(b, snapshot));
    }
    report.findings = (0, analyzer_1.analyzeReport)(report);
    serialized = JSON.stringify(report);
    while (utf8Bytes(serialized) > budget) {
        let changed = false;
        for (const snapshot of report.snapshots) {
            const objectLength = Math.floor(snapshot.objects.length * .65);
            const assetLength = Math.floor(snapshot.assets.length * .65);
            if (objectLength < snapshot.objects.length || assetLength < snapshot.assets.length) {
                report.dropped.objects += snapshot.objects.length - objectLength + snapshot.assets.length - assetLength;
                snapshot.objects = snapshot.objects.slice(0, objectLength);
                snapshot.assets = snapshot.assets.slice(0, assetLength);
                snapshot.truncated = true;
                changed = true;
            }
        }
        if (report.resourceEvents.length) {
            const length = Math.floor(report.resourceEvents.length * .75);
            report.dropped.events += report.resourceEvents.length - length;
            report.resourceEvents = length ? report.resourceEvents.slice(-length) : [];
            changed = true;
        }
        if (report.samples.length) {
            const length = Math.floor(report.samples.length * .85);
            report.dropped.samples += report.samples.length - length;
            report.samples = length ? report.samples.slice(-length) : [];
            changed = true;
        }
        if (!changed)
            throw new Error('Inspector report metadata exceeds the export budget.');
        report.findings = (0, analyzer_1.analyzeReport)(report);
        serialized = JSON.stringify(report);
    }
    return JSON.parse(serialized);
}
exports.fitReportToBudget = fitReportToBudget;

},
"runtime/streamSender.ts": function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IncrementalStreamSender = void 0;
const stream_1 = require("../src/shared/stream");
const reportBudget_1 = require("../src/core/reportBudget");
/** A single bounded pending packet, with cursors committed only after its exact ACK. */
class IncrementalStreamSender {
    constructor(source) {
        this.source = source;
        this.streamId = this.newStreamId();
        this.sequence = 1;
    }
    newStreamId() { return `stream-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`; }
    available(source) {
        const cursor = this.cursor || { samples: source.dropped.samples, events: source.dropped.events,
            snapshot: source.dropped.snapshots, objects: 0, assets: 0 };
        return { samples: Math.max(cursor.samples, source.dropped.samples), events: Math.max(cursor.events, source.dropped.events),
            snapshot: Math.max(cursor.snapshot, source.dropped.snapshots),
            objects: cursor.snapshot < source.dropped.snapshots ? 0 : cursor.objects,
            assets: cursor.snapshot < source.dropped.snapshots ? 0 : cursor.assets };
    }
    hasPendingData() {
        if (this.pending)
            return true;
        const source = this.source();
        const cursor = this.available(source);
        return cursor.samples < source.dropped.samples + source.samples.length ||
            cursor.events < source.dropped.events + source.resourceEvents.length ||
            cursor.snapshot < source.dropped.snapshots + source.snapshots.length;
    }
    nextPacket(forceMetadata = false) {
        if (this.pending)
            return this.pending;
        const source = this.source();
        const before = this.available(source);
        const after = { ...before };
        const snapshot = source.snapshots[before.snapshot - source.dropped.snapshots];
        const chunk = snapshot && {
            id: snapshot.id, label: snapshot.label, time: snapshot.time, scene: snapshot.scene,
            counts: { ...snapshot.counts }, truncated: snapshot.truncated, index: before.snapshot,
            objectOffset: before.objects, assetOffset: before.assets,
            objectTotal: snapshot.objects.length, assetTotal: snapshot.assets.length, objects: [], assets: [],
        };
        const packet = {
            protocolVersion: stream_1.STREAM_VERSION, streamId: this.streamId, sequence: this.sequence,
            session: { ...source.session }, config: { ...source.config }, capabilities: source.capabilities.map(value => ({ ...value })),
            dropped: { ...source.dropped }, samples: { start: before.samples, values: [] },
            resourceEvents: { start: before.events, values: [] }, ...(chunk ? { snapshot: chunk } : {}),
        };
        let bytes = (0, reportBudget_1.utf8Bytes)(JSON.stringify(packet));
        if (bytes > stream_1.STREAM_MAX_BYTES)
            throw new Error('Inspector stream metadata exceeds the packet limit.');
        const sampleOffset = before.samples - source.dropped.samples;
        const eventOffset = before.events - source.dropped.events;
        const firstSample = source.samples[sampleOffset];
        const firstEvent = source.resourceEvents[eventOffset];
        const firstSampleBytes = firstSample ? (0, reportBudget_1.utf8Bytes)(JSON.stringify(firstSample)) : 0;
        const firstEventBytes = firstEvent ? (0, reportBudget_1.utf8Bytes)(JSON.stringify(firstEvent)) : 0;
        // A share is a fairness target, not a per-record limit. Isolate a large record so
        // new samples or snapshot metadata cannot indefinitely prevent it from fitting.
        const isolated = firstSampleBytes > 64 * 1024 ? 'sample' : firstEventBytes > 64 * 1024 ? 'event' : undefined;
        if (isolated) {
            delete packet.snapshot;
            bytes = (0, reportBudget_1.utf8Bytes)(JSON.stringify(packet));
            const cost = isolated === 'sample' ? firstSampleBytes : firstEventBytes;
            if (bytes + cost > stream_1.STREAM_MAX_BYTES)
                throw new Error('Inspector stream record exceeds the packet limit.');
            if (isolated === 'sample') {
                packet.samples.values.push(firstSample);
                after.samples++;
            }
            else {
                packet.resourceEvents.values.push(firstEvent);
                after.events++;
            }
            const body = JSON.stringify(packet);
            this.pending = { packet, body, after };
            return this.pending;
        }
        // Measure each record once, rather than repeatedly serializing an ever-growing packet.
        const append = (target, values, offset, limit = stream_1.STREAM_MAX_RECORDS, ceiling = stream_1.STREAM_MAX_BYTES) => {
            let count = 0;
            while (count < limit && offset + count < values.length) {
                const value = values[offset + count];
                const measured = value === firstSample ? firstSampleBytes : value === firstEvent ? firstEventBytes : (0, reportBudget_1.utf8Bytes)(JSON.stringify(value));
                const cost = measured + (target.length ? 1 : 0);
                if (bytes + cost > ceiling)
                    break;
                target.push(value);
                bytes += cost;
                count++;
            }
            return count;
        };
        // Reserve bounded shares for live samples/events before snapshot details. Large snapshots
        // continue across packets without starving the live chart or queuing the entire snapshot.
        after.samples += append(packet.samples.values, source.samples, sampleOffset, stream_1.STREAM_MAX_RECORDS, Math.min(stream_1.STREAM_MAX_BYTES, bytes + 64 * 1024));
        after.events += append(packet.resourceEvents.values, source.resourceEvents, eventOffset, stream_1.STREAM_MAX_RECORDS, Math.min(stream_1.STREAM_MAX_BYTES, bytes + 64 * 1024));
        if (chunk && snapshot) {
            after.objects += append(chunk.objects, snapshot.objects, before.objects);
            after.assets += append(chunk.assets, snapshot.assets, before.assets, stream_1.STREAM_MAX_RECORDS - chunk.objects.length);
            if (after.objects === snapshot.objects.length && after.assets === snapshot.assets.length) {
                after.snapshot++;
                after.objects = 0;
                after.assets = 0;
            }
            else if (!chunk.objects.length && !chunk.assets.length) {
                if (packet.samples.values.length || packet.resourceEvents.values.length)
                    delete packet.snapshot;
                else
                    throw new Error('Inspector snapshot record exceeds the packet limit.');
            }
        }
        const progressed = after.samples !== before.samples || after.events !== before.events ||
            after.snapshot !== before.snapshot || after.objects !== before.objects || after.assets !== before.assets;
        if (!progressed) {
            const waiting = before.samples < source.dropped.samples + source.samples.length ||
                before.events < source.dropped.events + source.resourceEvents.length || !!snapshot;
            if (waiting)
                throw new Error('Inspector pending record could not fit within the packet limit.');
            if (!forceMetadata)
                return undefined;
        }
        const body = JSON.stringify(packet);
        if ((0, reportBudget_1.utf8Bytes)(body) > stream_1.STREAM_MAX_BYTES)
            throw new Error('Inspector stream packet exceeds the packet limit.');
        this.pending = { packet, body, after };
        return this.pending;
    }
    /** A receiver restart replays only the collector's current bounded history in a fresh stream. */
    acknowledge(ack) {
        if (ack?.ok === false && ack.reset === true) {
            this.pending = undefined;
            this.cursor = undefined;
            this.sequence = 1;
            this.streamId = this.newStreamId();
            return false;
        }
        if (!this.pending || ack?.ok !== true || ack.streamId !== this.pending.packet.streamId || ack.sequence !== this.pending.packet.sequence) {
            throw new Error('Inspector stream ACK does not match the pending packet.');
        }
        this.cursor = this.pending.after;
        this.sequence++;
        this.pending = undefined;
        return true;
    }
}
exports.IncrementalStreamSender = IncrementalStreamSender;

},
"src/shared/stream.ts": function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STREAM_MAX_SNAPSHOT_DETAILS = exports.STREAM_MAX_RECORDS = exports.STREAM_MAX_BYTES = exports.STREAM_VERSION = void 0;
/** Independent from the offline report schema: live packets carry only new records. */
exports.STREAM_VERSION = 1;
exports.STREAM_MAX_BYTES = 256 * 1024;
exports.STREAM_MAX_RECORDS = 256;
exports.STREAM_MAX_SNAPSHOT_DETAILS = 10000;

}};
    var cache = Object.create(null);
    function load(id){
      if (cache[id]) return cache[id].exports;
      var module = cache[id] = { exports: {} };
      modules[id](function(name){
        if (name === 'cc') return cc;
        var parts = id.split('/'); parts.pop();
        name.split('/').forEach(function(p){ if(p === '..') parts.pop(); else if(p !== '.') parts.push(p); });
        return load(parts.join('/') + '.ts');
      }, module, module.exports);
      return module.exports;
    }
    load("runtime/AutoPreview.ts").startAutoPreview(configUrl);
  }).catch(function(error){ console.warn('[性能监控] 自动接入失败', error); });
})();
