import { Contract, Provider, Signer, Transaction, utils } from "koilib";
import type { Abi, TransactionReceipt } from "koilib";
import { kitAbi } from "./abi.js";
import { MANA, networkConfig, type Network, type NetworkConfig } from "./network.js";

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
export class Issuer {
  readonly net: NetworkConfig;
  readonly provider: Provider;
  readonly signer: Signer;
  readonly contract: Contract;
  readonly contractId: string;
  private manaPerOp: bigint;
  private manaFloor: bigint;

  constructor(opts: IssuerOptions) {
    this.net = networkConfig(opts.network ?? "testnet", { rpc: opts.rpc, rest: opts.rest });
    this.provider = new Provider([this.net.rpc]);
    this.signer = Signer.fromWif(opts.issuerWif);
    this.signer.provider = this.provider;
    this.contractId = opts.contractId;
    this.contract = new Contract({ id: opts.contractId, abi: opts.abi ?? kitAbi(), provider: this.provider, signer: this.signer });
    this.manaPerOp = BigInt(Math.round((opts.manaPerOp ?? 0.2) * Number(MANA)));
    this.manaFloor = BigInt(Math.round((opts.manaFloor ?? 0.5) * Number(MANA)));
  }

  get address(): string {
    return this.signer.getAddress();
  }

  /**
   * Mana limit for a transaction of `opCount` operations, capped at what the
   * key has. The mempool reserves the full limit of recent transactions for a
   * while, so generous limits get refused; keep this close to real cost.
   */
  async rcLimitFor(opCount: number): Promise<string> {
    const want = BigInt(Math.max(opCount, 1)) * this.manaPerOp + this.manaFloor;
    const have = BigInt(await this.provider.getAccountRc(this.address));
    return (want < have ? want : have).toString();
  }

  /* ---------- reads ---------- */

  async getConfig(): Promise<{ owner: string; issuer: string; programs: string; stamps: string; redeemed: string }> {
    const r = await this.contract.functions.get_config({});
    return (r.result as { value: { owner: string; issuer: string; programs: string; stamps: string; redeemed: string } }).value;
  }

  async getProgram(id: string | number): Promise<Program | null> {
    const r = await this.contract.functions.get_program({ id: String(id) });
    return ((r.result as { value?: Program } | undefined)?.value as Program) ?? null;
  }

  /** Programs with id greater than `start`, up to `limit` (max 100). */
  async getPrograms(start: string | number = 0, limit = 100): Promise<Program[]> {
    const r = await this.contract.functions.get_programs({ start: String(start), limit });
    return ((r.result as { values?: Program[] } | undefined)?.values as Program[]) ?? [];
  }

  async allPrograms(): Promise<Program[]> {
    const out: Program[] = [];
    let start = "0";
    for (;;) {
      const page = await this.getPrograms(start, 100);
      out.push(...page);
      if (page.length < 100) break;
      start = page[page.length - 1].id;
    }
    return out;
  }

  /** A holder's standing on a program. All-zero balances come back as zeros, not undefined. */
  async balanceOf(holder: string, programId: string | number): Promise<Balance> {
    const r = await this.contract.functions.balance_of({ holder, program_id: String(programId) });
    const b = (r.result as Partial<Balance> | undefined) ?? {};
    return { stamps: b.stamps ?? "0", spent: b.spent ?? "0", unspent: b.unspent ?? "0", rewards: b.rewards ?? "0", last: b.last ?? "0" };
  }

  async issuerStatus() {
    const [rc, cfg] = await Promise.all([this.provider.getAccountRc(this.address), this.getConfig().catch(() => null)]);
    return { address: this.address, mana: utils.formatUnits(rc, 8), config: cfg, network: this.net.network, contract: this.contractId };
  }

  /* ---------- writes ---------- */

  /** Create a program and return its on-chain id. Waits for block inclusion. */
  async createProgram(p: ProgramInput): Promise<{ id: string; txId: string; program: Program | null }> {
    const { transaction, receipt } = await this.contract.functions.create_program(
      {
        owner: p.owner ?? this.address,
        name: p.name.slice(0, 80),
        kind: p.kind === "loyalty" ? 1 : 2,
        uri: (p.uri ?? "").slice(0, 256),
        starts: String(p.starts ?? 0),
        ends: String(p.ends ?? 0),
        cap: String(p.cap ?? 0),
        threshold: p.threshold ?? 0,
      },
      { rcLimit: await this.rcLimitFor(1) },
    );
    const txId = transaction!.id!;
    const id = await this.programIdFromReceipt(receipt);
    if (!id) throw new Error(`program_event missing from receipt of ${txId}`);
    await transaction!.wait("byBlock", 120_000);
    return { id, txId, program: await this.getProgram(id) };
  }

