import { InspectorReport, Snapshot, TrackedObject } from '../shared/model';
import { analyzeReport } from './analyzer';

export const REPORT_BUDGET_BYTES = 8 * 1024 * 1024;

/** JSB does not consistently expose TextEncoder; compute UTF-8 size without platform APIs. */
export function utf8Bytes(value: string): number {
    let bytes = 0;
    for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code < 0x80) bytes++;
        else if (code < 0x800) bytes += 2;
        else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
        else bytes += 3;
    }
    return bytes;
}

function priority(object: TrackedObject, snapshot: Snapshot): number {
    if (object.destroyed) return 0;
    if (snapshot.time - object.lastSeenAt >= 30000) return 1;
    if (object.kind === 'listener' || object.kind === 'tween') return 2;
    return 3;
}

/** Bound every exported report to the editor's importer size limit; never mutate collector buffers. */
export function fitReportToBudget(source: InspectorReport, budgetBytes = REPORT_BUDGET_BYTES): InspectorReport {
    const budget = Math.max(65536, budgetBytes);
    let serialized = JSON.stringify(source);
    if (utf8Bytes(serialized) <= budget) return JSON.parse(serialized) as InspectorReport;
    serialized = '';
    const report: InspectorReport = {
        ...source, samples: [...source.samples], resourceEvents: source.resourceEvents.map(event => ({ ...event })),
        snapshots: source.snapshots.map(snapshot => ({ ...snapshot, objects: [...snapshot.objects], assets: [...snapshot.assets] })),
        capabilities: [...source.capabilities], dropped: { ...source.dropped },
    };
    report.capabilities.push({ name: 'report-detail-budget', available: true,
        detail: `Export payload limited to ${Math.floor(budget / 1024)} KiB UTF-8. When oversized, intermediate snapshots, older event stacks and some detail/sample records are omitted. Snapshot counts are preserved; truncated=true marks incomplete object/asset lists. Destroyed/stale handles receive priority. Original bounded collector buffers are unchanged. Findings are recomputed from exported data.` });
    if (report.snapshots.length > 2) {
        const removed = report.snapshots.slice(1, -1);
        report.dropped.snapshots += removed.length;
        report.dropped.objects += removed.reduce((count, snapshot) => count + snapshot.objects.length + snapshot.assets.length, 0);
        report.snapshots = [report.snapshots[0], report.snapshots[report.snapshots.length - 1]];
    }
    // Preserve useful stacks for recent activity; old call stacks can dominate a report.
    report.resourceEvents = report.resourceEvents.map((event, index) => index < report.resourceEvents.length - 64 && event.stack
        ? { ...event, stack: event.stack.slice(0, 512) } : event);
    for (const snapshot of report.snapshots) {
        snapshot.objects.sort((a, b) => priority(a, snapshot) - priority(b, snapshot));
    }
    report.findings = analyzeReport(report);
    serialized = JSON.stringify(report);
    while (utf8Bytes(serialized) > budget) {
        let changed = false;
        for (const snapshot of report.snapshots) {
            const objectLength = Math.floor(snapshot.objects.length * .65);
            const assetLength = Math.floor(snapshot.assets.length * .65);
            if (objectLength < snapshot.objects.length || assetLength < snapshot.assets.length) {
                report.dropped.objects += snapshot.objects.length - objectLength + snapshot.assets.length - assetLength;
                snapshot.objects = snapshot.objects.slice(0, objectLength);
                snapshot.assets = snapshot.assets.slice(0, assetLength);
                snapshot.truncated = true;
                changed = true;
            }
        }
        if (report.resourceEvents.length) {
            const length = Math.floor(report.resourceEvents.length * .75);
            report.dropped.events += report.resourceEvents.length - length;
            report.resourceEvents = length ? report.resourceEvents.slice(-length) : [];
            changed = true;
        }
        if (report.samples.length) {
            const length = Math.floor(report.samples.length * .85);
            report.dropped.samples += report.samples.length - length;
            report.samples = length ? report.samples.slice(-length) : [];
            changed = true;
        }
        if (!changed) throw new Error('Inspector report metadata exceeds the export budget.');
        report.findings = analyzeReport(report);
        serialized = JSON.stringify(report);
    }
    return JSON.parse(serialized) as InspectorReport;
}
