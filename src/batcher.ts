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
export class Batcher {
  private queue: QueuedOp[] = [];
  private inFlight: { refs: (string | number)[]; txId: string; sentAt: number; included: boolean } | null = null;
  private busy = false;
  private readonly batchSize: number;

  constructor(private readonly opts: BatcherOptions) {
    this.batchSize = Math.min(Math.max(opts.batchSize ?? 20, 1), 50);
  }

  enqueue(op: QueuedOp) {
    this.queue.push(op);
  }

  get pending(): number {
    return this.queue.length;
  }

  get inflight(): string | null {
    return this.inFlight?.txId ?? null;
  }

  /** Advance: track the in-flight tx, or send the next batch. Safe to call often. */
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      if (this.inFlight) {
        const st = await this.opts.issuer.txStatus(this.inFlight.txId);
        if (st.found) {
          if (!this.inFlight.included || (this.opts.trackFinality && st.final)) {
            this.inFlight.included = true;
            await this.opts.onIncluded?.(this.inFlight.refs, this.inFlight.txId, st.height, st.final);
          }
          if (!this.opts.trackFinality || st.final) this.inFlight = null;
        } else if (Date.now() - this.inFlight.sentAt > 10 * 60_000) {
          // Mempool expiry is 120 s; after 10 min with no block it never applied. Requeue.
          const refs = this.inFlight.refs;
          this.inFlight = null;
          await this.opts.onFailed?.(refs, "not included; requeue");
        }
        if (this.inFlight) return;
      }
      if (!this.queue.length) return;
      const batch = this.queue.splice(0, this.batchSize);
      const refs = batch.map((b) => b.ref);
      try {
        const result = await this.opts.issuer.sendBatch(batch);
        this.inFlight = { refs, txId: result.txId, sentAt: Date.now(), included: false };
        await this.opts.onSent?.(refs, result);
      } catch (e) {
        await this.opts.onFailed?.(refs, e instanceof Error ? e.message : String(e));
      }
    } finally {
      this.busy = false;
    }
  }
}
