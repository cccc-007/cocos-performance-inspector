import { InspectorReport } from '../shared/model';
export declare const REPORT_BUDGET_BYTES: number;
/** JSB does not consistently expose TextEncoder; compute UTF-8 size without platform APIs. */
export declare function utf8Bytes(value: string): number;
/** Bound every exported report to the editor's importer size limit; never mutate collector buffers. */
export declare function fitReportToBudget(source: InspectorReport, budgetBytes?: number): InspectorReport;
