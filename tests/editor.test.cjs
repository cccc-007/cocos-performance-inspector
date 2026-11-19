const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

test('extension auto preview requires no project SDK and stores reports and settings inside the extension', async t => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'cocos-inspector-test-'));
    const extension = path.join(project, 'extensions', 'cocos-performance-inspector');
    const directory = path.join(extension, 'PITemp');
    fs.mkdirSync(extension, { recursive: true });
    const input = JSON.parse(fs.readFileSync(path.join(__dirname, '../examples/demo-report.json'), 'utf8'));
    const imported = path.join(project, 'input.json'); fs.writeFileSync(imported, JSON.stringify(input));
    global.Editor = { Project: { path: project }, Panel: { define: options => options },
        Message: { request: async () => {} }, Dialog: { select: async options => {
            assert.equal(options.path, directory);
            return { canceled: false, filePaths: [imported] };
        },
            save: () => { throw new Error('exports must not prompt for a path'); } } };
    t.after(() => { delete global.Editor; fs.rmSync(project, { recursive: true, force: true }); });
    const panel = require('../dist/src/panels/default');
    assert.ok(panel.template.includes('对象与快照'));
    assert.ok(panel.style.includes('.metrics'));
    assert.ok(!panel.template.includes('id="install"'));
    assert.ok(!panel.template.includes('id="token"'));
    delete require.cache[require.resolve('../dist/src/main')];
    const main = require('../dist/src/main'); t.after(() => main.unload());
    await main.load();
    const config = await main.methods.getPreviewConfig();
    assert.match(config.endpoint, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(config.token.length, 48);
    assert.equal(config.captureStacks, false);
    assert.equal(main.methods.getState().outputDirectory, directory);
    assert.equal(fs.existsSync(path.join(project, 'assets')), false);
    assert.equal(fs.existsSync(path.join(project, 'preview-template')), false);
    await main.methods.importReport();
    for (const format of ['html', 'json']) assert.match(await main.methods.exportReport(format), /PITemp/);
    const exports = fs.readdirSync(directory);
    assert.equal(exports.length, 2);
    assert.equal(exports.filter(f => f.endsWith('.html')).length, 1);
    const json = JSON.parse(fs.readFileSync(path.join(directory, exports.find(f => f.endsWith('.json'))), 'utf8'));
    assert.equal(json.session.id, input.session.id);
    await assert.rejects(main.methods.exportReport('../bad'), /格式/);
    main.methods.configureCapture({ sampleIntervalMs: 1500, captureStacks: true });
    assert.equal(main.methods.getState().capture.captureStacks, true);
    assert.equal((await main.methods.getPreviewConfig()).sampleIntervalMs, 1500);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'capture-settings.json'), 'utf8')).captureStacks, true);
    assert.throws(() => main.methods.configureCapture({ sampleIntervalMs: 1, captureStacks: true }), /250/);
    main.unload();
    await assert.rejects(main.methods.getPreviewConfig(), /停用/);
    await main.load();
    assert.equal((await main.methods.getPreviewConfig()).captureStacks, true);
    assert.equal(fs.existsSync(path.join(project, 'PITemp')), false);
});
