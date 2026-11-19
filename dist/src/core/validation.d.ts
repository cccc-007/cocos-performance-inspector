import { InspectorReport } from '../shared/model';
import { StreamPacket } from '../shared/stream';
/** Rebuild a strict data-only report. Imported findings are always recomputed. */
export declare function validateReport(input: unknown, analyze?: boolean): InspectorReport;
/** Validate and copy only the new records, never the accumulated live history. */
export declare function validateStreamPacket(input: unknown): StreamPacket;
