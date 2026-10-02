// SPDX-License-Identifier: MIT
// Koinky: soulbound loyalty and attendance stamps on Koinos.

import { Arrays, Protobuf, Storage, System, authority } from "@koinos/sdk-as";
import { koinky } from "./proto/koinky";

const CONFIG_SPACE_ID: u32 = 0;
const PROGRAMS_SPACE_ID: u32 = 1;
const HOLDERS_SPACE_ID: u32 = 2;

const KIND_LOYALTY: u32 = 1;
const KIND_ATTENDANCE: u32 = 2;

const MAX_COUNT: u32 = 100;
const MAX_NAME: i32 = 80;
const MAX_URI: i32 = 256;
const MAX_MEMO: i32 = 64;
const MAX_PAGE: u32 = 100;

/** Big-endian u64 key so programs iterate in creation order. */
function programKey(id: u64): Uint8Array {
  const k = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    k[7 - i] = <u8>((id >> (8 * i)) & 0xff);
  }
  return k;
}

/** program key + holder address, so one holder's entries sit together per program. */
function holderKey(id: u64, holder: Uint8Array): Uint8Array {
  const k = new Uint8Array(8 + holder.length);
  k.set(programKey(id), 0);
  k.set(holder, 8);
  return k;
}

function isAddress(a: Uint8Array | null): bool {
  if (a == null) return false;
  return a!.length == 25;
}

export class Koinky {
  contractId: Uint8Array;
  config: Storage.Obj<koinky.config_object>;
  programs: Storage.Map<Uint8Array, koinky.program_object>;
  holders: Storage.Map<Uint8Array, koinky.holder_object>;

  constructor() {
    const contractId = System.getContractId();
    this.contractId = contractId;
    this.config = new Storage.Obj(
      contractId,
      CONFIG_SPACE_ID,
      koinky.config_object.decode,
      koinky.config_object.encode,
      () => new koinky.config_object()
    );
    this.programs = new Storage.Map(
      contractId,
      PROGRAMS_SPACE_ID,
      koinky.program_object.decode,
      koinky.program_object.encode,
      null
    );
    this.holders = new Storage.Map(
      contractId,
      HOLDERS_SPACE_ID,
      koinky.holder_object.decode,
      koinky.holder_object.encode,
      () => new koinky.holder_object()
    );
  }

  // ----- internals -----

  private owner(cfg: koinky.config_object): Uint8Array {
    return isAddress(cfg.owner) ? cfg.owner! : this.contractId;
  }

  private requireOwner(cfg: koinky.config_object): void {
    System.requireAuthority(authority.authorization_type.contract_call, this.owner(cfg));
  }

  private requireIssuer(cfg: koinky.config_object): void {
    System.require(isAddress(cfg.issuer), "issuer not set");
    System.requireAuthority(authority.authorization_type.contract_call, cfg.issuer!);
  }

  private now(): u64 {
    return System.getHeadInfo().head_block_time;
  }

  private getProgram(id: u64): koinky.program_object {
    const p = this.programs.get(programKey(id));
    System.require(p != null, "program not found");
    return p!;
  }

  // ----- reads -----

  name(_args: koinky.name_arguments = new koinky.name_arguments()): koinky.name_result {
    return new koinky.name_result("Koinky");
  }

  symbol(_args: koinky.symbol_arguments = new koinky.symbol_arguments()): koinky.symbol_result {
    return new koinky.symbol_result("KOINKY");
  }

  uri(_args: koinky.uri_arguments = new koinky.uri_arguments()): koinky.uri_result {
    return new koinky.uri_result("https://koinky.ie/api/meta");
  }

  get_config(_args: koinky.get_config_arguments = new koinky.get_config_arguments()): koinky.get_config_result {
    const cfg = this.config.get()!;
    const out = new koinky.config_object();
    out.owner = this.owner(cfg);
    out.issuer = cfg.issuer;
    out.programs = cfg.programs;
    out.stamps = cfg.stamps;
    out.redeemed = cfg.redeemed;
    return new koinky.get_config_result(out);
  }

  get_program(args: koinky.get_program_arguments): koinky.get_program_result {
    return new koinky.get_program_result(this.programs.get(programKey(args.id)));
  }

