import { director, Director, game, Game, Component, js } from 'cc';
import { captureSettings, PreviewConnection } from '../src/shared/preview';
import { PerformanceInspector } from './PerformanceInspector';

export const AUTO_PREVIEW_KEY = '__COCOS_PERFORMANCE_INSPECTOR_AUTO__';
const VERSION = '1.2.0';

interface AutoPreviewController {
    version: string;
    url: string;
    instance?: PerformanceInspector;
    refresh(): Promise<void>;
    dispose(): void;
}

/** Runs only from Creator's browser-preview plugin list. No scene component or asset import. */
export function startAutoPreview(configUrl: string): AutoPreviewController {
    const globals = globalThis as any;
    const url = new URL(configUrl, location.href);
    if (url.origin !== location.origin) throw new Error('自动接入配置必须来自当前预览服务');
    const previous: AutoPreviewController | undefined = globals[AUTO_PREVIEW_KEY];
    if (previous?.version === VERSION && previous.url === url.href) { void previous.refresh(); return previous; }
    previous?.dispose();

    let disposed = false, pending = false, failures = 0, signature = '';
    let abort: AbortController | undefined;
    let connection: PreviewConnection | undefined;
    let legacy: { prototype: any; original: Function; wrapper: Function } | undefined;

    const stopInstance = () => {
        controller.instance?.stop();
        controller.instance = undefined;
        signature = '';
    };

    // Projects upgrading from 1.0 may still contain the old component. Suppress its
    // onLoad only in this preview, and stop any instance it already owns.
    const takeOverLegacy = () => {
        const ctor = js.getClassByName('PerformanceInspectorBootstrap') as any;
        if (!ctor?.prototype || legacy) return;
        const prototype = ctor.prototype, original = prototype.onLoad;
        if (typeof original !== 'function') return;
        const wrapper = function(this: any) {
            if (!disposed) { this.owned?.stop(); this.owned = undefined; return; }
            return original.call(this);
        };
        legacy = { prototype, original, wrapper };
        prototype.onLoad = wrapper;
        const queue = [director.getScene(), ...Object.values((director as any)._persistRootNodes || {})] as any[];
        const seen = new Set<any>();
        while (queue.length) {
            const node = queue.pop();
            if (!node || seen.has(node)) continue;
            seen.add(node);
            for (const component of node.getComponents(Component)) {
                if (component instanceof ctor) { component.owned?.stop(); component.owned = undefined; }
            }
            queue.push(...node.children);
        }
    };

    const startWhenReady = () => {
        if (disposed || !connection) return;
        if (!director.root) return;
        game.off(Game.EVENT_ENGINE_INITED, startWhenReady);
        director.off(Director.EVENT_BEFORE_UPDATE, startWhenReady);
        takeOverLegacy();
        const nextSignature = JSON.stringify(connection);
        if (controller.instance && signature === nextSignature) return;
        stopInstance();
        controller.instance = PerformanceInspector.start(connection);
        signature = nextSignature;
    };

    const controller: AutoPreviewController = {
        version: VERSION, url: url.href,
        async refresh() {
            if (pending || disposed) return;
            pending = true;
            abort = new AbortController();
            const timeout = setTimeout(() => abort?.abort(), 3000);
            try {
                const response = await fetch(url.href, { cache: 'no-store', credentials: 'same-origin', signal: abort.signal });
                if (!response.ok) throw new Error(`自动接入服务 HTTP ${response.status}`);
                const input = await response.json() as PreviewConnection;
                const endpoint = new URL(input.endpoint);
                if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !/^[a-f0-9]{48}$/.test(input.token)) {
                    throw new Error('自动接入配置无效');
                }
                if (disposed) return;
                connection = { endpoint: input.endpoint, token: input.token, ...captureSettings(input) };
                failures = 0;
                startWhenReady();
            } catch {
                if (!disposed && ++failures >= 2) stopInstance();
            } finally { clearTimeout(timeout); pending = false; abort = undefined; }
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            clearInterval(heartbeat);
            abort?.abort();
            game.off(Game.EVENT_ENGINE_INITED, startWhenReady);
            game.off(Game.EVENT_POST_PROJECT_INIT, takeOverLegacy);
            director.off(Director.EVENT_BEFORE_UPDATE, startWhenReady);
            director.off(Director.EVENT_BEFORE_SCENE_LAUNCH, takeOverLegacy);
            window.removeEventListener('pagehide', controller.dispose);
            stopInstance();
            if (legacy && legacy.prototype.onLoad === legacy.wrapper) legacy.prototype.onLoad = legacy.original;
            if (globals[AUTO_PREVIEW_KEY] === controller) delete globals[AUTO_PREVIEW_KEY];
        },
    };
    globals[AUTO_PREVIEW_KEY] = controller;
    game.once(Game.EVENT_ENGINE_INITED, startWhenReady);
    game.once(Game.EVENT_POST_PROJECT_INIT, takeOverLegacy);
    director.once(Director.EVENT_BEFORE_UPDATE, startWhenReady);
    director.on(Director.EVENT_BEFORE_SCENE_LAUNCH, takeOverLegacy);
    window.addEventListener('pagehide', controller.dispose);
    const heartbeat = setInterval(() => { void controller.refresh(); }, 5000);
    void controller.refresh();
    return controller;
}
