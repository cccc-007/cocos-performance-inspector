import { InspectorReport, Snapshot } from '../shared/model';
import { PanelCursor, PanelReport, ResourcePage } from '../shared/panel';
import { StreamAck } from '../shared/stream';
export declare const MAX_BODY_BYTES: number;
export declare class InspectorServer {
    readonly token: string;
    endpoint: string;
    error: string;
    private server?;
    private sessions;
    private commands;
    private selected;
    private selectNextRuntime;
    private epoch;
    start(): Promise<void>;
    stop(): void;
    private retain;
    ingest(input: unknown, imported?: boolean): string;
    /** A packet is validated and planned in full before any session data changes. */
    ingestStream(input: unknown): StreamAck;
    private emptyReport;
    private planRange;
    private planSnapshot;
    select(id: string): void;
    followNextRuntime(): void;
    clear(): void;
    private analysis;
    getReport(): InspectorReport;
    getSnapshot(id: string): Snapshot;
    getResourceEvents(cursor?: number): ResourcePage;
    requestSnapshot(label: string): void;
    state(cursor?: PanelCursor): {
        endpoint: string;
        token: string;
        error: string;
        selected: string;
        revision: number;
        sessions: unknown[];
        report?: PanelReport | null;
    };
    private handle;
}
