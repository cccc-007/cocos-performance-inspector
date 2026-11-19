import { InspectorReport, Sample, Snapshot, TrackedObject } from '../shared/model';
import { analyzeReport, compareSnapshots } from './analyzer';

/** Escape every value that originates in a project, stack, path or imported JSON. */
export function escapeHtml(value: unknown): string {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
const e = escapeHtml;
const n = (value: number | null, digits = 1) => value === null ? '不可用' : Number.isFinite(value) ? value.toFixed(digits) : '不可用';
const mb = (value: number | null) => value === null ? '不可用' : `${n(value / 1048576)} MiB`;
const names: Record<string, string> = { nodes: 'Node', components: 'Component', assets: '资源', tweens: 'Tween', listeners: '监听器' };
const delta = (value: number) => value > 0 ? `+${value}` : String(value);

function chart(samples: Sample[], key: 'fps' | 'heapBytes', color: string, unit: string): string {
    const metric = (sample: Sample): number | null => key === 'fps'
        ? sample.frameMs > 0 ? sample.fps : null
        : sample.heapBytes === null ? null : sample.heapBytes / 1048576;
    const step = Math.max(1, Math.ceil(samples.length / 500));
    const points = samples.filter((_, i) => i % step === 0 || i === samples.length - 1);
    const valid = points.filter(s => metric(s) !== null);
    if (!valid.length) return '<div class="empty">该环境未提供此指标，或尚未产生采样。</div>';
    const values = valid.map(s => metric(s)!);
    const max = Math.max(1, values.reduce((a, b) => Math.max(a, b), 0) * 1.12);
    const start = samples[0].time, end = Math.max(start + 1, samples[samples.length - 1].time);
    const px = (s: Sample) => 56 + ((s.time - start) / (end - start)) * 830;
    const py = (s: Sample) => 190 - (metric(s)! / max) * 160;
    const lines: string[] = [];
    let segment: string[] = [];
    for (const point of points) {
        if (metric(point) === null) { if (segment.length) lines.push(segment.join(' ')); segment = []; }
        else segment.push(`${px(point).toFixed(2)},${py(point).toFixed(2)}`);
    }
    if (segment.length) lines.push(segment.join(' '));
    return `<svg viewBox="0 0 920 230" role="img" aria-label="${unit} 随会话时间变化的曲线">${[0, 0.5, 1].map(r => `<line x1="56" y1="${190 - r * 160}" x2="886" y2="${190 - r * 160}" stroke="#dce4e8"/><text x="46" y="${194 - r * 160}" text-anchor="end">${n(max * r, 0)}</text>`).join('')}${lines.map(line => `<polyline fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" points="${line}"/>`).join('')}<text x="56" y="219">${n(start / 1000)} 秒</text><text x="886" y="219" text-anchor="end">${n(end / 1000)} 秒</text><text x="56" y="17">${unit}</text></svg><p class="small">按会话时间展示，最多抽样 500 个点；中断部分表示指标不可用。</p>`;
}

function objectRow(object: TrackedObject): string {
    return `<tr><td><span class="tag">${e(object.kind)}</span>${object.destroyed ? '<span class="tag warning">目标已销毁</span>' : ''}</td><td><strong>${e(object.label)}</strong><div class="small mono">${e(object.path || object.id)}</div></td><td>${n(object.createdAt / 1000)} s</td><td>${e(object.details || '—')}${object.stack ? `<details><summary>调用堆栈</summary><pre>${e(object.stack)}</pre></details>` : ''}</td></tr>`;
}

function objectTable(objects: TrackedObject[]): string {
    return objects.length ? `<div class="scroll"><table><thead><tr><th>类别</th><th>对象 / 路径</th><th>首次观察</th><th>线索</th></tr></thead><tbody>${objects.slice(0, 150).map(objectRow).join('')}</tbody></table></div>` : '<p class="empty">没有可展示的对象记录。</p>';
}

function comparison(snapshots: Snapshot[], staleObjectMs: number): string {
    if (snapshots.length < 2) return '<p class="empty">至少采集两次快照，才能比较对象和资源变化。</p>' +
        (snapshots.length ? `<h3>最新快照对象明细</h3><p class="small">最多展示 150 条；首次快照也可查看对象路径与堆栈。</p>${objectTable(snapshots[0].objects)}` : '');
    const last = snapshots[snapshots.length - 1];
    const first = snapshots.slice(0, -1).find(s => s.scene === last.scene) || snapshots[0];
    const diff = compareSnapshots(first, last);
    const candidates = [...diff.added, ...last.objects.filter(o => o.destroyed || last.time - o.lastSeenAt >= staleObjectMs)];
    const seen = new Set<string>();
    const unique = candidates.filter(o => { if (seen.has(o.id)) return false; seen.add(o.id); return true; });
    return `<p><strong>${e(first.label)}</strong> (${n(first.time / 1000)} s) → <strong>${e(last.label)}</strong> (${n(last.time / 1000)} s)</p>
        <p class="small">${diff.sameScene ? '两次快照来自相同场景；仍需确认业务状态一致。' : '两次快照场景不同，数量差异不能用于判断泄漏。'}${diff.incomplete ? ' 对象明细已截断，新增/移除列表不完整。' : ''}</p>
        <table><thead><tr><th>指标</th><th>基线</th><th>最新</th><th>净变化</th></tr></thead><tbody>${Object.keys(names).map(k => `<tr><td>${names[k]}</td><td>${first.counts[k as keyof typeof first.counts]}</td><td>${last.counts[k as keyof typeof last.counts]}</td><td class="${diff.countDelta[k as keyof typeof diff.countDelta] > 0 ? 'growth' : ''}">${delta(diff.countDelta[k as keyof typeof diff.countDelta])}</td></tr>`).join('')}</tbody></table>
        <h3>新增对象、已销毁与长期离树记录</h3><p class="small">按稳定 ID 比较；${diff.added.length} 条新增、${diff.removed.length} 条移除。以下最多展示 150 条，完整明细见原始数据。</p>
        ${objectTable(unique)}
        <h3>新增缓存资源</h3><p class="small">${diff.addedAssets.length} 条新增、${diff.removedAssets.length} 条移除；最多展示 100 条。</p>
        ${diff.addedAssets.length ? `<table><thead><tr><th>资源</th><th>类型</th><th>refCount</th><th>UUID / ID</th></tr></thead><tbody>${diff.addedAssets.slice(0, 100).map(a => `<tr><td>${e(a.name)}</td><td>${e(a.type)}</td><td>${a.refCount}</td><td class="mono">${e(a.id)}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">没有记录到新增缓存资源。</p>'}`;
}

/** A portable, offline report: no external resources and no executable scripts. */
export function renderHtmlReport(report: InspectorReport): string {
    const findings = analyzeReport(report);
    const samples = report.samples;
    const latest = samples[samples.length - 1];
    const observedFrames = samples.filter(s => s.frameMs > 0);
    const average = observedFrames.length ? observedFrames.reduce((sum, s) => sum + s.fps, 0) / observedFrames.length : null;
    const memory = samples.filter(s => s.heapBytes !== null);
    const lastHeap = memory.length ? memory[memory.length - 1].heapBytes : null;
    const heapDelta = memory.length > 1 ? memory[memory.length - 1].heapBytes! - memory[0].heapBytes! : null;
    const span = samples.length > 1 ? (samples[samples.length - 1].time - samples[0].time) / 1000 : 0;
    const raw = JSON.stringify({ ...report, findings }, null, 2);
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><title>性能监控与内存分析报告</title><style>
    *{box-sizing:border-box}body{margin:0;background:#eef2f4;color:#18313d;font:14px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}main{max-width:1180px;margin:auto;padding:36px 28px 70px}header{background:#123440;color:#f4fafb;padding:32px;border-radius:18px;margin-bottom:22px;border-top:5px solid #48ccb1}h1{font-size:28px;line-height:1.35;margin:8px 0 16px;letter-spacing:.02em}h2{font-size:20px;margin:0 0 18px}h3{font-size:15px;margin:24px 0 10px}p{margin:8px 0 14px}.eyebrow{font-size:11px;letter-spacing:.18em;color:#8be2ce;font-weight:700}.meta{color:#c4d5db;overflow-wrap:anywhere}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:22px}.metric,section{background:white;border:1px solid #dce4e8;border-radius:14px}.metric{padding:20px}.metric .label{color:#5b6f79;font-size:12px}.metric .value{font-size:27px;font-weight:650;line-height:1.7}.metric .unit{font-size:13px;color:#73838b}section{padding:26px;margin-bottom:20px}.small{font-size:12px;color:#647983}.mono{font:12px/1.6 Consolas,monospace;overflow-wrap:anywhere}.tag{font-size:11px;display:inline-block;background:#e7f3f1;color:#236252;border-radius:4px;padding:2px 7px;margin:0 6px 4px 0}.warning{background:#fff2d7;color:#986107}.critical{background:#fce7e7;color:#ad2c38}.finding{border-left:4px solid #67ac9f;background:#f4f9f8;padding:16px 20px;margin:12px 0;border-radius:0 10px 10px 0}.finding.warning{border-color:#e2a635;background:#fffaf0;color:#18313d}.finding.critical{border-color:#d55768;background:#fff4f4;color:#18313d}.finding h3{margin:0 0 8px}.finding p{margin:6px 0}.empty{padding:20px;background:#f5f8f9;color:#647983;border-radius:9px}.notice{background:#e8f3f1;border-radius:10px;padding:16px 20px;color:#2b6258;margin:18px 0}.growth{color:#b2720e;font-weight:700}table{width:100%;border-collapse:collapse;text-align:left;font-size:12px}th{color:#617681;background:#f1f5f6;font-weight:600}td,th{border-bottom:1px solid #e1e8eb;padding:11px 12px;vertical-align:top;overflow-wrap:anywhere}td{max-width:360px}.scroll{overflow:auto;max-height:640px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f6f7;padding:14px;border-radius:7px;font:11px/1.6 Consolas,monospace;max-height:500px;overflow:auto}summary{cursor:pointer;color:#247563;margin:7px 0}svg{width:100%;height:auto;display:block}svg text{fill:#73838b;font:12px sans-serif}.twocol{display:grid;grid-template-columns:1fr 1fr;gap:24px}.footer{text-align:center;color:#788b94;font-size:12px;padding-top:18px}a{color:#247563}@media(max-width:800px){main{padding:16px}.metrics{grid-template-columns:repeat(2,1fr)}.twocol{grid-template-columns:1fr}section{padding:18px}header{padding:24px}h1{font-size:24px}}@media print{body{background:white}main{max-width:none;padding:0}section,.metric{break-inside:avoid}.scroll{max-height:none}header{-webkit-print-color-adjust:exact;print-color-adjust:exact}.raw{display:none}}
    </style></head><body><main><header><div class="eyebrow">COCOS PERFORMANCE INSPECTOR · REPORT V1</div><h1>性能监控与内存分析报告</h1><div class="meta">Cocos Creator ${e(report.session.engine)} · ${e(report.session.platform)}<br>会话 ${e(report.session.id)}<br>${e(report.session.startedAt)} → ${e(report.session.endedAt)}</div></header>
    <div class="metrics"><div class="metric"><div class="label">平均采样帧率</div><div class="value">${n(average)} <span class="unit">FPS</span></div><div class="small">${samples.length} 个区间 · ${n(span)} 秒</div></div><div class="metric"><div class="label">最新可用 JS 堆</div><div class="value">${lastHeap === null ? '不可用' : n(lastHeap / 1048576)} <span class="unit">${lastHeap === null ? '' : 'MiB'}</span></div><div class="small">首尾变化 ${heapDelta === null ? '不可用' : `${heapDelta > 0 ? '+' : ''}${mb(heapDelta)}`}</div></div><div class="metric"><div class="label">最新场景 Node / Component</div><div class="value">${latest ? `${latest.nodes} / ${latest.components}` : '—'}</div><div class="small">${e(latest?.scene || '尚无采样')}</div></div><div class="metric"><div class="label">诊断线索</div><div class="value">${findings.length}</div><div class="small">${report.snapshots.length} 份快照 · ${report.resourceEvents.length} 条资源事件</div></div></div>
    <section><h2>诊断结果</h2><p class="notice">本报告提供性能异常和对象泄漏嫌疑的观察线索。内存增长、缓存驻留或对象数量增长均不能单独证明泄漏；需要结合相同业务生命周期、GC 后快照与保留路径确认。</p>${findings.length ? findings.map(f => `<article class="finding ${f.severity}"><h3><span class="tag ${f.severity}">${({ info: '观察', warning: '需排查', critical: '严重' })[f.severity]}</span>${e(f.title)}</h3><p>${e(f.evidence)}</p><p class="small">建议：${e(f.suggestion)}</p>${f.objectIds?.length ? `<details><summary>关联对象 / 资源 ID（${f.objectIds.length}）</summary><pre>${e(f.objectIds.join('\n'))}</pre></details>` : ''}</article>`).join('') : '<p class="empty">当前采样未触发分析规则。采样不足或指标不可用时，同样可能没有诊断结果。</p>'}</section>
    <section><h2>帧率与内存趋势</h2><div class="twocol"><div><h3>帧率</h3>${chart(samples, 'fps', '#219d87', 'FPS')}</div><div><h3>JS 堆内存</h3>${chart(samples, 'heapBytes', '#5486c7', 'MiB')}</div></div><p class="small">JS 堆不包含全部原生、纹理或 GPU 内存；不同平台与浏览器的可用指标不同。区间帧时间来自实际采集帧间隔。</p></section>
    <section><h2>快照比较与对象定位</h2>${comparison(report.snapshots, report.config.staleObjectMs)}${report.snapshots.length ? `<details><summary>全部快照时间线（${report.snapshots.length}）</summary><table><thead><tr><th>时间</th><th>标记</th><th>场景</th><th>Node / Component / 资源</th></tr></thead><tbody>${report.snapshots.map(s => `<tr><td>${n(s.time / 1000)} s</td><td>${e(s.label)}${s.truncated ? '（明细截断）' : ''}</td><td>${e(s.scene)}</td><td>${s.counts.nodes} / ${s.counts.components} / ${s.counts.assets}</td></tr>`).join('')}</tbody></table></details>` : ''}</section>
    <section><h2>资源加载与释放记录</h2><p class="small">最近 300 条事件。load 表示调用完成，release 表示释放请求，addRef / decRef 表示引用变更调用；这些事件不能直接换算为分配或释放的字节数。</p>${report.resourceEvents.length ? `<div class="scroll"><table><thead><tr><th>会话时间</th><th>操作</th><th>资源标识</th><th>耗时 / 引用</th><th>详情</th></tr></thead><tbody>${report.resourceEvents.slice(-300).map(v => `<tr><td>${n(v.time / 1000)} s</td><td><span class="tag ${v.operation === 'error' ? 'critical' : ''}">${e(v.operation)}</span></td><td class="mono">${e(v.key)}</td><td>${v.durationMs === undefined ? '—' : `${n(v.durationMs)} ms`}${v.refCount === undefined ? '' : `<br>refCount ${v.refCount}`}</td><td>${e(v.details || '')}${v.stack ? `<details><summary>调用堆栈</summary><pre>${e(v.stack)}</pre></details>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">没有记录到资源事件。启用采集前发生的调用不会补录。</p>'}</section>
    <section><h2>采集能力、阈值与数据完整性</h2><table><thead><tr><th>能力</th><th>状态</th><th>说明</th></tr></thead><tbody>${report.capabilities.map(c => `<tr><td>${e(c.name)}</td><td>${c.available ? '可用' : '不可用'}</td><td>${e(c.detail)}</td></tr>`).join('')}</tbody></table><p class="small">缓冲区丢弃 / 截断累计：采样 ${report.dropped.samples}，事件 ${report.dropped.events}，对象明细 ${report.dropped.objects}，快照 ${report.dropped.snapshots}。被丢弃的数据不参与本次报告分析。</p><details><summary>本次分析配置</summary><pre>${e(JSON.stringify(report.config, null, 2))}</pre></details><p class="small">采集器自身有开销。调用堆栈建议只在定位期间开启；停止采集后将尝试还原由采集器安装的钩子。报告仅反映本会话能够观察到的对象和调用。</p></section>
    <section class="raw"><h2>原始报告数据</h2><p class="small">完整记录随 HTML 保存，便于离线分享及复核。折叠区域包含已转义的 JSON 文本，不执行项目内容。</p><details><summary>查看完整 JSON</summary><pre>${e(raw)}</pre></details></section><div class="footer">性能监控与内存分析插件 · 独立离线报告 · 无外部资源依赖</div></main></body></html>`;
}

