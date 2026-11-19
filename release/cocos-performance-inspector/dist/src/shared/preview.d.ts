export interface CaptureSettings {
    sampleIntervalMs: number;
    captureStacks: boolean;
}
export interface PreviewConnection extends CaptureSettings {
    endpoint: string;
    token: string;
}
export declare const DEFAULT_CAPTURE_SETTINGS: CaptureSettings;
export declare function captureSettings(value: unknown): CaptureSettings;
