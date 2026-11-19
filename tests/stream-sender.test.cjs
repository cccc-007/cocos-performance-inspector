const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename);
const { IncrementalStreamSender } = require('../runtime/streamSender.ts');
const { DEFAULT_CONFIG } = require('../src/shared/model.ts');
const { STREAM_MAX_BYTES } = require('../src/shared/stream.ts');

function source() {
    return {
        session: { id: 'runtime-test', startedAt: new Date(0).toISOString(), endedAt: new Date(1).toISOString(), engine: '3.8.3', platform: 'test' },
        config: { ...DEFAULT_CONFIG }, capabilities: [], dropped: { samples: 0, events: 0, objects: 0, snapshots: 0 },
        samples: [], resourceEvents: [], snapshots: [],
    };
}
function sample(time) {
    return { time, scene: 'scene', nodes: 1, components: 0, assets: 0, tweens: 0, listeners: 0, fps: 60, frameMs: 16.7,
        p95Ms: 17, maxFrameMs: 18, slowFrames: 0, heapBytes: null, drawCalls: null, textureBytes: null, bufferBytes: null };
}
function acknowledge(sender, packet) { sender.acknowledge({ ok: true, streamId: packet.streamId, sequence: packet.sequence }); }

test('snapshot chunks send every object and asset once, with bounded UTF-8 packets and live samples', () => {
    const value = source();
    value.samples.push(sample(1));
    value.resourceEvents.push({ time: 1, operation: 'load', key: 'new' });
    value.snapshots.push({ id: 'snapshot', label: 'large', time: 1, scene: 'scene',
        counts: { nodes: 600, components: 0, assets: 300, tweens: 0, listeners: 0 }, truncated: false,
        objects: Array.from({ length: 600 }, (_, index) => ({ id: `node:${index}`, kind: 'node', label: '节点',
            createdAt: 0, lastSeenAt: 1, stack: '中文调用栈'.repeat(200) })),
        assets: Array.from({ length: 300 }, (_, index) => ({ id: `asset:${index}`, name: '资源', type: 'Texture', refCount: 1 })),
    });
    const original = JSON.stringify(value);
    const sender = new IncrementalStreamSender(() => value);
    const objects = [], assets = [], samples = [], events = [];
    let count = 0, objectOffset = 0, assetOffset = 0;
    for (let prepared; (prepared = sender.nextPacket());) {
        const { packet, body } = prepared;
        assert.ok(Buffer.byteLength(body) <= STREAM_MAX_BYTES);
        assert.equal(body, JSON.stringify(packet));
        assert.ok(packet.samples.values.length <= 256 && packet.resourceEvents.values.length <= 256);
        assert.ok(packet.snapshot.objects.length + packet.snapshot.assets.length <= 256);
        assert.equal(packet.snapshot.objectOffset, objectOffset);
        assert.equal(packet.snapshot.assetOffset, assetOffset);
        objects.push(...packet.snapshot.objects); objectOffset += packet.snapshot.objects.length;
        assets.push(...packet.snapshot.assets); assetOffset += packet.snapshot.assets.length;
        samples.push(...packet.samples.values); events.push(...packet.resourceEvents.values);
        if (!count) assert.equal(packet.samples.values.length, 1, 'large snapshot cannot starve the live sample');
        acknowledge(sender, packet); assert.ok(++count < 100);
    }
    assert.ok(count > 1);
    assert.deepEqual(objects.map(x => x.id), value.snapshots[0].objects.map(x => x.id));
    assert.deepEqual(assets.map(x => x.id), value.snapshots[0].assets.map(x => x.id));
    assert.equal(samples.length, 1); assert.equal(events.length, 1);
    assert.equal(sender.hasPendingData(), false);
    assert.equal(JSON.stringify(value), original);
    const heartbeat = sender.nextPacket(true);
    assert.equal(heartbeat.packet.snapshot, undefined);
    assert.equal(heartbeat.packet.samples.values.length, 0);
    acknowledge(sender, heartbeat.packet);
    assert.equal(sender.nextPacket(), undefined);
});

test('pending packets retry byte-for-byte, ACKs commit cursors, and receiver reset replays bounded history', () => {
    const value = source(); value.samples.push(sample(1));
    const sender = new IncrementalStreamSender(() => value);
    const first = sender.nextPacket();
    value.samples.push(sample(2)); value.session.endedAt = new Date(2).toISOString();
    assert.equal(sender.nextPacket(), first);
    assert.throws(() => sender.acknowledge({ ok: true, streamId: first.packet.streamId, sequence: 99 }), /ACK/);
    assert.equal(sender.nextPacket().body, first.body);
    acknowledge(sender, first.packet);
    const second = sender.nextPacket();
    assert.equal(second.packet.samples.start, 1);
    assert.deepEqual(second.packet.samples.values.map(x => x.time), [2]);
    assert.equal(sender.acknowledge({ ok: false, reset: true }), false);
    const replay = sender.nextPacket();
    assert.notEqual(replay.packet.streamId, first.packet.streamId);
    assert.equal(replay.packet.sequence, 1);
    assert.deepEqual(replay.packet.samples.values.map(x => x.time), [1, 2]);
    acknowledge(sender, replay.packet);
    assert.equal(sender.nextPacket(), undefined);
});

