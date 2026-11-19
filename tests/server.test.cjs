const { test } = require('node:test');
const assert = require('node:assert/strict');
const { InspectorServer, MAX_BODY_BYTES } = require('../dist/src/editor/server');
const { DEFAULT_CONFIG } = require('../dist/src/shared/model');

function report(id = 'test') {
    return { schemaVersion: 1, session: { id, startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:00:00Z', engine: '3.8.3', platform: 'test' },
        config: { ...DEFAULT_CONFIG }, samples: [], snapshots: [], resourceEvents: [], findings: [], capabilities: [],
        dropped: { samples: 0, events: 0, objects: 0, snapshots: 0 } };
}
test('loopback receiver authenticates, validates reports, and delivers snapshot commands once', async t => {
    const server = new InspectorServer(); await server.start(); t.after(() => server.stop());
    const headers = { 'X-Inspector-Token': server.token, 'Content-Type': 'application/json', Origin: 'http://localhost:7456' };
    const denied = await fetch(server.endpoint + '/report', { method: 'POST', body: '{}' });
    assert.equal(denied.status, 401);
    const preflight = await fetch(server.endpoint + '/report', { method: 'OPTIONS', headers: { Origin: 'http://localhost:7456', 'Access-Control-Request-Headers': 'X-Inspector-Token' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://localhost:7456');
    const badOrigin = await fetch(server.endpoint + '/report', { method: 'POST', headers: { ...headers, Origin: 'https://untrusted.example' }, body: '{}' });
    assert.equal(badOrigin.status, 403);
    const invalid = await fetch(server.endpoint + '/report', { method: 'POST', headers, body: '{"schemaVersion":2}' });
    assert.equal(invalid.status, 400);
    const ok = await fetch(server.endpoint + '/report', { method: 'POST', headers, body: JSON.stringify(report()) });
    assert.equal(ok.status, 200);
    assert.equal(server.state().sessions[0].online, true);
    server.requestSnapshot('业务关闭后');
    const get = () => fetch(server.endpoint + '/commands?session=test&token=' + server.token).then(r => r.json());
    assert.deepEqual(await get(), { commands: [{ type: 'snapshot', label: '业务关闭后' }] });
    assert.deepEqual(await get(), { commands: [] });
});
test('imported reports recompute findings, reject online commands and session retention stays bounded', () => {
    const server = new InspectorServer();
    const input = report(); input.findings = [{ title: 'untrusted finding' }];
    server.ingest(input, true);
    assert.equal(server.state().selected, 'import:test');
    assert.deepEqual(server.getReport().findings, []);
    assert.throws(() => server.requestSnapshot('x'), /在线/);
    for (let i = 0; i < 10; i++) server.ingest(report(String(i)));
    assert.equal(server.state().sessions.length, 5);
    assert.ok(server.state().sessions.some(s => s.id === server.state().selected));
    server.clear(); assert.equal(server.state().sessions.length, 4);
    assert.throws(() => server.select('missing'), /不存在/);
    server.stop(); assert.equal(server.state().sessions.length, 0);
});
test('HTTP payload cap rejects oversized content without parsing it', async t => {
    const server = new InspectorServer(); await server.start(); t.after(() => server.stop());
    const response = await fetch(server.endpoint + '/report', { method: 'POST', headers: { 'X-Inspector-Token': server.token }, body: 'x'.repeat(MAX_BODY_BYTES + 1) });
    assert.equal(response.status, 413);
    assert.equal(server.state().sessions.length, 0);
});

test('changing capture settings follows the next new runtime without discarding the old report', () => {
    const server = new InspectorServer();
    server.ingest(report('old'));
    server.followNextRuntime();
    server.ingest(report('old'));
    assert.equal(server.state().selected, 'old');
    server.ingest(report('new'));
    assert.equal(server.state().selected, 'new');
    assert.equal(server.state().sessions.length, 2);
    server.select('old');
    assert.equal(server.getReport().session.id, 'old');
    server.stop();
});
