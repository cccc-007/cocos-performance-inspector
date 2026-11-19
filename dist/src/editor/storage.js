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
exports.writeReport = exports.writeCaptureSettings = exports.readCaptureSettings = exports.outputDirectory = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto_1 = require("crypto");
const preview_1 = require("../shared/preview");
const report_1 = require("../core/report");
const reportBudget_1 = require("../core/reportBudget");
function outputDirectory(project) {
    return path.resolve(project, 'extensions', 'cocos-performance-inspector', 'PITemp');
}
exports.outputDirectory = outputDirectory;
function ensureDirectory(project) {
    const directory = outputDirectory(project);
    if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink())
        throw new Error('PITemp 不能是符号链接');
    fs.mkdirSync(directory, { recursive: true });
    return directory;
}
function readCaptureSettings(project) {
    const file = path.join(outputDirectory(project), 'capture-settings.json');
    if (!fs.existsSync(file))
        return { ...preview_1.DEFAULT_CAPTURE_SETTINGS };
    if (fs.statSync(file).size > 4096)
        throw new Error('PITemp/capture-settings.json 格式无效');
    return (0, preview_1.captureSettings)(JSON.parse(fs.readFileSync(file, 'utf8')));
}
exports.readCaptureSettings = readCaptureSettings;
function writeCaptureSettings(project, value) {
    const settings = (0, preview_1.captureSettings)(value);
    fs.writeFileSync(path.join(ensureDirectory(project), 'capture-settings.json'), JSON.stringify(settings, null, 2), 'utf8');
    return settings;
}
exports.writeCaptureSettings = writeCaptureSettings;
function writeReport(project, report, format) {
    if (format !== 'html' && format !== 'json')
        throw new Error('导出格式无效');
    const bounded = (0, reportBudget_1.fitReportToBudget)(report);
    const file = path.join(ensureDirectory(project), `performance-${Date.now()}-${(0, crypto_1.randomBytes)(3).toString('hex')}.${format}`);
    fs.writeFileSync(file, format === 'html' ? (0, report_1.renderHtmlReport)(bounded) : JSON.stringify(bounded), { encoding: 'utf8', flag: 'wx' });
    return file;
}
exports.writeReport = writeReport;
//# sourceMappingURL=storage.js.map