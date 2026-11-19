"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.captureSettings = exports.DEFAULT_CAPTURE_SETTINGS = void 0;
exports.DEFAULT_CAPTURE_SETTINGS = { sampleIntervalMs: 1000, captureStacks: false };
function captureSettings(value) {
    const input = value;
    if (!input || typeof input.captureStacks !== 'boolean' || !Number.isInteger(input.sampleIntervalMs) ||
        input.sampleIntervalMs < 250 || input.sampleIntervalMs > 10000) {
        throw new Error('采样间隔须为 250–10000 ms，调用栈开关须为布尔值');
    }
    return { sampleIntervalMs: input.sampleIntervalMs, captureStacks: input.captureStacks };
}
exports.captureSettings = captureSettings;
//# sourceMappingURL=preview.js.map