  get_programs(args: koinky.get_programs_arguments): koinky.get_programs_result {
    let limit = args.limit;
    if (limit == 0 || limit > MAX_PAGE) limit = MAX_PAGE;
    const rows = this.programs.getMany(programKey(args.start), <i32>limit);
    const values: koinky.program_object[] = [];
    for (let i = 0; i < rows.length; i++) {
      values.push(rows[i].value);
    }
    return new koinky.get_programs_result(values);
  }

  balance_of(args: koinky.balance_of_arguments): koinky.balance_of_result {
    System.require(isAddress(args.holder), "invalid holder");
    const h = this.holders.get(holderKey(args.program_id, args.holder!))!;
    return new koinky.balance_of_result(h.stamps, h.spent, h.stamps - h.spent, h.rewards, h.last);
  }

  // ----- admin -----

  set_owner(args: koinky.set_owner_arguments): koinky.set_owner_result {
    System.require(isAddress(args.owner), "invalid owner");
    const cfg = this.config.get()!;
    this.requireOwner(cfg);
    cfg.owner = args.owner;
    this.config.put(cfg);
    System.event("koinky.owner_event", Protobuf.encode(new koinky.owner_event(args.owner), koinky.owner_event.encode), [args.owner!]);
    return new koinky.set_owner_result();
  }

  set_issuer(args: koinky.set_issuer_arguments): koinky.set_issuer_result {
    System.require(isAddress(args.issuer), "invalid issuer");
    const cfg = this.config.get()!;
    this.requireOwner(cfg);
    cfg.issuer = args.issuer;
    this.config.put(cfg);
    System.event("koinky.issuer_event", Protobuf.encode(new koinky.issuer_event(args.issuer), koinky.issuer_event.encode), [args.issuer!]);
    return new koinky.set_issuer_result();
  }

  // ----- programs -----

  create_program(args: koinky.create_program_arguments): koinky.create_program_result {
    const cfg = this.config.get()!;
    this.requireIssuer(cfg);
    System.require(args.kind == KIND_LOYALTY || args.kind == KIND_ATTENDANCE, "kind must be 1 (loyalty) or 2 (attendance)");
    System.require(args.name != null && args.name!.length > 0 && args.name!.length <= MAX_NAME, "name must be 1-80 chars");
    System.require(args.uri == null || args.uri!.length <= MAX_URI, "uri too long");
    System.require(args.ends == 0 || args.starts <= args.ends, "ends before starts");

    const id = cfg.programs + 1;
    const p = new koinky.program_object();
    p.id = id;
    p.owner = isAddress(args.owner) ? args.owner : cfg.issuer;
    p.name = args.name;
    p.kind = args.kind;
    p.uri = args.uri;
    p.starts = args.starts;
    p.ends = args.ends;
    p.cap = args.cap;
    p.threshold = args.threshold;
    p.minted = 0;
    p.redeemed = 0;
    p.active = true;
    p.created = this.now();
    this.programs.put(programKey(id), p);

    cfg.programs = id;
    this.config.put(cfg);

    System.event(
      "koinky.program_event",
      Protobuf.encode(new koinky.program_event(id, p.owner, p.name, p.kind, true), koinky.program_event.encode),
      [p.owner!]
    );
    return new koinky.create_program_result(id);
  }

  update_program(args: koinky.update_program_arguments): koinky.update_program_result {
    const cfg = this.config.get()!;
    this.requireIssuer(cfg);
    const p = this.getProgram(args.id);
    if (args.name != null && args.name!.length > 0) {
      System.require(args.name!.length <= MAX_NAME, "name too long");
      p.name = args.name;
    }
    if (args.uri != null && args.uri!.length > 0) {
      System.require(args.uri!.length <= MAX_URI, "uri too long");
      p.uri = args.uri;
    }
    p.ends = args.ends;
    p.cap = args.cap;
    p.threshold = args.threshold;
    p.active = args.active;
    this.programs.put(programKey(args.id), p);
    System.event(
      "koinky.program_event",
      Protobuf.encode(new koinky.program_event(p.id, p.owner, p.name, p.kind, p.active), koinky.program_event.encode),
      [p.owner!]
    );
    return new koinky.update_program_result();
  }

