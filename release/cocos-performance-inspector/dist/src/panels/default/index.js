"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const path_1 = require("path");
const NAME = 'cocos-performance-inspector';
const escape = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = (v, digits = 0) => typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '不可用';
const mib = (v) => v == null ? '不可用' : n(v / 1048576, 1);
function table(headers, rows) {
    return rows.length ? `<div class="table-wrap"><table><thead><tr>${headers.map(h => `<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<div class="empty">暂无记录</div>';
}
function chart(series, times) {
    const finite = series.flatMap(s => s.values.filter((v) => v != null && Number.isFinite(v)));
    if (!finite.length)
        return '<div class="empty">暂无可用数据</div>';
    const max = Math.max(1, ...finite), end = times[times.length - 1] || 0, start = times[0] || 0;
    const paths = series.map(s => {
        let drawing = false;
        const d = s.values.map((v, i) => { if (v == null) {
            drawing = false;
            return '';
        } const command = drawing ? 'L' : 'M'; drawing = true; return `${command}${(40 + (times[i] - start) / Math.max(1, end - start) * 460).toFixed(1)},${(146 - v / max * 128).toFixed(1)}`; }).join(' ');
        return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2"/>`;
    }).join('');
    return `<svg class="chart" viewBox="0 0 520 180" role="img" aria-label="趋势图"><line x1="40" x2="500" y1="146" y2="146"/><line x1="40" x2="500" y1="18" y2="18"/><text x="0" y="23">${n(max, 0)}</text><text x="15" y="149">0</text><text x="40" y="173">${n(start / 1000, 0)}s</text><text x="470" y="173">${n(end / 1000, 0)}s</text>${paths}</svg><div class="legend">${series.map(s => `<span style="color:${s.color}">${escape(s.label)}</span>`).join('')}</div>`;
}
module.exports = Editor.Panel.define({
    template: (0, fs_1.readFileSync)((0, path_1.join)(__dirname, '../../../../static/panel.html'), 'utf8'),
    style: (0, fs_1.readFileSync)((0, path_1.join)(__dirname, '../../../../static/panel.css'), 'utf8'),
    $: { app: '#app' },
    ready() {
        const app = this.$.app;
        const q = (selector) => app.querySelector(selector);
        const setTableHtml = (selector, html) => {
            const container = q(selector);
            const opened = new Set([...container.querySelectorAll('details[open][data-detail]')].map(el => el.dataset.detail));
            const scroll = [...container.querySelectorAll('.table-wrap')].map(el => ({ top: el.scrollTop, left: el.scrollLeft }));
            container.innerHTML = html;
            container.querySelectorAll('details[data-detail]').forEach(el => { el.open = opened.has(el.dataset.detail); });
            container.querySelectorAll('.table-wrap').forEach((el, i) => { el.scrollTop = scroll[i]?.top || 0; el.scrollLeft = scroll[i]?.left || 0; });
        };
        let state, closed = false, pending = false, busy = false, refreshAgain = false;
        let activeTab = 'overview', sessionEpoch = 0, tabEpoch = 0;
        let sampleOffset;
        const snapshotCache = new Map();
        const snapshotPending = new Map();
        let objectSelection;
        let resourceEvents = [], resourceOffset;
        let resourceRevision, resourceMore = false, resourcePending;
        const status = (message, error = false) => { q('#status').textContent = message; q('#status').classList.toggle('error', error); };
        const request = (message, ...args) => Editor.Message.request(NAME, message, ...args);
        const action = async (message, ...args) => {
            if (busy)
                return;
            busy = true;
            if (['select-session', 'clear-session', 'import-report'].includes(message)) {
                ++sessionEpoch;
                sampleOffset = undefined;
                releaseDetails();
                if (state)
                    state = { ...state, report: null, revision: -1 };
            }
            try {
                const result = await request(message, ...args);
                if (!closed && result)
                    status(String(result));
            }
            catch (err) {
                if (!closed)
                    status(err instanceof Error ? err.message : String(err), true);
            }
            finally {
                busy = false;
                await refresh();
            }
        };
        const renderObjects = () => {
            if (activeTab !== 'objects' || closed)
                return;
            const snapshots = state?.report?.snapshots || [];
            const beforeId = q('#before').value, afterId = q('#after').value;
            if (!snapshots.some(s => s.id === beforeId) || !snapshots.some(s => s.id === afterId)) {
                q('#objects-table').innerHTML = '<div class="empty">拍摄至少两张快照后可对比；快照覆盖范围见“采集覆盖与限制”。</div>';
                q('#snapshot-diff').innerHTML = '';
                return;
            }
            const before = snapshotCache.get(beforeId), after = snapshotCache.get(afterId);
            if (!before || !after) {
                q('#snapshot-diff').innerHTML = '';
                q('#objects-table').innerHTML = `<div class="empty">${snapshotCache.has(beforeId) && snapshotCache.has(afterId) ? '快照已不可用，请重新选择。' : '正在读取快照…'}</div>`;
                return;
            }
            const countKeys = ['nodes', 'components', 'assets', 'tweens', 'listeners'];
            q('#snapshot-diff').innerHTML = `<p>${before.scene === after.scene ? '同场景对比' : '跨场景对比：常驻对象可能合理存活'}${before.truncated || after.truncated ? ' · 快照已截断，对象差集不完整' : ''}</p><div class="diff">${countKeys.map(k => { const delta = after.counts[k] - before.counts[k]; return `<span>${escape(k)} ${delta > 0 ? '+' : ''}${delta}</span>`; }).join('')}</div>`;
            const previous = new Set(before.objects.map(o => o.id));
            const next = new Set(after.objects.map(o => o.id));
            const previousAssets = new Set(before.assets.map(a => a.id)), nextAssets = new Set(after.assets.map(a => a.id));
            const addedAssets = after.assets.filter(a => !previousAssets.has(a.id)).length;
            const removedAssets = before.assets.filter(a => !nextAssets.has(a.id)).length;
            const rows = [];
            for (const object of after.objects)
                rows.push({ state: previous.has(object.id) ? '仍存活' : '新增', object });
            for (const object of before.objects)
                if (!next.has(object.id))
                    rows.push({ state: '已离开快照', object });
            rows.sort((a, b) => Number(!!b.object.destroyed) - Number(!!a.object.destroyed) || Number(b.state === '新增') - Number(a.state === '新增'));
            const filter = q('#object-filter').value.toLowerCase();
            const filtered = rows.filter(r => `${r.state} ${r.object.kind} ${r.object.label} ${r.object.path} ${r.object.id}`.toLowerCase().includes(filter));
            let html = `<p>${filtered.length} 条对象记录，显示前 500 条。资源缓存：${addedAssets} 新增、${removedAssets} 离开。</p>` + table(['状态', '类型 / ID', '对象与路径', '详情 / 堆栈'], filtered.slice(0, 500).map(({ state: s, object: o }) => [escape(s) + (o.destroyed ? '<br><span class="warn">目标已销毁</span>' : ''), `${escape(o.kind)}<br>${escape(o.id)}`, `${escape(o.label)}<br><small>${escape(o.path)}</small>`, `${escape(o.details)}${o.stack ? `<details data-detail="${escape(o.id)}"><summary>创建 / 注册堆栈</summary><pre>${escape(o.stack)}</pre></details>` : ''}`]));
            if (after.assets.length)
                html += '<h2 style="margin-top:24px">当前快照资源缓存（前 500 条）</h2>' + table(['UUID', '资源名称 / 类型', 'refCount'], after.assets.filter(a => `${a.id} ${a.name} ${a.type}`.toLowerCase().includes(filter)).slice(0, 500).map(a => [escape(a.id), `${escape(a.name)}<br>${escape(a.type)}`, escape(a.refCount)]));
            setTableHtml('#objects-table', html);
        };
        const renderResources = () => {
            if (activeTab !== 'resources' || closed)
                return;
            const filter = q('#resource-filter').value.toLowerCase();
            const events = resourceEvents.filter(e => `${e.key} ${e.type} ${e.operation} ${e.details}`.toLowerCase().includes(filter));
            setTableHtml('#resource-table', `<p>${events.length} 条记录，倒序显示最近 300 条。</p>` + table(['时间', '操作', '资源 key / 类型', '耗时 / 引用', '详情'], events.slice(-300).reverse().map(e => [n(e.time / 1000, 2) + 's', escape(e.operation), `${escape(e.key)}<br>${escape(e.type)}`, `${e.durationMs == null ? '—' : n(e.durationMs, 1) + 'ms'} / ${e.refCount ?? '—'}`, `${escape(e.details)}${e.stack ? `<details data-detail="${escape(`${e.time}:${e.operation}:${e.key}`)}"><summary>调用堆栈</summary><pre>${escape(e.stack)}</pre></details>` : ''}`])));
        };
        const releaseDetails = () => {
            ++tabEpoch;
            snapshotCache.clear();
            snapshotPending.clear();
            objectSelection = undefined;
            resourceEvents = [];
            resourceOffset = resourceRevision = undefined;
            resourceMore = false;
            resourcePending = undefined;
            q('#objects-table').innerHTML = '';
            q('#snapshot-diff').innerHTML = '';
            q('#resource-table').innerHTML = '';
        };
        const syncObjects = () => {
            if (activeTab !== 'objects' || closed)
                return;
            const snapshots = state?.report?.snapshots || [];
            for (const id of ['before', 'after']) {
                const el = q('#' + id), value = el.value;
                const html = snapshots.map(s => `<option value="${escape(s.id)}">${escape(s.label)} · ${n(s.time / 1000, 1)}s · ${escape(s.scene)}</option>`).join('');
                if (el.innerHTML !== html) {
                    el.innerHTML = html;
                    el.value = snapshots.some(s => s.id === value) ? value : id === 'before' ? snapshots[0]?.id || '' : snapshots[snapshots.length - 1]?.id || '';
                }
            }
            const ids = new Set([q('#before').value, q('#after').value].filter(Boolean));
            const selection = [...ids].join('\n');
            for (const id of snapshotCache.keys())
                if (!ids.has(id))
                    snapshotCache.delete(id);
            if (objectSelection !== selection) {
                objectSelection = selection;
                renderObjects();
            }
            const epoch = sessionEpoch, view = tabEpoch;
            for (const id of ids) {
                if (snapshotCache.has(id) || snapshotPending.has(id))
                    continue;
                const token = {};
                snapshotPending.set(id, token);
                void (async () => {
                    try {
                        const snapshot = await request('get-snapshot', id);
                        if (closed || epoch !== sessionEpoch || view !== tabEpoch || activeTab !== 'objects')
                            return;
                        const selectedIds = [q('#before').value, q('#after').value];
                        if (!selectedIds.includes(id))
                            return;
                        snapshotCache.set(id, snapshot);
                        renderObjects();
                    }
                    catch (err) {
                        if (!closed && epoch === sessionEpoch && view === tabEpoch && activeTab === 'objects')
                            status(String(err), true);
                    }
                    finally {
                        if (snapshotPending.get(id) === token)
                            snapshotPending.delete(id);
                    }
                })();
            }
        };
        const syncResources = () => {
            if (activeTab !== 'resources' || closed || resourcePending || !state?.report)
                return;
            if (resourceRevision === state.report.resourceRevision && !resourceMore)
                return;
            const epoch = sessionEpoch, view = tabEpoch, revision = state.report.resourceRevision;
            const token = {};
            resourcePending = token;
            void (async () => {
                try {
                    const page = await request('get-resource-events', resourceOffset);
                    if (closed || epoch !== sessionEpoch || view !== tabEpoch || activeTab !== 'resources')
                        return;
                    const limit = Math.min(2000, state?.report?.config.maxEvents || 2000);
                    resourceEvents = (page.reset ? page.events : resourceEvents.concat(page.events)).slice(-limit);
                    resourceOffset = page.next;
                    resourceRevision = revision;
                    resourceMore = page.next < page.end;
                    if (page.reset || page.events.length)
                        renderResources();
                }
                catch (err) {
                    if (!closed && epoch === sessionEpoch && view === tabEpoch && activeTab === 'resources')
                        status(String(err), true);
                }
                finally {
                    if (resourcePending === token)
                        resourcePending = undefined;
                }
            })();
        };
        const renderMetadata = () => {
            if (!state)
                return;
            q('#output-directory').textContent = state.outputDirectory;
            if (state.error)
                status(state.error, true);
            const select = q('#session');
            const options = state.sessions.map(s => `<option value="${escape(s.id)}">${s.imported ? '离线报告' : s.online ? '在线' : '已断开'} · ${escape(s.id)}</option>`).join('') || '<option value="">暂无会话</option>';
            if (select.innerHTML !== options)
                select.innerHTML = options;
            select.value = state.selected;
            const session = state.sessions.find(s => s.id === state.selected), report = state.report;
            q('#connection').textContent = session?.online ? '● 实时采集' : report ? '离线报告' : '等待运行时连接';
            q('#connection').classList.toggle('live', !!session?.online);
            for (const id of ['snapshot', 'json', 'html', 'clear'])
                q('#' + id).disabled = id === 'snapshot' ? !session?.online : !report;
        };
        const renderContent = () => {
            if (!state)
                return;
            const report = state.report;
            if (activeTab === 'objects') {
                syncObjects();
                return;
            }
            if (activeTab === 'resources') {
                syncResources();
                return;
            }
            if (activeTab === 'coverage') {
                q('#capabilities').innerHTML = table(['指标 / 功能', '状态', '说明'], (report?.capabilities || []).map(c => [escape(c.name), c.available ? '<span class="ok">可用</span>' : '<span class="warn">不可用 / 部分覆盖</span>', escape(c.detail)]));
                q('#buffers').textContent = report ? `保留 ${report.sampleCount} 个样本、${report.resourceEventCount} 条资源事件、${report.snapshots.length} 张快照。累计丢弃：样本 ${report.dropped.samples}，事件 ${report.dropped.events}，对象 ${report.dropped.objects}，快照 ${report.dropped.snapshots}。` : '尚无采集数据';
                return;
            }
            const samples = report?.samples || [], latest = samples[samples.length - 1];
            q('#metrics').innerHTML = [['FPS', n(latest?.frameMs ? latest.fps : null, 1), '无帧样本显示不可用'], ['P95 帧耗时', n(latest?.frameMs ? latest.p95Ms : null, 1), 'ms'], ['JS 堆内存', mib(latest?.heapBytes), 'MiB'], ['场景 Node / Component', latest ? `${latest.nodes} / ${latest.components}` : '—', '包含常驻根节点'], ['资源缓存', n(latest?.assets), '引擎缓存条目'], ['Tween / 监听器', latest ? `${latest.tweens} / ${latest.listeners}` : '—', '已跟踪活动记录'], ['Draw Calls', n(latest?.drawCalls), '引擎设备计数'], ['纹理分配', mib(latest?.textureBytes), 'MiB · 引擎统计'], ['缓冲区分配', mib(latest?.bufferBytes), 'MiB · 引擎统计']].map(([label, value, unit]) => `<div class="metric"><span>${label}</span><strong>${value}</strong><small>${unit}</small></div>`).join('');
            const recent = samples.slice(-240), times = recent.map(s => s.time);
            q('#fps-chart').innerHTML = chart([{ label: 'FPS', color: '#66dacc', values: recent.map(s => s.frameMs > 0 ? s.fps : null) }, { label: 'P95 ms', color: '#edb66e', values: recent.map(s => s.frameMs > 0 ? s.p95Ms : null) }], times);
            q('#memory-chart').innerHTML = chart([{ label: 'JS heap MiB', color: '#8cafff', values: recent.map(s => s.heapBytes == null ? null : s.heapBytes / 1048576) }], times);
            q('#finding-count').textContent = report ? `(${report.findings.length})` : '';
            q('#findings').innerHTML = report?.findings.length ? report.findings.map(f => `<article class="finding ${f.severity}"><strong><em>${escape(f.severity)}</em>${escape(f.title)}</strong><p>${escape(f.evidence)}</p><p>建议：${escape(f.suggestion)}</p></article>`).join('') : '<div class="empty">当前数据未触发规则；请积累足够样本并重复生命周期操作。</div>';
            q('#findings').classList.remove('empty');
        };
        const refresh = async () => {
            if (closed)
                return;
            if (pending || busy) {
                refreshAgain = true;
                return;
            }
            pending = true;
            refreshAgain = false;
            const epoch = sessionEpoch;
            const cursor = { sessionId: state?.selected, revision: state?.revision, sampleOffset };
            try {
                const next = await request('get-state', cursor);
                if (closed || epoch !== sessionEpoch)
                    return;
                const differentSession = next.selected !== state?.selected;
                const changed = differentSession || next.revision !== state?.revision || next.report !== undefined;
                let report = differentSession ? null : state?.report || null;
                if (differentSession) {
                    ++sessionEpoch;
                    sampleOffset = undefined;
                    releaseDetails();
                }
                if (next.report !== undefined) {
                    if (next.report) {
                        const delta = next.report;
                        if (report && delta.samplesReset && delta.resourceRevision !== report.resourceRevision)
                            releaseDetails();
                        const samples = (delta.samplesReset || delta.samplesStart !== sampleOffset || !report ? delta.samples : report.samples.concat(delta.samples)).slice(-240);
                        report = { ...delta, samples };
                        sampleOffset = delta.samplesNext;
                    }
                    else {
                        report = null;
                        sampleOffset = undefined;
                    }
                }
                state = { ...next, report };
                renderMetadata();
                if (changed)
                    renderContent();
                else if (activeTab === 'resources')
                    syncResources();
            }
            catch (err) {
                if (!closed && epoch === sessionEpoch)
                    status(String(err), true);
            }
            finally {
                pending = false;
                if (!closed && refreshAgain && !busy)
                    void refresh();
            }
        };
        q('#apply-capture').onclick = () => void action('configure-capture', {
            sampleIntervalMs: Number(q('#sample-interval').value),
            captureStacks: q('#capture-stacks').checked,
        });
        q('#snapshot').onclick = () => void action('take-snapshot', `手动快照 ${new Date().toLocaleTimeString()}`);
        q('#import').onclick = () => void action('import-report');
        q('#json').onclick = () => void action('export-report', 'json');
        q('#html').onclick = () => void action('export-report', 'html');
        q('#clear').onclick = () => void action('clear-session');
        q('#session').onchange = () => void action('select-session', q('#session').value);
        q('#before').onchange = q('#after').onchange = () => { syncObjects(); renderObjects(); };
        q('#object-filter').oninput = renderObjects;
        q('#resource-filter').oninput = renderResources;
        app.querySelectorAll('nav button').forEach(button => {
            button.onclick = () => {
                const next = button.dataset.tab || 'overview';
                if (next !== activeTab) {
                    releaseDetails();
                    activeTab = next;
                }
                app.querySelectorAll('nav button').forEach(b => b.classList.toggle('active', b === button));
                app.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.id === activeTab));
                renderContent();
                if (activeTab === 'resources')
                    renderResources();
            };
        });
        const interval = setInterval(() => void refresh(), 1500);
        this.dispose = () => { closed = true; ++sessionEpoch; releaseDetails(); state = undefined; clearInterval(interval); app.querySelectorAll('button,select,input').forEach(el => { el.onclick = el.onchange = el.oninput = null; }); };
        void refresh().then(() => {
            if (!closed && state) {
                q('#sample-interval').value = String(state.capture.sampleIntervalMs);
                q('#capture-stacks').checked = state.capture.captureStacks;
            }
        });
    },
    close() { this.dispose?.(); this.dispose = undefined; },
});
//# sourceMappingURL=index.js.map