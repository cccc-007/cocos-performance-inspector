import { CaptureSettings } from '../shared/preview';
import { InspectorReport } from '../shared/model';
export declare function outputDirectory(project: string): string;
export declare function readCaptureSettings(project: string): CaptureSettings;
export declare function writeCaptureSettings(project: string, value: unknown): CaptureSettings;
export declare function writeReport(project: string, report: InspectorReport, format: string): string;
