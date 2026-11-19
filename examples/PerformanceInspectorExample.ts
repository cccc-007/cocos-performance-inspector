/**
 * 手动接入示例：复制到 assets/performance-inspector/ 根目录后再使用。
 * 选择这个组件时，不要同时挂 InspectorBootstrap，避免多处控制同一会话。
 * 示例不构造故意泄漏，也不强制触发 GC。
 */
import { _decorator, Component } from 'cc';
import { DEBUG, EDITOR } from 'cc/env';
import { PerformanceInspector } from './runtime/PerformanceInspector';

const { ccclass, property } = _decorator;

@ccclass('PerformanceInspectorExample')
export class PerformanceInspectorExample extends Component {
    @property({ tooltip: '填写插件面板中的 Endpoint；不填则仅在运行时采集。' })
    endpoint = '';

    @property({ tooltip: '填写插件面板中的当前 Token。' })
    token = '';

    private inspector: PerformanceInspector | undefined;

    onLoad(): void {
        if (EDITOR || !DEBUG) return;
        this.inspector = PerformanceInspector.start({
            endpoint: this.endpoint,
            token: this.token,
            sampleIntervalMs: 1000,
            captureStacks: false,
        });
        this.inspector.snapshot('启动基线');
    }

    /** 可以通过 UI 按钮事件调用，在同一稳定业务阶段反复保存快照。 */
    captureCheckpoint(): void {
        this.inspector?.snapshot('业务返回稳定界面');
    }

    /** 输出后可保存为 JSON 并在编辑器插件中导入。 */
    printReportJSON(): void {
        if (this.inspector) console.log(JSON.stringify(this.inspector.getReport()));
    }

    onDestroy(): void {
        this.inspector?.stop();
        this.inspector = undefined;
    }
}