  // ----- stamps -----

  stamp(args: koinky.stamp_arguments): koinky.stamp_result {
    const cfg = this.config.get()!;
    this.requireIssuer(cfg);
    System.require(isAddress(args.holder), "invalid holder");
    System.require(args.count >= 1 && args.count <= MAX_COUNT, "count must be 1-100");
    System.require(args.memo == null || args.memo!.length <= MAX_MEMO, "memo too long");

    const p = this.getProgram(args.program_id);
    System.require(p.active, "program inactive");
    const t = this.now();
    System.require(p.starts == 0 || t >= p.starts, "program not started");
    System.require(p.ends == 0 || t <= p.ends, "program ended");
    System.require(p.cap == 0 || p.minted + args.count <= p.cap, "program cap reached");

    const hk = holderKey(args.program_id, args.holder!);
    const h = this.holders.get(hk)!;
    if (p.kind == KIND_ATTENDANCE) {
      System.require(h.stamps == 0 && args.count == 1, "already stamped");
    }

    h.stamps += args.count;
    h.last = t;
    this.holders.put(hk, h);

    p.minted += args.count;
    this.programs.put(programKey(args.program_id), p);

    cfg.stamps += args.count;
    this.config.put(cfg);

    const unspent = h.stamps - h.spent;
    System.event(
      "koinky.stamp_event",
      Protobuf.encode(new koinky.stamp_event(args.program_id, args.holder, args.count, h.stamps, unspent, args.memo), koinky.stamp_event.encode),
      [args.holder!]
    );
    return new koinky.stamp_result(h.stamps, unspent);
  }

  redeem(args: koinky.redeem_arguments): koinky.redeem_result {
    const cfg = this.config.get()!;
    this.requireIssuer(cfg);
    System.require(isAddress(args.holder), "invalid holder");
    System.require(args.memo == null || args.memo!.length <= MAX_MEMO, "memo too long");
    const count: u32 = args.count == 0 ? 1 : args.count;
    System.require(count <= MAX_COUNT, "count must be 1-100");

    const p = this.getProgram(args.program_id);
    System.require(p.threshold > 0, "program has no reward rule");
    const needed: u64 = <u64>p.threshold * <u64>count;

    const hk = holderKey(args.program_id, args.holder!);
    const h = this.holders.get(hk)!;
    System.require(h.stamps - h.spent >= needed, "not enough stamps");

    h.spent += needed;
    h.rewards += count;
    this.holders.put(hk, h);

    p.redeemed += count;
    this.programs.put(programKey(args.program_id), p);

    cfg.redeemed += count;
    this.config.put(cfg);

    const unspent = h.stamps - h.spent;
    System.event(
      "koinky.redeem_event",
      Protobuf.encode(new koinky.redeem_event(args.program_id, args.holder, count, unspent, args.memo), koinky.redeem_event.encode),
      [args.holder!]
    );
    return new koinky.redeem_result(unspent, h.rewards);
  }

  revoke(args: koinky.revoke_arguments): koinky.revoke_result {
    const cfg = this.config.get()!;
    this.requireIssuer(cfg);
    System.require(isAddress(args.holder), "invalid holder");
    System.require(args.count >= 1 && args.count <= MAX_COUNT, "count must be 1-100");

    const p = this.getProgram(args.program_id);
    const hk = holderKey(args.program_id, args.holder!);
    const h = this.holders.get(hk)!;
    System.require(h.stamps - h.spent >= args.count, "not enough unspent stamps");

    h.stamps -= args.count;
    this.holders.put(hk, h);

    p.minted -= args.count;
    this.programs.put(programKey(args.program_id), p);

    cfg.stamps -= args.count;
    this.config.put(cfg);

    const unspent = h.stamps - h.spent;
    System.event(
      "koinky.revoke_event",
      Protobuf.encode(new koinky.revoke_event(args.program_id, args.holder, args.count, unspent), koinky.revoke_event.encode),
      [args.holder!]
    );
    return new koinky.revoke_result(unspent);
  }
}
