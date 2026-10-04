import { Contract, Provider, Signer } from "koilib";
import type { Abi, TransactionReceipt } from "koilib";
import { type Network, type NetworkConfig } from "./network.js";
export type RecordOpKind = "stamp" | "redeem" | "revoke";
export interface RecordOp {
    kind: RecordOpKind;
    programId: string | number;
    holder: string;
    count: number;
    memo?: string | null;
}
export interface ProgramInput {
    name: string;
    /** "loyalty" allows many records per holder; "attendance" allows one. */
    kind: "loyalty" | "attendance";
    uri?: string;
    /** Unix ms. 0 or undefined means unbounded. */
    starts?: number;
    ends?: number;
    /** Max records across all holders. 0 means unlimited. */
    cap?: number;
    /** Records per reward. 0 means no reward rule. */
    threshold?: number;
    /** Address shown as the program owner. Defaults to the issuer. */
    owner?: string;
}
export interface Program {
    id: string;
    owner: string;
    name: string;
    kind: number;
    uri: string;
    starts: string;
    ends: string;
    cap: string;
    threshold: number;
    minted: string;
    redeemed: string;
    active: boolean;
    created: string;
}
export interface Balance {
    stamps: string;
    spent: string;
    unspent: string;
    rewards: string;
    last: string;
}
export interface SendResult {
    txId: string;
    rcUsed: string | null;
    receipt: TransactionReceipt;
}
export interface TxStatus {
    found: boolean;
    height: string | null;
    final: boolean;
}
export interface IssuerOptions {
    network?: Network;
    contractId: string;
    issuerWif: string;
    rpc?: string;
    rest?: string;
    abi?: Abi;
    /** Mana budget per operation; measured cost is ~0.05, default 0.2. */
    manaPerOp?: number;
    /** Mana floor added to every transaction; default 0.5. */
    manaFloor?: number;
}
/**
 * Everything the issuer (your hot key) does against the contract.
 * One instance per process. Keep one transaction in flight per key:
 * send, wait for inclusion, then send the next.
 */
export declare class Issuer {
    readonly net: NetworkConfig;
    readonly provider: Provider;
    readonly signer: Signer;
    readonly contract: Contract;
    readonly contractId: string;
    private manaPerOp;
    private manaFloor;
    constructor(opts: IssuerOptions);
    get address(): string;
    /**
     * Mana limit for a transaction of `opCount` operations, capped at what the
     * key has. The mempool reserves the full limit of recent transactions for a
     * while, so generous limits get refused; keep this close to real cost.
     */
    rcLimitFor(opCount: number): Promise<string>;
    getConfig(): Promise<{
        owner: string;
        issuer: string;
        programs: string;
        stamps: string;
        redeemed: string;
    }>;
    getProgram(id: string | number): Promise<Program | null>;
    /** Programs with id greater than `start`, up to `limit` (max 100). */
    getPrograms(start?: string | number, limit?: number): Promise<Program[]>;
    allPrograms(): Promise<Program[]>;
    /** A holder's standing on a program. All-zero balances come back as zeros, not undefined. */
    balanceOf(holder: string, programId: string | number): Promise<Balance>;
    issuerStatus(): Promise<{
        address: string;
        mana: string;
        config: {
            owner: string;
            issuer: string;
            programs: string;
            stamps: string;
            redeemed: string;
        } | null;
        network: Network;
        contract: string;
    }>;
    /** Create a program and return its on-chain id. Waits for block inclusion. */
    createProgram(p: ProgramInput): Promise<{
        id: string;
        txId: string;
        program: Program | null;
    }>;
    updateProgram(id: string | number, p: {
        name?: string;
        uri?: string;
        ends?: number;
        cap?: number;
        threshold?: number;
        active: boolean;
    }): Promise<string>;
    /** Build a call_contract operation for one record op (no send). */
    operationFor(op: RecordOp): Promise<import("koilib").OperationJson>;
    /**
     * Send a batch of record ops in one transaction. Resolves once the mempool
     * accepts it; call `waitFinal` or `txStatus` to track inclusion.
     * A rejected batch never applied, so it is safe to retry whole.
     *
     * `beforeBroadcast` runs once the transaction is signed and its id is fixed,
     * before anything reaches the network. Record the id there: if the process
     * dies after the broadcast, that id is how you learn whether the batch
     * landed, instead of sending it a second time. If it throws, nothing is sent.
     */
    sendBatch(ops: RecordOp[], beforeBroadcast?: (txId: string) => Promise<void>): Promise<SendResult>;
    /** One op, sent and waited for inclusion. Convenient; slower than batching. */
    send(op: RecordOp): Promise<SendResult>;
    stamp(programId: string | number, holder: string, count?: number, memo?: string): Promise<SendResult>;
    redeem(programId: string | number, holder: string, count?: number, memo?: string): Promise<SendResult>;
    revoke(programId: string | number, holder: string, count?: number): Promise<SendResult>;
    txStatus(txId: string): Promise<TxStatus>;
    waitIncluded(txId: string, timeoutMs?: number): Promise<TxStatus>;
    decodeEvent<T = Record<string, unknown>>(name: string, data: string): Promise<T>;
    private programIdFromReceipt;
}
