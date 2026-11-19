'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../.work/cocos-resource-inspector');

class Element {
  constructor(tag, doc) { this.tagName = tag; this.ownerDocument = doc; this.childNodes = []; this.listeners = new Map(); this.dataset = {}; this.attributes = {}; this.value = ''; this._text = ''; this.className = ''; this.disabled = false; this.hidden = false; this.classList = { toggle: (name, force) => { const parts = new Set(this.className.split(/\s+/).filter(Boolean)); const next = force === undefined ? !parts.has(name) : force; if (next) parts.add(name); else parts.delete(name); this.className = [...parts].join(' '); return next; } }; }
  set textContent(value) { this.childNodes = []; this._text = String(value); }
  get textContent() { return this._text + this.childNodes.map(item => item.textContent).join(''); }
  append(...items) { for (const item of items) { if (item.tagName === '#fragment') this.append(...item.childNodes); else { item.parentNode = this; this.childNodes.push(item); } } }
  replaceChildren(...items) { this._text = ''; this.childNodes = []; this.append(...items); }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(listener); }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  dispatch(type) { if (this.disabled && type === 'click') return; for (const handler of this.listeners.get(type) || []) handler({ stopPropagation() {} }); }
  all() { return this.childNodes.flatMap(node => [node, ...node.all()]); }
  querySelectorAll(selector) { return this.all().filter(node => selector.startsWith('.') ? node.className.split(/\s+/).includes(selector.slice(1)) : selector === '[data-tab]' ? !!node.dataset.tab : selector.startsWith('#') ? node.id === selector.slice(1) : node.tagName === selector); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
const doc = { createElement: tag => new Element(tag, doc), createDocumentFragment: () => new Element('#fragment', doc), createTextNode: text => { const node = new Element('#text', doc); node.textContent = text; return node; } };
const app = new Element('div', doc);
for (const match of fs.readFileSync(path.join(root, 'static/panel.html'), 'utf8').matchAll(/<([a-z]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
  if (match[3] === 'app') continue;
  const node = doc.createElement(match[1]); node.id = match[3];
  node.className = match[2].match(/class="([^"]*)"/)?.[1] || '';
  node.dataset.tab = match[2].match(/data-tab="([^"]*)"/)?.[1];
  if (node.id === 'reference-direction') node.value = 'incoming';
  app.append(node);
}
const timers = new Map(); let timerId = 0;
const assets = Array.from({ length: 201 }, (_, i) => ({ uuid: `uuid-${i}`, url: `db://assets/file-${i}.prefab`, name: `file-${i}`, type: 'cc.Prefab' }));
const state = { status: 'ready', revision: 1, dirty: false, outputDirectory: 'D:/out', result: { summary: { assets: 201, prefabs: 201, references: 102, errors: 1, warnings: 100 }, scannedAt: '2026-11-18T08:00:00.000Z', limitations: ['动态加载未覆盖'] } };
const malicious = '<img src=x onerror=alert(1)>';
const issues = Array.from({ length: 101 }, (_, i) => ({ id: `issue-${i}`, severity: 'warning', code: 'MISSING', message: i ? `issue ${i}` : malicious, sourceUuid: 'uuid-0', sourceUrl: assets[0].url, nodePath: 'Root/Child', component: 'cc.Sprite', property: 'spriteFrame', nodeId: 'node-id' }));
const calls = []; let oldResolve, oldRequested = false;
const messageRequest = async (name, message, args) => {
  assert.equal(name, 'cocos-resource-inspector'); calls.push({ message, args });
  if (message === 'get-state') return state;
  if (message === 'query-assets') return { items: assets, total: assets.length, page: 1, pageSize: 200 };
  if (message === 'query-issues') {
    if (args.query === 'old') { oldRequested = true; return new Promise(resolve => { oldResolve = resolve; }); }
    if (args.query === 'new') return { items: [{ ...issues[0], message: 'new result' }], total: 1, page: 1, pageSize: 100 };
    return { items: issues, total: 101, page: 1, pageSize: 100 };
  }
  if (message === 'query-references') return { items: [{ ...issues[0], targetUuid: 'uuid-1', targetUrl: assets[1].url, kind: 'serialized' }], total: 1, page: 1, pageSize: 100 };
  if (message === 'get-impact') return { direct: assets.slice(0, 150), transitive: assets.slice(0, 125), directTotal: 600, transitiveTotal: 800, truncated: true, caveat: 'STATIC ONLY' };
  if (message === 'locate-node' || message === 'locate-asset') return { message: 'located' };
  if (message === 'export-report') return { path: 'D:/out/report.html' };
  throw new Error(message);
};
const context = { module: { exports: {} }, require, __dirname: path.join(root, 'panels/default'), Editor: { Panel: { define: options => options }, Message: { request: messageRequest } }, setTimeout(callback, ms) { timers.set(++timerId, { callback, ms }); return timerId; }, clearTimeout(id) { timers.delete(id); } };
vm.runInNewContext(fs.readFileSync(path.join(root, 'panels/default/index.js'), 'utf8'), context);
const panel = context.module.exports;
const instance = { $: { app } };
const q = selector => app.querySelector(selector);
const flush = () => new Promise(resolve => setImmediate(resolve));
const fireDebounce = () => { for (const [id, timer] of timers) if (timer.ms === 250) { timers.delete(id); timer.callback(); } };
(async () => {
  panel.ready.call(instance); await flush();
  assert.equal(q('#assets').querySelectorAll('.asset-item').length, 200, 'asset DOM cap');
  assert.equal(q('#issue-table').querySelectorAll('tr').length, 101, '100 issues plus header');
  assert(q('#issue-table').textContent.includes(malicious), 'hostile text remains text');
  assert.equal(q('#issue-table').querySelectorAll('img').length, 0);
  assert.equal(q('#asset-next').disabled, false);
  q('#issue-search').value = 'old'; q('#issue-search').dispatch('input'); fireDebounce(); await flush(); assert(oldRequested);
  q('#issue-search').value = 'new'; q('#issue-search').dispatch('input'); fireDebounce(); await flush();
  oldResolve({ items: [{ ...issues[0], message: 'stale old result' }], total: 1, page: 1, pageSize: 100 }); await flush();
  assert(q('#issue-table').textContent.includes('new result')); assert(!q('#issue-table').textContent.includes('stale old result'));
  q('#assets').querySelectorAll('.asset-item')[0].dispatch('click'); q('#tab-references').dispatch('click'); await flush();
  assert(q('#reference-table').textContent.includes('spriteFrame'));
  const nodeButton = q('#reference-table').querySelectorAll('button').find(button => button.textContent === '定位节点'); nodeButton.dispatch('click'); await flush();
  const nodeCall = calls.find(call => call.message === 'locate-node'); assert.equal(nodeCall.args.nodeId, 'node-id');
  q('#reference-direction').value = 'outgoing'; q('#reference-direction').dispatch('change'); await flush();
  assert.equal(calls.filter(call => call.message === 'query-references').at(-1).args.direction, 'outgoing');
  q('#tab-impact').dispatch('click'); await flush();
  assert(q('#impact-body').textContent.includes('600')); assert(q('#impact-body').textContent.includes('800')); assert(q('#impact-body').textContent.includes('不完整'));
  assert.equal(q('#impact-body').querySelectorAll('li').length, 200, 'two impact sections capped at 100');
  q('#export-html').dispatch('click'); await flush(); assert(q('#status').textContent.includes('D:/out/report.html'));
  panel.close.call(instance); await flush(); assert.equal(timers.size, 0); assert.equal(q('#assets').childNodes.length, 0);
  const callsAfterClose = calls.length; q('#scan').dispatch('click'); await flush(); assert.equal(calls.length, callsAfterClose);
  console.log('Panel smoke passed: bounded DOM, text safety, stale query rejection, references/nodeId, impact totals, export, lifecycle cleanup.');
})().catch(error => { console.error(error); process.exitCode = 1; });
