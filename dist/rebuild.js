import { Contract, Provider } from "koilib";
import { kitAbi } from "./abi.js";
import { networkConfig } from "./network.js";
/**
 * Reconstruct programs, every holder's balance and the full dated event log
 * from the chain alone. No database involved. Names and emails never went on
 * chain, so holders come back as addresses.
 */
export async function rebuildFromChain(opts) {
    const net = networkConfig(opts.network ?? "testnet", { rpc: opts.rpc, rest: opts.rest });
    const provider = new Provider([net.rpc]);
    const c = new Contract({ id: opts.contractId, abi: kitAbi(), provider });
    const log = opts.log ?? (() => { });
    const programs = [];
    let start = "0";
    for (;;) {
        const page = (await c.functions.get_programs({ start, limit: 100 })).result?.values ?? [];
        programs.push(...page);
        if (page.length < 100)
            break;
        start = page[page.length - 1].id;
    }
    const wanted = programs.filter((p) => !opts.programId || String(p.id) === String(opts.programId));
    log(`${programs.length} programs on contract`);
    const events = [];
    const seen = new Set();
    let seq = null;
    for (let page = 0; page < 10_000; page++) {
        const url = `${net.rest}/v1/account/${opts.contractId}/history?limit=100&ascending=true${seq != null ? `&seq_num=${seq}` : ""}`;
        const r = (await fetch(url).then((x) => x.json()));
        const items = (Array.isArray(r) ? r : r.values ?? []);
        if (!items.length)
            break;
        for (const it of items) {
            const tr = it.trx ?? {};
            // The feed can list one transaction under several sequence numbers; keep each event once.
            if (tr.transaction?.id && seen.has(tr.transaction.id))
                continue;
            if (tr.transaction?.id)
                seen.add(tr.transaction.id);
            for (const ev of tr.receipt?.events ?? []) {
                // Accept the current namespace and the pre-rename one, so older testnet history still rebuilds.
                const m = /^(koinky|stampa)\.(\w+)$/.exec(ev.name);
                if (ev.source !== opts.contractId || !m)
                    continue;
                const data = typeof ev.data === "object" && ev.data ? ev.data : { raw: ev.data };
                events.push({ ...data, seq: it.seq_num ?? null, txId: tr.transaction?.id ?? null, height: null, time: null, event: m[2] });
            }
        }
        // The node may cap the page size below `limit`, so only stop when the cursor stops moving.
        const last = items[items.length - 1].seq_num;
        if (last == null || Number(last) + 1 === seq)
            break;
        seq = Number(last) + 1;
    }
    const kept = events.filter((e) => !opts.programId || String(e.program_id ?? e.id) === String(opts.programId));
    log(`${events.length} events (${kept.length} kept)`);
    const blockOf = new Map();
    for (const txId of [...new Set(kept.map((e) => e.txId).filter((x) => Boolean(x)))]) {
        try {
            const st = (await provider.getTransactionsById([txId]));
            const id = st.transactions?.[0]?.containing_blocks?.[0];
            const b = id ? (await fetch(`${net.rest}/v1/block/${id}`).then((x) => (x.ok ? x.json() : null))) : null;
            blockOf.set(txId, { height: b?.block_height ?? null, time: b?.block?.header?.timestamp ? new Date(Number(b.block.header.timestamp)).toISOString() : null });
        }
        catch {
            blockOf.set(txId, { height: null, time: null });
        }
    }
    for (const e of kept) {
        const b = e.txId ? blockOf.get(e.txId) : undefined;
        e.height = b?.height ?? null;
        e.time = b?.time ?? null;
    }
    const holders = {};
    for (const p of wanted) {
        const addrs = [...new Set(kept.filter((e) => String(e.program_id) === String(p.id) && e.holder).map((e) => e.holder))];
        holders[p.id] = [];
        for (const holder of addrs) {
            const b = (await c.functions.balance_of({ holder, program_id: p.id })).result ?? {};
            const bal = { stamps: b.stamps ?? "0", spent: b.spent ?? "0", unspent: b.unspent ?? "0", rewards: b.rewards ?? "0", last: b.last ?? "0" };
            holders[p.id].push({ holder, ...bal, lastStampAt: bal.last !== "0" ? new Date(Number(bal.last)).toISOString() : null });
        }
    }
    return { network: net.network, contract: opts.contractId, rebuiltAt: new Date().toISOString(), programs: wanted, holders, events: kept };
}
export function rebuiltToCsv(r) {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = r.events.map((e) => [e.time, e.height, e.txId, e.event, e.program_id ?? e.id, e.holder ?? "", e.count ?? "", e.stamps ?? "", e.unspent ?? "", e.memo ?? ""].map(esc).join(","));
    return ["time,block,tx,event,program_id,holder,count,stamps_after,unspent_after,memo", ...rows].join("\n");
}
