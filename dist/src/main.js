"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.methods = exports.unload = exports.load = void 0;
const fs = __importStar(require("fs"));
const server_1 = require("./editor/server");
const storage_1 = require("./editor/storage");
const preview_1 = require("./shared/preview");
const NAME = 'cocos-performance-inspector';
const server = new server_1.InspectorServer();
let enabled = true;
let starting;
let capture = { ...preview_1.DEFAULT_CAPTURE_SETTINGS };
async function ready() {
    if (!enabled)
        throw new Error('扩展已停用');
    if (!starting)
        starting = server.start().catch(error => { starting = undefined; throw error; });
    await starting;
    if (!enabled || !server.endpoint)
        throw new Error('接收服务未就绪');
}
async function load() {
    enabled = true;
    try {
        capture = (0, storage_1.readCaptureSettings)(Editor.Project.path);
    }
    catch (error) {
        console.warn('[性能监控] 采集设置读取失败，使用默认值', error);
    }
    await ready();
}
exports.load = load;
function unload() { enabled = false; server.stop(); starting = undefined; }
exports.unload = unload;
exports.methods = {
    openPanel() { return Editor.Panel.open(NAME); },
    getState(cursor) { return { ...server.state(cursor), capture: { ...capture }, outputDirectory: (0, storage_1.outputDirectory)(Editor.Project.path) }; },
    getSnapshot(id) { return server.getSnapshot(id); },
    getResourceEvents(cursor) { return server.getResourceEvents(cursor); },
    async getPreviewConfig() { await ready(); return { endpoint: server.endpoint, token: server.token, ...capture }; },
    configureCapture(value) {
        capture = (0, storage_1.writeCaptureSettings)(Editor.Project.path, value);
        server.followNextRuntime();
        return '采集设置已保存，预览将自动开始新会话';
    },
    selectSession(id) { server.select(id); },
    clearSession() { server.clear(); },
    takeSnapshot(label) { server.requestSnapshot(label); return '已请求快照，等待运行时响应'; },
    async exportReport(format) {
        return '报告已导出：' + (0, storage_1.writeReport)(Editor.Project.path, server.getReport(), format);
    },
    async importReport() {
        const result = await Editor.Dialog.select({ title: '导入性能分析 JSON', path: (0, storage_1.outputDirectory)(Editor.Project.path), type: 'file', multi: false,
            filters: [{ name: 'JSON', extensions: ['json'] }] });
        const file = result.filePaths?.[0];
        if (result.canceled || !file)
            return '已取消导入';
        if (fs.statSync(file).size > server_1.MAX_BODY_BYTES)
            throw new Error('报告超过 12 MiB');
        server.ingest(JSON.parse(fs.readFileSync(file, 'utf8')), true);
        return '报告已导入，分析结果已重新计算';
    },
};
//# sourceMappingURL=main.js.map