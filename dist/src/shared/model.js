"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeConfig = exports.DEFAULT_CONFIG = void 0;
exports.DEFAULT_CONFIG = {
    sampleIntervalMs: 1000, maxSamples: 1800, maxEvents: 2000, maxObjects: 10000,
    lowFps: 45, slowFrameMs: 50, memoryWindow: 30, memoryGrowthMB: 8,
    memorySlopeMBPerMin: 2, captureStacks: false, staleObjectMs: 30000,
};
function normalizeConfig(input = {}) {
    const value = { ...exports.DEFAULT_CONFIG };
    for (const key of Object.keys(exports.DEFAULT_CONFIG)) {
        const candidate = input[key];
        if (key === 'captureStacks') {
            value.captureStacks = candidate === true;
        }
        else if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
            value[key] = candidate;
        }
    }
    value.sampleIntervalMs = Math.max(250, value.sampleIntervalMs);
    for (const key of ['maxSamples', 'maxEvents', 'maxObjects', 'memoryWindow']) {
        value[key] = Math.min(100000, Math.max(key === 'memoryWindow' ? 5 : 10, Math.floor(value[key])));
    }
    return value;
}
exports.normalizeConfig = normalizeConfig;
//# sourceMappingURL=model.js.map