'use strict';

// Synthetic fixture only. None of these values were captured from a real game.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const { DEFAULT_CONFIG } = require('../dist/src/shared/model.js');
const { validateReport } = require('../dist/src/core/validation.js');
const { renderHtmlReport } = require('../dist/src/core/report.js');
const MB = 1024 * 1024;
const scene = '演示大厅（合成数据）';
const startedAt = '2026-11-13T08:00:00.000Z';
const endedAt = '2026-11-13T08:01:00.000Z';

function counts(round) {
    return { nodes: 5 + round * 4, components: 5 + round * 4,
        assets: 3 + round * 2, tweens: round ? 2 : 1, listeners: 3 + round };
}
function snapshot(round, time, label) {
    const total = counts(round);
    const objects = [];
    for (let i = 0; i < total.nodes; i++) {
        const createdAt = i < 5 ? 0 : (Math.floor((i - 5) / 4) + 1) * 20000;
        const label = i < 5 ? `大厅节点 ${i + 1}` : `弹窗残留节点 ${i - 4}`;
        const nodePath = i < 5 ? `DemoLobby/Canvas/Node${i + 1}` : `DemoLobby/Canvas/PopupCache/Node${i - 4}`;
        objects.push({ id: `demo-node:${i}`, kind: 'node', label, path: nodePath,
            createdAt, lastSeenAt: time, details: '演示数据：模拟同场景多轮业务后节点仍存在' });
        objects.push({ id: `demo-component:${i}`, kind: 'component', label: i < 5 ? 'UITransform' : 'DemoPopupController',
            path: `${nodePath}/${i < 5 ? 'UITransform' : 'DemoPopupController'}`, createdAt, lastSeenAt: time,
            details: '演示数据：并非真实游戏实例' });
    }
    objects.push({ id: 'demo-tween:0', kind: 'tween', label: '背景循环动画（正常基线）',
        createdAt: 0, lastSeenAt: time, details: '演示数据：合法常驻动画' });
    if (round) objects.push({ id: 'demo-tween:1', kind: 'tween', label: '弹窗关闭后残留的循环 Tween',
        path: 'DemoLobby/Canvas/ClosedPopup', createdAt: 20000, lastSeenAt: time, destroyed: true,
        details: '演示数据：模拟已销毁目标仍有关联记录',
        stack: '演示调用栈（合成）\n  at DemoPopup.open (DemoPopup.ts:24)\n  at DemoLobby.showPopup (DemoLobby.ts:42)' });
    for (let i = 0; i < total.listeners; i++) objects.push({
        id: `demo-listener:${i}`, kind: 'listener', label: i < 3 ? `全局监听器 ${i + 1}（正常基线）` : '关闭弹窗遗留的 changed 监听器',
        createdAt: i < 3 ? 0 : (i - 2) * 20000, lastSeenAt: time, destroyed: i >= 3,
        details: i < 3 ? '演示数据：正常常驻监听' : '演示数据：模拟未解绑已销毁 target',
        ...(i >= 3 ? { path: `DemoLobby/ClosedPopup${i - 2}`, stack: '演示调用栈（合成）\n  at DemoPopup.onEnable (DemoPopup.ts:18)' } : {}),
    });
    const assets = Array.from({ length: total.assets }, (_, i) => ({
        id: `demo-asset:${i}`, name: i < 3 ? `公共资源 ${i + 1}` : `弹窗纹理 ${i - 2}`,
        type: i % 2 ? 'Texture2D' : 'Prefab', refCount: i < 3 ? 1 : 2,
    }));
    return { id: `demo-snapshot:${round}`, label, time, scene, counts: total, objects, assets, truncated: false };
}

const samples = Array.from({ length: 61 }, (_, second) => {
    const degraded = second >= 20;
    const fps = degraded ? 34 + (second % 5) : 59 + (second % 3) * 0.25;
    return { ...counts(Math.min(3, Math.floor(second / 20))), time: second * 1000, scene,
        fps, frameMs: 1000 / fps, p95Ms: degraded ? 42 + second % 4 : 18,
        maxFrameMs: second % 10 === 0 && second ? 110 : degraded ? 47 : 24,
        slowFrames: second % 10 === 0 && second ? 2 : 0,
        heapBytes: Math.round((64 + second * 0.55 + (second % 4) * 0.04) * MB),
        drawCalls: 25 + Math.floor(second / 20) * 12,
        textureBytes: (12 + Math.floor(second / 20) * 3) * MB, bufferBytes: 2 * MB,
    };
});

const report = validateReport({
    schemaVersion: 1,
    session: { id: '演示数据-demo-session-v1', startedAt, endedAt,
        engine: '3.8.x（合成演示）', platform: '演示数据 · 非真实采集' },
    config: { ...DEFAULT_CONFIG, captureStacks: true }, samples,
    snapshots: [snapshot(0, 1000, '演示：稳定基线'), snapshot(1, 20000, '演示：第 1 轮返回大厅'),
        snapshot(2, 40000, '演示：第 2 轮返回大厅'), snapshot(3, 60000, '演示：第 3 轮返回大厅')],
    resourceEvents: [
        { time: 10000, operation: 'load', key: '演示 assets/popup/Popup.prefab', type: 'Prefab', durationMs: 620,
            details: '合成示例：首次加载偏慢，操作次数不等于分配次数' },
        { time: 20000, operation: 'addRef', key: 'demo-asset:3', type: 'Texture2D', refCount: 2,
            stack: '演示调用栈（合成）\n  at DemoPopup.onLoad (DemoPopup.ts:12)' },
        { time: 25000, operation: 'error', key: '演示 assets/popup/MissingIcon', durationMs: 14,
            details: '合成示例：模拟资源路径不存在' },
        { time: 30000, operation: 'release', key: '演示 assets/popup/Popup.prefab',
            details: '合成示例：这是释放请求，不表示物理内存已回收' },
        { time: 40000, operation: 'load', key: '演示 assets/popup/Popup.prefab', type: 'Prefab', durationMs: 810,
            details: '合成示例：模拟第二次慢加载' },
        { time: 41000, operation: 'addRef', key: 'demo-asset:5', type: 'Texture2D', refCount: 2 },
        { time: 50000, operation: 'decRef', key: 'demo-asset:3', type: 'Texture2D', refCount: 1 },
    ],
    findings: [],
    capabilities: [
        { name: '数据来源', available: false, detail: '所有数值、对象、调用栈均为脚本构造的演示数据，不能用于评估真实项目性能。' },
        { name: 'JS 堆（演示）', available: true, detail: '模拟 Chromium 堆指标持续增长，不代表实际堆分配。' },
        { name: 'Node / Component（演示）', available: true, detail: '模拟同场景多轮生命周期的对象净增长。' },
        { name: 'Tween / 监听器（演示）', available: true, detail: '模拟已销毁目标的遗留关联，供熟悉报告界面。' },
        { name: '原生进程内存', available: false, detail: '此演示与插件均不提供操作系统进程内存分析。' },
    ],
    dropped: { samples: 0, events: 0, objects: 0, snapshots: 0 },
});

fs.mkdirSync(path.join(root, 'examples'), { recursive: true });
fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
const jsonPath = path.join(root, 'examples', 'demo-report.json');
const htmlPath = path.join(root, 'docs', 'demo-report.html');
fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
fs.writeFileSync(htmlPath, renderHtmlReport(report), 'utf8');
console.log('Generated synthetic demo data, not a real game measurement.');
console.log(jsonPath);
console.log(htmlPath);
console.log(`Samples: ${report.samples.length}, snapshots: ${report.snapshots.length}, findings: ${report.findings.length}`);
