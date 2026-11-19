import { _decorator, Component } from 'cc';
import { DEBUG, EDITOR } from 'cc/env';
import { PerformanceInspector } from './PerformanceInspector';

const { ccclass, property } = _decorator;

/** Attach to a project-owned persistent root in a debug scene. Empty endpoint supports offline reports. */
@ccclass('PerformanceInspectorBootstrap')
export class InspectorBootstrap extends Component {
    @property({ tooltip: '从插件面板复制连接地址；留空仅本地采集' })
    endpoint = '';

    @property({ tooltip: '从插件面板复制本次连接令牌' })
    token = '';

    @property({ tooltip: '采样间隔，最少 250ms' })
    sampleIntervalMs = 1000;

    @property({ tooltip: '记录调用栈会增加开销，定位问题时开启' })
    captureStacks = false;

    private owned?: PerformanceInspector;

    onLoad(): void {
        if (EDITOR || !DEBUG || PerformanceInspector.current || (globalThis as any).__COCOS_PERFORMANCE_INSPECTOR_AUTO__) return;
        this.owned = PerformanceInspector.start({ endpoint: this.endpoint, token: this.token,
            sampleIntervalMs: this.sampleIntervalMs, captureStacks: this.captureStacks });
    }

    onDestroy(): void {
        this.owned?.stop();
        this.owned = undefined;
    }
}
