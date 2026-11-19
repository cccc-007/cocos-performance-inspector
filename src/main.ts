import * as fs from 'fs';
import { InspectorServer, MAX_BODY_BYTES } from './editor/server';
import { outputDirectory, readCaptureSettings, writeCaptureSettings, writeReport } from './editor/storage';
import { CaptureSettings, DEFAULT_CAPTURE_SETTINGS } from './shared/preview';
import { PanelCursor } from './shared/panel';

const NAME = 'cocos-performance-inspector';
const server = new InspectorServer();
let enabled = true;
let starting: Promise<void> | undefined;
let capture: CaptureSettings = { ...DEFAULT_CAPTURE_SETTINGS };

async function ready(): Promise<void> {
    if (!enabled) throw new Error('扩展已停用');
    if (!starting) starting = server.start().catch(error => { starting = undefined; throw error; });
    await starting;
    if (!enabled || !server.endpoint) throw new Error('接收服务未就绪');
}

export async function load(): Promise<void> {
    enabled = true;
    try { capture = readCaptureSettings(Editor.Project.path); }
    catch (error) { console.warn('[性能监控] 采集设置读取失败，使用默认值', error); }
    await ready();
}
export function unload(): void { enabled = false; server.stop(); starting = undefined; }

export const methods = {
    openPanel() { return Editor.Panel.open(NAME); },
    getState(cursor?: PanelCursor) { return { ...server.state(cursor), capture: { ...capture }, outputDirectory: outputDirectory(Editor.Project.path) }; },
    getSnapshot(id: string) { return server.getSnapshot(id); },
    getResourceEvents(cursor?: number) { return server.getResourceEvents(cursor); },
    async getPreviewConfig() { await ready(); return { endpoint: server.endpoint, token: server.token, ...capture }; },
    configureCapture(value: unknown) {
        capture = writeCaptureSettings(Editor.Project.path, value);
        server.followNextRuntime();
        return '采集设置已保存，预览将自动开始新会话';
    },
    selectSession(id: string) { server.select(id); },
    clearSession() { server.clear(); },
    takeSnapshot(label: string) { server.requestSnapshot(label); return '已请求快照，等待运行时响应'; },
    async exportReport(format: string) {
        return '报告已导出：' + writeReport(Editor.Project.path, server.getReport(), format);
    },
    async importReport() {
        const result = await Editor.Dialog.select({ title: '导入性能分析 JSON', path: outputDirectory(Editor.Project.path), type: 'file', multi: false,
            filters: [{ name: 'JSON', extensions: ['json'] }] });
        const file = result.filePaths?.[0];
        if (result.canceled || !file) return '已取消导入';
        if (fs.statSync(file).size > MAX_BODY_BYTES) throw new Error('报告超过 12 MiB');
        server.ingest(JSON.parse(fs.readFileSync(file, 'utf8')), true);
        return '报告已导入，分析结果已重新计算';
    },
};
