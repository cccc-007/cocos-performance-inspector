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
exports.get = exports.onSettingsBrowser = exports.PREVIEW_SCRIPT = void 0;
const path = __importStar(require("path"));
const NAME = 'cocos-performance-inspector';
exports.PREVIEW_SCRIPT = `${NAME}/auto.js`;
const ROUTE = `/plugins/${NAME}`;
/** Creator 3.8 loads plugins/jsList after engine initialization and before project scripts. */
async function onSettingsBrowser(settings) {
    var _a;
    await Editor.Message.request(NAME, 'get-preview-config');
    const scripts = settings.jsList || ((_a = (settings.plugins || (settings.plugins = {}))).jsList || (_a.jsList = []));
    if (!scripts.includes(exports.PREVIEW_SCRIPT))
        scripts.unshift(exports.PREVIEW_SCRIPT);
}
exports.onSettingsBrowser = onSettingsBrowser;
function localPreview(req) {
    try {
        const base = new URL(`http://${req.headers.host}`);
        if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))
            return false;
        if (req.headers['sec-fetch-site'] === 'cross-site')
            return false;
        for (const value of [req.headers.origin, req.headers.referer]) {
            if (value && new URL(value).host !== base.host)
                return false;
        }
        return true;
    }
    catch {
        return false;
    }
}
function prepare(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (localPreview(req))
        return true;
    res.status(403).send('仅支持本机浏览器预览');
    return false;
}
/** Creator's server contribution mounts these on the preview origin, including the plugins/ prefix. */
exports.get = [
    {
        url: `${ROUTE}/auto.js`,
        handle(req, res) {
            if (!prepare(req, res))
                return;
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
            res.sendFile(path.resolve(__dirname, '../../runtime/auto-preview.js'));
        },
    },
    {
        url: `${ROUTE}/config.json`,
        async handle(req, res) {
            if (!prepare(req, res))
                return;
            try {
                const config = await Editor.Message.request(NAME, 'get-preview-config');
                res.json(config);
            }
            catch {
                res.status(503).json({ error: '性能监控扩展未就绪或已停用' });
            }
        },
    },
];
//# sourceMappingURL=preview.js.map