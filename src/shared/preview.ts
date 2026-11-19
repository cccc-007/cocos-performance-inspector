export interface CaptureSettings {
    sampleIntervalMs: number;
    captureStacks: boolean;
}

export interface PreviewConnection extends CaptureSettings {
    endpoint: string;
    token: string;
}

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = { sampleIntervalMs: 1000, captureStacks: false };

export function captureSettings(value: unknown): CaptureSettings {
    const input = value as Partial<CaptureSettings> | null;
    if (!input || typeof input.captureStacks !== 'boolean' || !Number.isInteger(input.sampleIntervalMs) ||
        input.sampleIntervalMs! < 250 || input.sampleIntervalMs! > 10000) {
        throw new Error('采样间隔须为 250–10000 ms，调用栈开关须为布尔值');
    }
    return { sampleIntervalMs: input.sampleIntervalMs!, captureStacks: input.captureStacks };
}