  async updateProgram(id: string | number, p: { name?: string; uri?: string; ends?: number; cap?: number; threshold?: number; active: boolean }): Promise<string> {
    const { transaction } = await this.contract.functions.update_program(
      { id: String(id), name: p.name ?? "", uri: p.uri ?? "", ends: String(p.ends ?? 0), cap: String(p.cap ?? 0), threshold: p.threshold ?? 0, active: p.active },
      { rcLimit: await this.rcLimitFor(1) },
    );
    await transaction!.wait("byBlock", 120_000);
    return transaction!.id!;
  }

  /** Build a call_contract operation for one record op (no send). */
  async operationFor(op: RecordOp) {
    const fn = this.contract.functions[op.kind];
    const args: Record<string, unknown> = { program_id: String(op.programId), holder: op.holder, count: op.count };
    if (op.kind !== "revoke") args.memo = (op.memo ?? "").slice(0, 64);
    const { operation } = await fn(args, { onlyOperation: true });
    return operation!;
  }

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
  async sendBatch(ops: RecordOp[], beforeBroadcast?: (txId: string) => Promise<void>): Promise<SendResult> {
    if (!ops.length) throw new Error("empty batch");
    if (ops.length > 50) throw new Error("batch too large (max 50)");
    const operations = [];
    for (const op of ops) operations.push(await this.operationFor(op));
    const tx = new Transaction({ signer: this.signer, provider: this.provider, options: { rcLimit: await this.rcLimitFor(operations.length) } });
    for (const operation of operations) await tx.pushOperation(operation);
    await tx.prepare();
    await tx.sign();
    const txId = tx.transaction.id!;
    if (beforeBroadcast) await beforeBroadcast(txId);
    const receipt = await tx.send();
    return { txId, rcUsed: receipt?.rc_used ?? null, receipt };
  }

  /** One op, sent and waited for inclusion. Convenient; slower than batching. */
  async send(op: RecordOp): Promise<SendResult> {
    const r = await this.sendBatch([op]);
    await this.waitIncluded(r.txId);
    return r;
  }

  stamp(programId: string | number, holder: string, count = 1, memo?: string) {
    return this.send({ kind: "stamp", programId, holder, count, memo });
  }
  redeem(programId: string | number, holder: string, count = 1, memo?: string) {
    return this.send({ kind: "redeem", programId, holder, count, memo });
  }
  revoke(programId: string | number, holder: string, count = 1) {
    return this.send({ kind: "revoke", programId, holder, count });
  }

  /* ---------- tracking ---------- */

  async txStatus(txId: string): Promise<TxStatus> {
    const res = (await this.provider.getTransactionsById([txId])) as { transactions?: { containing_blocks?: string[] }[] };
    const blocks = res.transactions?.[0]?.containing_blocks ?? [];
    if (!blocks.length) return { found: false, height: null, final: false };
    const head = await this.provider.getHeadInfo();
    const r = (await fetch(`${this.net.rest}/v1/block/${blocks[0]}`, { signal: AbortSignal.timeout(8000) })
      .then((x) => (x.ok ? x.json() : null))
      .catch(() => null)) as { block_height?: string } | null;
    const height = r?.block_height ? String(r.block_height) : null;
    return { found: true, height, final: height ? BigInt(height) <= BigInt(head.last_irreversible_block) : false };
  }

  async waitIncluded(txId: string, timeoutMs = 120_000): Promise<TxStatus> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const st = await this.txStatus(txId);
      if (st.found) return st;
      if (Date.now() > deadline) throw new Error(`transaction ${txId} not included within ${timeoutMs} ms`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  /* ---------- internals ---------- */

  async decodeEvent<T = Record<string, unknown>>(name: string, data: string): Promise<T> {
    const type = name.startsWith("koinky.") ? name : `koinky.${name}`;
    return (await this.contract.serializer!.deserialize(data, type)) as unknown as T;
  }

  private async programIdFromReceipt(receipt: TransactionReceipt | undefined): Promise<string | null> {
    for (const ev of receipt?.events ?? []) {
      if (ev.name !== "koinky.program_event") continue;
      try {
        const decoded = await this.decodeEvent<{ id?: string | number }>(ev.name, ev.data);
        if (decoded.id !== undefined && decoded.id !== null) return String(decoded.id);
      } catch {
        /* ignore */
      }
    }
    return null;
  }
}
