import { type Network } from "./network.js";
import type { Balance, Program } from "./issuer.js";
export interface RebuiltEvent {
    seq: string | number | null;
    txId: string | null;
    height: string | null;
    time: string | null;
    event: string;
    program_id?: string;
    id?: string;
    holder?: string;
    count?: number;
    stamps?: string;
    unspent?: string;
    memo?: string;
    [k: string]: unknown;
}
export interface Rebuilt {
    network: Network;
    contract: string;
    rebuiltAt: string;
    programs: Program[];
    holders: Record<string, (Balance & {
        holder: string;
        lastStampAt: string | null;
    })[]>;
    events: RebuiltEvent[];
}
/**
 * Reconstruct programs, every holder's balance and the full dated event log
 * from the chain alone. No database involved. Names and emails never went on
 * chain, so holders come back as addresses.
 */
export declare function rebuildFromChain(opts: {
    network?: Network;
    contractId: string;
    programId?: string | number;
    rpc?: string;
    rest?: string;
    log?: (s: string) => void;
}): Promise<Rebuilt>;
export declare function rebuiltToCsv(r: Rebuilt): string;
