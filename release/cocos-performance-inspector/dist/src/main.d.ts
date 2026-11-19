import { PanelCursor } from './shared/panel';
export declare function load(): Promise<void>;
export declare function unload(): void;
export declare const methods: {
    openPanel(): Promise<unknown>;
    getState(cursor?: PanelCursor): {
        capture: {
            sampleIntervalMs: number;
            captureStacks: boolean;
        };
        outputDirectory: string;
        endpoint: string;
        token: string;
        error: string;
        selected: string;
        revision: number;
        sessions: unknown[];
        report?: import("./shared/panel").PanelReport | null | undefined;
    };
    getSnapshot(id: string): import("./shared/model").Snapshot;
    getResourceEvents(cursor?: number): import("./shared/panel").ResourcePage;
    getPreviewConfig(): Promise<{
        sampleIntervalMs: number;
        captureStacks: boolean;
        endpoint: string;
        token: string;
    }>;
    configureCapture(value: unknown): string;
    selectSession(id: string): void;
    clearSession(): void;
    takeSnapshot(label: string): string;
    exportReport(format: string): Promise<string>;
    importReport(): Promise<"已取消导入" | "报告已导入，分析结果已重新计算">;
};
