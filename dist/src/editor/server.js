"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InspectorServer = exports.MAX_BODY_BYTES = void 0;
const http = __importStar(require("http"));
const crypto_1 = require("crypto");
const stream_1 = require("../shared/stream");
const analyzer_1 = require("../core/analyzer");
const validation_1 = require("../core/validation");
exports.MAX_BODY_BYTES = 12 * 1024 * 1024;
class InspectorServer {
    constructor() {
        this.token = (0, crypto_1.randomBytes)(24).toString('hex');
        this.endpoint = '';
        this.error = '';
        this.sessions = new Map();
        this.commands = new Map();
        this.selected = '';
        this.selectNextRuntime = false;
        this.epoch = 0;
    }
    async start() {
        if (this.server)
            return;
        const epoch = ++this.epoch;
        const server = http.createServer((req, res) => this.handle(req, res));
        this.server = server;
        server.requestTimeout = 10000;
        server.headersTimeout = 10000;
        server.maxConnections = 12;
        server.on('error', err => { this.error = err.message; });
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', () => {
                server.removeListener('error', reject);
                if (epoch !== this.epoch) {
                    server.close();
                    resolve();
                    return;
                }
                const address = server.address();
                if (address && typeof address !== 'string')
                    this.endpoint = `http://127.0.0.1:${address.port}`;
                resolve();
            });
        });
    }
    stop() {
        ++this.epoch;
        this.server?.close();
        this.server?.closeAllConnections?.();
        this.server = undefined;
        this.endpoint = '';
        this.sessions.clear();
        this.commands.clear();
        this.selected = '';
        this.selectNextRuntime = false;
    }
    retain(id, session) {
        const isNew = !this.sessions.has(id);
        if (isNew && this.sessions.size >= 5) {
            const oldest = this.sessions.keys().next().value;
            this.sessions.delete(oldest);
            this.commands.delete(oldest);
        }
        this.sessions.set(id, session);
        if (this.selectNextRuntime && isNew && !session.imported) {
            this.selected = id;
            this.selectNextRuntime = false;
        }
        if (!this.selected || !this.sessions.has(this.selected) || session.imported)
            this.selected = id;
    }
    ingest(input, imported = false) {
        const report = (0, validation_1.validateReport)(input);
        const id = imported ? `import:${report.session.id}` : report.session.id;
        const previous = this.sessions.get(id);
        const samplesRemoved = Math.max(0, report.samples.length - report.config.maxSamples);
        const eventsRemoved = Math.max(0, report.resourceEvents.length - report.config.maxEvents);
        const snapshotsRemoved = Math.max(0, report.snapshots.length - 10);
        report.samples = report.samples.slice(samplesRemoved);
        report.resourceEvents = report.resourceEvents.slice(eventsRemoved);
        report.snapshots = report.snapshots.slice(snapshotsRemoved);
        report.dropped.samples += samplesRemoved;
        report.dropped.events += eventsRemoved;
        report.dropped.snapshots += snapshotsRemoved;
        this.retain(id, { report, receivedAt: Date.now(), imported, revision: (previous?.revision || 0) + 1,
            sampleResetRevision: (previous?.revision || 0) + 1,
            sampleStart: report.dropped.samples, sampleNext: report.dropped.samples + report.samples.length,
            eventStart: report.dropped.events, eventNext: report.dropped.events + report.resourceEvents.length,
            resourceRevision: (previous?.resourceRevision || 0) + 1,
            analysisDirty: !!(samplesRemoved || eventsRemoved || snapshotsRemoved), retiredStreams: previous?.retiredStreams || [] });
        return id;
    }
    /** A packet is validated and planned in full before any session data changes. */
    ingestStream(input) {
        const packet = (0, validation_1.validateStreamPacket)(input);
        const previous = this.sessions.get(packet.session.id);
        const matching = previous?.stream?.id === packet.streamId;
        if (matching && packet.sequence <= previous.stream.sequence) {
            previous.receivedAt = Date.now();
            return { ok: true, streamId: packet.streamId, sequence: packet.sequence };
        }
        if ((matching && packet.sequence !== previous.stream.sequence + 1) || (!matching && packet.sequence !== 1) ||
            (!matching && previous?.retiredStreams.includes(packet.streamId)))
            return { ok: false, reset: true };
        let session;
        if (matching) {
            session = previous;
            const before = session.report;
            if (before.session.startedAt !== packet.session.startedAt || before.session.engine !== packet.session.engine ||
                before.session.platform !== packet.session.platform || JSON.stringify(before.config) !== JSON.stringify(packet.config) ||
                Date.parse(packet.session.endedAt) < Date.parse(before.session.endedAt))
                throw new Error('流会话元数据发生无效变更');
        }
        else {
            const retiredStreams = previous?.retiredStreams.slice(-7) || [];
            if (previous?.stream)
                retiredStreams.push(previous.stream.id);
            session = { report: this.emptyReport(packet), receivedAt: 0, imported: false,
                revision: previous?.revision || 0, sampleResetRevision: (previous?.revision || 0) + 1,
                sampleStart: packet.samples.start, sampleNext: packet.samples.start,
                eventStart: packet.resourceEvents.start, eventNext: packet.resourceEvents.start,
                resourceRevision: previous?.resourceRevision || 0, analysisDirty: true, retiredStreams,
                stream: { id: packet.streamId, sequence: 0, snapshotIndex: -1 } };
        }
        const samples = this.planRange(packet.samples, session.sampleNext);
        const events = this.planRange(packet.resourceEvents, session.eventNext);
        const retainedSamples = session.report.samples;
        if (!samples.reset && samples.values.length && retainedSamples.length && samples.values[0].time < retainedSamples[retainedSamples.length - 1].time)
            throw new Error('采样时间必须递增');
        const snapshot = packet.snapshot ? this.planSnapshot(session, packet.snapshot) : undefined;
        // All checks above are read-only. From here the update is committed atomically.
        session.report.session = packet.session;
        session.report.capabilities = packet.capabilities;
        session.report.dropped = packet.dropped;
        session.receivedAt = Date.now();
        session.revision++;
        session.stream.sequence = packet.sequence;
        if (samples.reset) {
            session.report.samples = [];
            session.sampleStart = samples.start;
            session.sampleResetRevision = session.revision;
        }
        session.report.samples.push(...samples.values);
        session.sampleNext = samples.next;
        const sampleTrim = Math.max(0, session.report.samples.length - packet.config.maxSamples);
        if (sampleTrim) {
            session.report.samples.splice(0, sampleTrim);
            session.sampleStart += sampleTrim;
        }
        if (events.reset) {
            session.report.resourceEvents = [];
            session.eventStart = events.start;
        }
        session.report.resourceEvents.push(...events.values);
        session.eventNext = events.next;
        const eventTrim = Math.max(0, session.report.resourceEvents.length - packet.config.maxEvents);
        if (eventTrim) {
            session.report.resourceEvents.splice(0, eventTrim);
            session.eventStart += eventTrim;
        }
        if (events.values.length || events.reset || !matching)
            session.resourceRevision++;
        if (snapshot) {
            const { partial, chunk } = snapshot;
            partial.snapshot.objects.push(...chunk.objects);
            partial.snapshot.assets.push(...chunk.assets);
            for (const item of chunk.objects)
                partial.objectIds.add(item.id);
            for (const item of chunk.assets)
                partial.assetIds.add(item.id);
            session.stream.snapshotIndex = chunk.index;
            if (snapshot.complete) {
                session.report.snapshots.push(partial.snapshot);
                if (session.report.snapshots.length > 10)
                    session.report.snapshots.shift();
                session.stream.partial = undefined;
            }
            else
                session.stream.partial = partial;
        }
        session.analysisDirty || (session.analysisDirty = !!(samples.values.length || samples.reset || events.values.length || events.reset || snapshot?.complete));
        this.retain(packet.session.id, session);
        return { ok: true, streamId: packet.streamId, sequence: packet.sequence };
    }
    emptyReport(packet) {
        return { schemaVersion: 1, session: packet.session, config: packet.config, samples: [], resourceEvents: [], snapshots: [],
            findings: [], capabilities: packet.capabilities, dropped: packet.dropped };
    }
    planRange(range, next) {
        if (range.start > next)
            return { start: range.start, next: range.start + range.values.length, values: range.values, reset: true };
        const overlap = Math.min(range.values.length, next - range.start);
        return { start: next, next: Math.max(next, range.start + range.values.length), values: range.values.slice(overlap), reset: false };
    }
    planSnapshot(session, chunk) {
        const stream = session.stream;
        let partial = stream.partial;
        const fresh = !partial || partial.index !== chunk.index;
        if (fresh) {
            if (chunk.index <= stream.snapshotIndex || chunk.objectOffset || chunk.assetOffset)
                throw new Error('快照分块乱序');
            const last = session.report.snapshots[session.report.snapshots.length - 1];
            if ((last && chunk.time < last.time) || session.report.snapshots.some(s => s.id === chunk.id))
                throw new Error('快照时间或 ID 无效');
            partial = { index: chunk.index, snapshot: { id: chunk.id, label: chunk.label, time: chunk.time, scene: chunk.scene,
                    counts: chunk.counts, truncated: chunk.truncated, objects: [], assets: [] }, objectTotal: chunk.objectTotal, assetTotal: chunk.assetTotal,
                objectIds: new Set(), assetIds: new Set() };
        }
        else {
            const old = partial;
            if (chunk.id !== old.snapshot.id || chunk.label !== old.snapshot.label || chunk.time !== old.snapshot.time ||
                chunk.scene !== old.snapshot.scene || chunk.truncated !== old.snapshot.truncated || chunk.objectTotal !== old.objectTotal ||
                chunk.assetTotal !== old.assetTotal || JSON.stringify(chunk.counts) !== JSON.stringify(old.snapshot.counts))
                throw new Error('快照分块元数据不一致');
        }
        const result = partial;
        if (chunk.objectOffset !== result.snapshot.objects.length || chunk.assetOffset !== result.snapshot.assets.length)
            throw new Error('快照分块偏移不连续');
        if (chunk.objects.some(o => result.objectIds.has(o.id)) || chunk.assets.some(a => result.assetIds.has(a.id)))
            throw new Error('快照明细 ID 重复');
        return { partial: result, chunk, fresh, complete: chunk.objectOffset + chunk.objects.length === chunk.objectTotal && chunk.assetOffset + chunk.assets.length === chunk.assetTotal };
    }
    select(id) { if (!this.sessions.has(id))
        throw new Error('会话不存在'); this.selected = id; }
    followNextRuntime() { this.selectNextRuntime = true; }
    clear() { this.sessions.delete(this.selected); this.commands.delete(this.selected); this.selected = this.sessions.keys().next().value || ''; }
    analysis(session) {
        if (session.analysisDirty) {
            session.report.findings = (0, analyzer_1.analyzeReport)(session.report);
            session.analysisDirty = false;
        }
        return session.report;
    }
    getReport() { const s = this.sessions.get(this.selected); if (!s)
        throw new Error('暂无报告，请先运行预览或导入 JSON'); return this.analysis(s); }
    getSnapshot(id) {
        const snapshot = this.sessions.get(this.selected)?.report.snapshots.find(s => s.id === id);
        if (!snapshot)
            throw new Error('快照不存在或已被淘汰');
        return snapshot;
    }
    getResourceEvents(cursor) {
        const s = this.sessions.get(this.selected);
        if (!s)
            return { start: 0, next: 0, end: 0, reset: true, total: 0, events: [] };
        const valid = Number.isInteger(cursor) && cursor >= s.eventStart && cursor <= s.eventNext;
        const start = valid ? cursor : s.eventStart;
        const events = s.report.resourceEvents.slice(start - s.eventStart, start - s.eventStart + stream_1.STREAM_MAX_RECORDS);
        return { start, next: start + events.length, end: s.eventNext, reset: !valid, total: s.report.resourceEvents.length, events };
    }
    requestSnapshot(label) {
        const s = this.sessions.get(this.selected);
        if (!s || s.imported || Date.now() - s.receivedAt > 15000)
            throw new Error('请选择在线运行时会话');
        const queue = this.commands.get(this.selected) || [];
        if (queue.length >= 8)
            throw new Error('快照请求过多，请稍候');
        queue.push({ type: 'snapshot', label: String(label || '手动快照').slice(0, 120) });
        this.commands.set(this.selected, queue);
    }
    state(cursor) {
        const session = this.sessions.get(this.selected);
        const state = {
            endpoint: this.endpoint, token: this.token, error: this.error, selected: this.selected, revision: session?.revision || 0,
            sessions: [...this.sessions].map(([id, s]) => ({ id, engine: s.report.session.engine,
                platform: s.report.session.platform, receivedAt: s.receivedAt, imported: s.imported,
                online: !s.imported && Date.now() - s.receivedAt < 15000 })),
        };
        if (!session)
            return { ...state, report: null };
        if (cursor?.sessionId === this.selected && cursor.revision === session.revision)
            return state;
        const report = this.analysis(session);
        const offset = cursor?.sampleOffset;
        const valid = cursor?.sessionId === this.selected && Number.isInteger(cursor.revision) && cursor.revision >= session.sampleResetRevision &&
            Number.isInteger(offset) && offset >= session.sampleStart &&
            offset <= session.sampleNext && session.sampleNext - offset <= 240;
        const start = valid ? offset : Math.max(session.sampleStart, session.sampleNext - 240);
        return { ...state, report: { schemaVersion: 1, session: report.session, config: report.config, capabilities: report.capabilities,
                dropped: report.dropped, findings: report.findings, samples: report.samples.slice(start - session.sampleStart),
                samplesStart: start, samplesNext: session.sampleNext, samplesReset: !valid, sampleCount: report.samples.length,
                snapshots: report.snapshots.map(({ objects, assets, ...summary }) => ({ ...summary, objectCount: objects.length, assetCount: assets.length })),
                resourceEventCount: report.resourceEvents.length, resourceRevision: session.resourceRevision } };
    }
    handle(req, res) {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        const origin = req.headers.origin;
        if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) {
            res.writeHead(403);
            res.end('Origin forbidden');
            return;
        }
        if (origin) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Vary', 'Origin');
        }
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Inspector-Token');
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }
        let url;
        try {
            url = new URL(req.url || '/', 'http://127.0.0.1');
        }
        catch {
            res.writeHead(400);
            res.end();
            return;
        }
        const raw = req.headers['x-inspector-token'];
        const token = typeof raw === 'string' ? raw : url.searchParams.get('token') || '';
        const bytes = Buffer.from(token);
        if (bytes.length !== this.token.length || !(0, crypto_1.timingSafeEqual)(bytes, Buffer.from(this.token))) {
            res.writeHead(401);
            res.end('Invalid token');
            return;
        }
        const json = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
        if (req.method === 'GET' && url.pathname === '/commands') {
            const id = url.searchParams.get('session') || '';
            const commands = this.commands.get(id) || [];
            this.commands.delete(id);
            json(200, { commands });
            return;
        }
        if (req.method !== 'POST' || !['/report', '/stream'].includes(url.pathname)) {
            json(404, { error: 'Not found' });
            return;
        }
        const stream = url.pathname === '/stream';
        const limit = stream ? stream_1.STREAM_MAX_BYTES : exports.MAX_BODY_BYTES;
        const chunks = [];
        let size = 0;
        let rejected = false;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > limit) {
                if (!rejected) {
                    rejected = true;
                    chunks.length = 0;
                    json(413, { error: stream ? '增量数据超过 256 KiB' : '报告超过 12 MiB' });
                }
                return;
            }
            if (!rejected)
                chunks.push(chunk);
        });
        req.on('error', () => { if (!res.writableEnded)
            res.end(); });
        req.on('end', () => {
            if (rejected)
                return;
            try {
                const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                if (stream)
                    json(200, this.ingestStream(input));
                else
                    json(200, { ok: true, session: this.ingest(input) });
            }
            catch (err) {
                json(400, { error: err instanceof Error ? err.message : '无效报告' });
            }
        });
    }
}
exports.InspectorServer = InspectorServer;
//# sourceMappingURL=server.js.map