test('collector eviction advances absolute ranges and skips evicted incomplete snapshots without extra history', () => {
    const value = source(); value.samples.push(sample(0));
    value.snapshots.push({ id: 'old', label: '', time: 0, scene: '', counts: { nodes: 300, components: 0, assets: 0, tweens: 0, listeners: 0 },
        objects: Array.from({ length: 300 }, (_, i) => ({ id: `n${i}`, kind: 'node', label: '', createdAt: 0, lastSeenAt: 0 })), assets: [], truncated: false });
    const sender = new IncrementalStreamSender(() => value);
    const pending = sender.nextPacket();
    value.samples = [sample(100)]; value.dropped.samples = 100;
    value.dropped.snapshots = 1;
    value.snapshots = [{ ...value.snapshots[0], id: 'new', objects: [], counts: { ...value.snapshots[0].counts, nodes: 0 } }];
    acknowledge(sender, pending.packet);
    const next = sender.nextPacket();
    assert.equal(next.packet.samples.start, 100);
    assert.equal(next.packet.snapshot.index, 1);
    assert.equal(next.packet.snapshot.objectOffset, 0);
    assert.equal(next.packet.snapshot.id, 'new');
    acknowledge(sender, next.packet);
    assert.equal(sender.hasPendingData(), false);
});

test('large valid Unicode and escaped events exceed fairness shares but still advance within the whole packet limit', () => {
    const { validateStreamPacket } = require('../src/core/validation.ts');
    const value = source();
    value.samples = Array.from({ length: 25 }, (_, i) => ({ ...sample(i), scene: '界'.repeat(2048) }));
    const large = character => ({ time: 1, operation: 'error', key: character.repeat(8192),
        type: 'loadAny', stack: character.repeat(16384), details: character.repeat(8192) });
    value.resourceEvents.push(large('界'), large('\u0000'), { time: 2, operation: 'load', key: 'small' });
    value.snapshots.push({ id: 'empty', label: '', time: 1, scene: '', counts: { nodes: 0, components: 0, assets: 0, tweens: 0, listeners: 0 },
        objects: [], assets: [], truncated: false });
    const sender = new IncrementalStreamSender(() => value);
    const samples = [], events = [], snapshots = [];
    let count = 0;
    while (sender.hasPendingData()) {
        const prepared = sender.nextPacket(true);
        assert.ok(prepared, 'every pending iteration produces a packet');
        assert.ok(Buffer.byteLength(prepared.body) <= STREAM_MAX_BYTES);
        assert.doesNotThrow(() => validateStreamPacket(prepared.packet));
        if (count < 2) {
            assert.equal(prepared.packet.samples.values.length, 0, 'large event receives a packet without competing samples');
            assert.equal(prepared.packet.snapshot, undefined);
            assert.equal(prepared.packet.resourceEvents.values.length, 1);
            assert.ok(Buffer.byteLength(JSON.stringify(prepared.packet.resourceEvents.values[0])) > 64 * 1024);
        }
        samples.push(...prepared.packet.samples.values); events.push(...prepared.packet.resourceEvents.values);
        if (prepared.packet.snapshot) snapshots.push(prepared.packet.snapshot.id);
        assert.ok(prepared.packet.samples.values.length || prepared.packet.resourceEvents.values.length || prepared.packet.snapshot,
            'pending records must not result in an empty successful heartbeat');
        acknowledge(sender, prepared.packet);
        assert.ok(++count < 10, 'drain completes in a bounded number of packets');
    }
    assert.deepEqual(samples, value.samples); assert.deepEqual(events, value.resourceEvents);
    assert.deepEqual(snapshots, ['empty']);
    assert.equal(sender.nextPacket(), undefined);
});

test('a record exceeding the whole packet budget fails explicitly instead of producing empty heartbeats', () => {
    const value = source(); value.resourceEvents.push({ time: 1, operation: 'error', key: 'too-large', stack: '界'.repeat(STREAM_MAX_BYTES) });
    const sender = new IncrementalStreamSender(() => value);
    assert.equal(sender.hasPendingData(), true);
    assert.throws(() => sender.nextPacket(), /record exceeds the packet limit/);
    assert.throws(() => sender.nextPacket(true), /record exceeds the packet limit/);
});
