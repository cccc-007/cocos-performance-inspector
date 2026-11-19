import { Counts, Finding, InspectorReport, Snapshot, TrackedObject } from '../shared/model';

export interface SnapshotComparison {
    sameScene: boolean;
    incomplete: boolean;
    countDelta: Counts;
    added: TrackedObject[];
    removed: TrackedObject[];
    addedAssets: Snapshot['assets'];
    removedAssets: Snapshot['assets'];
}

/** Stable runtime IDs are compared; matching names do not imply matching objects. */
export function compareSnapshots(before: Snapshot, after: Snapshot): SnapshotComparison {
    const first = new Set(before.objects.map(o => o.id));
    const last = new Set(after.objects.map(o => o.id));
    const firstAssets = new Set(before.assets.map(a => a.id));
    const lastAssets = new Set(after.assets.map(a => a.id));
    const countDelta = {} as Counts;
    for (const kind of ['nodes', 'components', 'assets', 'tweens', 'listeners'] as const) {
        countDelta[kind] = after.counts[kind] - before.counts[kind];
    }
    return {
        sameScene: before.scene === after.scene, incomplete: before.truncated || after.truncated,
        countDelta, added: after.objects.filter(o => !first.has(o.id)), removed: before.objects.filter(o => !last.has(o.id)),
        addedAssets: after.assets.filter(a => !firstAssets.has(a.id)), removedAssets: before.assets.filter(a => !lastAssets.has(a.id)),
    };
}

const MB = 1024 * 1024;
const fmt = (n: number) => n.toFixed(1);
function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const i = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2;
}

/** Heuristic diagnostics only: these observations do not establish GC reachability. */
export function analyzeReport(report: InspectorReport): Finding[] {
    const result: Finding[] = [];
    const { samples, config, snapshots, resourceEvents } = report;
    const push = (finding: Finding) => result.push(finding);
    let bestStart = 0, bestLength = 0, runStart = 0, runLength = 0;
    for (let index = 0; index < samples.length; index++) {
        const sample = samples[index];
        if (sample.fps < config.lowFps && sample.frameMs > 0) {
            if (runLength === 0) runStart = index;
            runLength++;
            if (runLength > bestLength) { bestStart = runStart; bestLength = runLength; }
        } else runLength = 0;
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
        const levels = groups.map(g => median(g.map(s => s.heapBytes!)));
        const growth = (levels[3] - levels[0]) / MB;
        const origin = memory[0].time;
        const xs = memory.map(s => (s.time - origin) / 60000);
        const ys = memory.map(s => s.heapBytes! / MB);
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
            const growth = (['nodes', 'components', 'tweens', 'listeners'] as const).filter(k => diff.countDelta[k] > 0);
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
        if (retained.length) push({ id: 'object-retained-engine-objects', category: 'object', severity: 'info', title: '已销毁或长期离树对象仍可被观察到',
            evidence: `最近快照中 ${retained.filter(o => o.kind === 'node').length} 个 Node、${retained.filter(o => o.kind === 'component').length} 个 Component 已销毁或超过 ${fmt(config.staleObjectMs / 1000)} 秒未在场景树中出现，但弱引用仍可访问。示例：${retained.slice(0, 3).map(o => o.path || o.label).join('；')}。`,
            suggestion: '检查对象池、全局数组、闭包及事件/Tween 的持有关系。对象池可能有意保留对象，GC 也可能尚未执行；请在同一业务状态下复测，并使用 Heap Snapshot 的保留路径确认。弱引用可访问本身不是泄漏证明。',
            objectIds: retained.slice(0, 50).map(o => o.id) });
        const destroyed = last.objects.filter(o => (o.kind === 'listener' || o.kind === 'tween') && o.destroyed);
        if (destroyed.length) push({ id: 'object-destroyed-target', category: 'object', severity: 'warning', title: '已销毁目标仍有关联记录',
            evidence: `最近快照发现 ${destroyed.length} 个关联已销毁目标的 Tween 或监听器记录。示例：${destroyed.slice(0, 3).map(o => o.path || o.label).join('；')}。`,
            suggestion: '检查 onDestroy 中的事件解绑、Tween.stop/stopAllByTarget 和跨场景对象持有。该记录表示采集器观察到的关联，需要结合注册堆栈与业务生命周期确认。',
            objectIds: destroyed.slice(0, 50).map(o => o.id) });
        const stale = last.objects.filter(o => (o.kind === 'tween' || o.kind === 'listener') && last.time - o.createdAt >= config.staleObjectMs && !o.destroyed);
        if (stale.length) push({ id: 'object-long-lived-handles', category: 'object', severity: 'info', title: '存在长期活动的 Tween / 监听器',
            evidence: `${stale.length} 个活动记录已超过 ${fmt(config.staleObjectMs / 1000)} 秒。长期运行的动画和全局事件可能是正常行为。`,
            suggestion: '优先检查临时界面注册的监听器和循环 Tween；全局系统或常驻节点的长期记录可作为正常基线。', objectIds: stale.slice(0, 50).map(o => o.id) });
    }
    const errors = resourceEvents.filter(e => e.operation === 'error');
    if (errors.length) push({ id: 'resource-load-errors', category: 'resource', severity: 'warning', title: '资源加载错误',
        evidence: `捕获 ${errors.length} 次加载错误。示例：${errors.slice(0, 3).map(e => e.key).join('；')}。`, suggestion: '检查路径、Bundle 生命周期和回调错误；查看事件详情及可选调用堆栈。' });
    const slow = resourceEvents.filter(e => e.operation === 'load' && (e.durationMs || 0) >= 500);
    if (slow.length) push({ id: 'resource-slow-loads', category: 'resource', severity: 'info', title: '资源加载耗时较高',
        evidence: `${slow.length} 次加载调用耗时至少 500 ms；最长 ${fmt(slow.reduce((n, e) => Math.max(n, e.durationMs || 0), 0))} ms。`,
        suggestion: '区分网络下载、缓存命中与解析/实例化耗时。可按资源标识定位调用栈；加载回调耗时不是 GPU 或物理内存分配量。' });
    return result;
}
