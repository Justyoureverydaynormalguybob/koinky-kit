import type { Issuer, RecordOp, SendResult } from "./issuer.js";
export interface QueuedOp extends RecordOp {
    /** Your own id for the op, echoed back in callbacks. */
    ref: string | number;
}
export interface BatcherOptions {
    issuer: Issuer;
    /** Ops per transaction. Default 20, max 50. */
    batchSize?: number;
    /** Called when a batch is accepted by the mempool. Persist the txId against each ref. */
    onSent?: (refs: (string | number)[], result: SendResult) => void | Promise<void>;
    /** Called when a batch is included in a block (and again when final if `trackFinality`). */
    onIncluded?: (refs: (string | number)[], txId: string, height: string | null, final: boolean) => void | Promise<void>;
    /** Called when the mempool rejects a batch. The ops never applied; requeue them. */
    onFailed?: (refs: (string | number)[], error: string) => void | Promise<void>;
    trackFinality?: boolean;
}
/**
 * In-memory batching with exactly one transaction in flight. Drive it from a
 * timer: `enqueue()` as records happen, `tick()` every few seconds.
 * Persistence is yours: store `ref -> txId` in `onSent`, and on restart
 * re-enqueue anything that never reached `onIncluded`.
 */
export declare class Batcher {
    private readonly opts;
    private queue;
    private inFlight;
    private busy;
    private readonly batchSize;
    constructor(opts: BatcherOptions);
    enqueue(op: QueuedOp): void;
    get pending(): number;
    get inflight(): string | null;
    /** Advance: track the in-flight tx, or send the next batch. Safe to call often. */
    tick(): Promise<void>;
}
