import { InspectorReport } from '../shared/model';
/** Escape every value that originates in a project, stack, path or imported JSON. */
export declare function escapeHtml(value: unknown): string;
/** A portable, offline report: no external resources and no executable scripts. */
export declare function renderHtmlReport(report: InspectorReport): string;
