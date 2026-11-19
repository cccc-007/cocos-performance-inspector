'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ResultStore } = require('../lib/model');
const { htmlReport, writeReport } = require('../lib/report');
function fixture() {
    const assets = ['image', 'image@frame', 'prefab', 'scene', 'other'].map(uuid => ({ uuid, url: `db://assets/${uuid}`, name: uuid, type: 'test', size: 1, dependencies: [] }));
    const references = [
        ['prefab', 'image@frame'], ['scene', 'prefab'], ['prefab', 'scene'], ['other', 'image@frame'],
    ].map(([sourceUuid, targetUuid], index) => ({ id: String(index), sourceUuid, targetUuid, sourceUrl: `db://assets/${sourceUuid}`, kind: 'serialized', property: 'spriteFrame' }));
    return { version: 1, projectPath: 'fixture', scannedAt: '2026-11-18T00:00:00.000Z', assets, references, issues: [], summary: { assets: 5 }, limitations: [] };
}
test('deleting an image includes users of its subassets and transitive cycles terminate', () => {
    const store = new ResultStore(fixture());
    const impact = store.getImpact({ uuid: 'image' });
    assert.deepEqual(impact.direct.map(value => value.uuid).sort(), ['other', 'prefab']);
    assert.deepEqual(impact.transitive.map(value => value.uuid), ['scene']);
    assert.equal(impact.truncated, false);
    assert.match(impact.caveat, /动态加载/);
    assert.equal(store.queryReferences({ uuid: 'image', direction: 'incoming' }).total, 2);
    assert.equal(store.queryReferences({ uuid: 'prefab', direction: 'outgoing' }).total, 2);
});
test('pagination bounds IPC records and search matches UUID and paths', () => {
    const result = fixture();
    result.assets.push(...Array.from({ length: 400 }, (_, i) => ({ uuid: `id-${i}`, url: `db://assets/folder/${i}`, name: `file-${i}`, type: 'image' })));
    result.issues.push({ id: '1', severity: 'error', code: 'MISSING_ASSET', message: '丢失引用', sourceUrl: 'db://assets/example.prefab', nodePath: 'Canvas/Button' });
    const store = new ResultStore(result);
    assert.equal(store.queryAssets({ pageSize: 100000 }).items.length, 200);
    assert.equal(store.queryAssets({ query: 'id-399' }).total, 1);
    assert.equal(store.queryIssues({ query: 'button', severity: 'error' }).total, 1);
    assert.equal(store.queryIssues({ severity: 'warning' }).total, 0);
    assert.equal(store.queryAssets({ page: 1000, pageSize: 200 }).page, 3);
});
test('impact propagates from an affected imported subasset through its physical parent', () => {
    const result = fixture();
    result.assets = ['texture', 'atlas', 'atlas@frame', 'prefab'].map(uuid => ({ uuid, url: `db://assets/${uuid}`, name: uuid }));
    result.references = [{ sourceUuid: 'atlas@frame', targetUuid: 'texture' }, { sourceUuid: 'prefab', targetUuid: 'atlas' }];
    const impact = new ResultStore(result).getImpact({ uuid: 'texture' });
    assert.deepEqual(impact.direct.map(item => item.uuid), ['atlas']);
    assert.deepEqual(impact.transitive.map(item => item.uuid), ['prefab']);
});
test('HTML export escapes project data and JSON retains full scan result', () => {
    const result = fixture();
    result.projectPath = '<script>alert(1)</script>';
    result.issues.push({ severity: 'error', message: '<img src=x onerror=alert(1)>', code: 'BAD', sourceUrl: '&' });
    const html = htmlReport(result, true);
    assert.ok(!html.includes('<script>'));
    assert.ok(!html.includes('<img src=x'));
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /资源已发生变化/);
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'resource-report-test-'));
    try {
        const output = writeReport(temporary, result, 'json', true);
        const parsed = JSON.parse(fs.readFileSync(output.path, 'utf8'));
        assert.equal(path.dirname(output.path), path.join(temporary, 'RIReports'));
        assert.deepEqual(parsed.references, result.references);
        assert.equal(parsed.staleAtExport, true);
        assert.throws(() => writeReport(temporary, result, '../bad'), /仅支持/);
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});
