import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { CaptureSettings, captureSettings, DEFAULT_CAPTURE_SETTINGS } from '../shared/preview';
import { InspectorReport } from '../shared/model';
import { renderHtmlReport } from '../core/report';
import { fitReportToBudget } from '../core/reportBudget';

export function outputDirectory(project: string): string {
    return path.resolve(project, 'extensions', 'cocos-performance-inspector', 'PITemp');
}

function ensureDirectory(project: string): string {
    const directory = outputDirectory(project);
    if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) throw new Error('PITemp 不能是符号链接');
    fs.mkdirSync(directory, { recursive: true });
    return directory;
}

export function readCaptureSettings(project: string): CaptureSettings {
    const file = path.join(outputDirectory(project), 'capture-settings.json');
    if (!fs.existsSync(file)) return { ...DEFAULT_CAPTURE_SETTINGS };
    if (fs.statSync(file).size > 4096) throw new Error('PITemp/capture-settings.json 格式无效');
    return captureSettings(JSON.parse(fs.readFileSync(file, 'utf8')));
}

export function writeCaptureSettings(project: string, value: unknown): CaptureSettings {
    const settings = captureSettings(value);
    fs.writeFileSync(path.join(ensureDirectory(project), 'capture-settings.json'), JSON.stringify(settings, null, 2), 'utf8');
    return settings;
}

export function writeReport(project: string, report: InspectorReport, format: string): string {
    if (format !== 'html' && format !== 'json') throw new Error('导出格式无效');
    const bounded = fitReportToBudget(report);
    const file = path.join(ensureDirectory(project), `performance-${Date.now()}-${randomBytes(3).toString('hex')}.${format}`);
    fs.writeFileSync(file, format === 'html' ? renderHtmlReport(bounded) : JSON.stringify(bounded), { encoding: 'utf8', flag: 'wx' });
    return file;
}
