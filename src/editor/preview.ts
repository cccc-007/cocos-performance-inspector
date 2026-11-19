import * as path from 'path';
import { PreviewConnection } from '../shared/preview';

const NAME = 'cocos-performance-inspector';
export const PREVIEW_SCRIPT = `${NAME}/auto.js`;
const ROUTE = `/plugins/${NAME}`;

/** Creator 3.8 loads plugins/jsList after engine initialization and before project scripts. */
export async function onSettingsBrowser(settings: { plugins?: { jsList?: string[] }; jsList?: string[] }): Promise<void> {
    await Editor.Message.request(NAME, 'get-preview-config');
    const scripts = settings.jsList || ((settings.plugins ||= {}).jsList ||= []);
    if (!scripts.includes(PREVIEW_SCRIPT)) scripts.unshift(PREVIEW_SCRIPT);
}

function localPreview(req: any): boolean {
    try {
        const base = new URL(`http://${req.headers.host}`);
        if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) return false;
        if (req.headers['sec-fetch-site'] === 'cross-site') return false;
        for (const value of [req.headers.origin, req.headers.referer]) {
            if (value && new URL(value).host !== base.host) return false;
        }
        return true;
    } catch { return false; }
}

function prepare(req: any, res: any): boolean {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (localPreview(req)) return true;
    res.status(403).send('仅支持本机浏览器预览');
    return false;
}

/** Creator's server contribution mounts these on the preview origin, including the plugins/ prefix. */
export const get = [
    {
        url: `${ROUTE}/auto.js`,
        handle(req: any, res: any) {
            if (!prepare(req, res)) return;
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
            res.sendFile(path.resolve(__dirname, '../../runtime/auto-preview.js'));
        },
    },
    {
        url: `${ROUTE}/config.json`,
        async handle(req: any, res: any) {
            if (!prepare(req, res)) return;
            try {
                const config: PreviewConnection = await Editor.Message.request(NAME, 'get-preview-config');
                res.json(config);
            } catch { res.status(503).json({ error: '性能监控扩展未就绪或已停用' }); }
        },
    },
];
