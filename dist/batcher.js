/**
 * In-memory batching with exactly one transaction in flight. Drive it from a
 * timer: `enqueue()` as records happen, `tick()` every few seconds.
 * Persistence is yours: store `ref -> txId` in `onSent`, and on restart
 * re-enqueue anything that never reached `onIncluded`.
 */
export class Batcher {
    opts;
    queue = [];
    inFlight = null;
    busy = false;
    batchSize;
    constructor(opts) {
        this.opts = opts;
        this.batchSize = Math.min(Math.max(opts.batchSize ?? 20, 1), 50);
    }
    enqueue(op) {
        this.queue.push(op);
    }
    get pending() {
        return this.queue.length;
    }
    get inflight() {
        return this.inFlight?.txId ?? null;
    }
    /** Advance: track the in-flight tx, or send the next batch. Safe to call often. */
    async tick() {
        if (this.busy)
            return;
        this.busy = true;
        try {
            if (this.inFlight) {
                const st = await this.opts.issuer.txStatus(this.inFlight.txId);
                if (st.found) {
                    if (!this.inFlight.included || (this.opts.trackFinality && st.final)) {
                        this.inFlight.included = true;
                        await this.opts.onIncluded?.(this.inFlight.refs, this.inFlight.txId, st.height, st.final);
                    }
                    if (!this.opts.trackFinality || st.final)
                        this.inFlight = null;
                }
                else if (Date.now() - this.inFlight.sentAt > 10 * 60_000) {
                    // Mempool expiry is 120 s; after 10 min with no block it never applied. Requeue.
                    const refs = this.inFlight.refs;
                    this.inFlight = null;
                    await this.opts.onFailed?.(refs, "not included; requeue");
                }
                if (this.inFlight)
                    return;
            }
            if (!this.queue.length)
                return;
            const batch = this.queue.splice(0, this.batchSize);
            const refs = batch.map((b) => b.ref);
            try {
                const result = await this.opts.issuer.sendBatch(batch);
                this.inFlight = { refs, txId: result.txId, sentAt: Date.now(), included: false };
                await this.opts.onSent?.(refs, result);
            }
            catch (e) {
                await this.opts.onFailed?.(refs, e instanceof Error ? e.message : String(e));
            }
        }
        finally {
            this.busy = false;
        }
    }
}
