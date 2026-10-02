import { Base58, MockVM, Protobuf, System, authority, chain } from "@koinos/sdk-as";
import { koinky } from "../proto/koinky";
import { Koinky } from "../Koinky";

const CONTRACT_ID = Base58.decode("1DQzuCcTKacbs9GGScRTU1Hc8BsyARTPqe");
const ISSUER = Base58.decode("1DQzuCcTKacbs9GGScRTU1Hc8BsyARTPqf");
const COLD = Base58.decode("1DQzuCcTKacbs9GGScRTU1Hc8BsyARTPqG");
const SHOP = Base58.decode("1DQzuCcTKacbs9GGScRTU1Hc8BsyARTPqK");
const ALICE = Base58.decode("1DQzuCcTKacbs9GGScRTU1Hc8BsyARTPqP");
const BOB = Base58.decode("1DQzuCcTKacbs9GGScRTU1Hc8BsyARTPqe");

const T0: u64 = 1_700_000_000_000;

function setTime(ms: u64): void {
  MockVM.setHeadInfo(new chain.head_info(null, ms, 0));
}

/**
 * A failing call rolls the mock VM back to the last commit (including contract id
 * and head info), so commit first, then assert the recorded error message.
 */
function expectFail(fn: () => void, message: string): void {
  MockVM.commitTransaction();
  expect(fn).toThrow();
  const raw = MockVM.getErrorMessage();
  const got: string = raw == null ? "" : raw!;
  expect(got.includes(message)).toBe(true, "expected error containing '" + message + "' but got '" + got + "'");
}

function allow(account: Uint8Array): void {
  MockVM.setAuthorities([new MockVM.MockAuthority(authority.authorization_type.contract_call, account, true)]);
}

function deny(): void {
  MockVM.setAuthorities([]);
}

/** Fresh contract with the issuer configured by the (contract-id) owner. */
function setup(): Koinky {
  const c = new Koinky();
  allow(CONTRACT_ID);
  c.set_issuer(new koinky.set_issuer_arguments(ISSUER));
  allow(ISSUER);
  return c;
}

function loyalty(c: Koinky, threshold: u32 = 5): u64 {
  const args = new koinky.create_program_arguments(SHOP, "Cafe Nua", 1, "", 0, 0, 0, threshold);
  return c.create_program(args).id;
}

describe("koinky", () => {
  beforeEach(() => {
    MockVM.reset();
    MockVM.setContractId(CONTRACT_ID);
    MockVM.setContractArguments(CONTRACT_ID);
    MockVM.setEntryPoint(0);
    MockVM.setCaller(new chain.caller_data(new Uint8Array(0), chain.privilege.user_mode));
    MockVM.setContractMetadata(new chain.contract_metadata_object(new Uint8Array(0), false, false, false, false));
    setTime(T0);
    System.resetCache();
  });

  it("has a name and symbol", () => {
    const c = new Koinky();
    expect(c.name().value).toBe("Koinky");
    expect(c.symbol().value).toBe("KOINKY");
  });

  it("defaults owner to the contract id and lets owner set issuer and owner", () => {
    const c = new Koinky();
    let cfg = c.get_config().value!;
    expect(Base58.encode(cfg.owner!)).toBe(Base58.encode(CONTRACT_ID));

    allow(CONTRACT_ID);
    c.set_issuer(new koinky.set_issuer_arguments(ISSUER));
    c.set_owner(new koinky.set_owner_arguments(COLD));
    cfg = c.get_config().value!;
    expect(Base58.encode(cfg.issuer!)).toBe(Base58.encode(ISSUER));
    expect(Base58.encode(cfg.owner!)).toBe(Base58.encode(COLD));

    // the old owner can no longer change the issuer
    expectFail(() => {
      const c2 = new Koinky();
      c2.set_issuer(new koinky.set_issuer_arguments(SHOP));
    }, "");
    expect(MockVM.getEvents().length).toBe(2);
  });

  it("refuses to stamp before an issuer is set", () => {
    expectFail(() => {
      const c = new Koinky();
      allow(CONTRACT_ID);
      c.stamp(new koinky.stamp_arguments(1, ALICE, 1, ""));
    }, "");
  });

  it("creates programs with incrementing ids and lists them", () => {
    const c = setup();
    const a = loyalty(c);
    const b = c.create_program(new koinky.create_program_arguments(SHOP, "Match day", 2, "", 0, 0, 100, 0)).id;
    expect(a).toBe(1);
    expect(b).toBe(2);
    expect(c.get_config().value!.programs).toBe(2);

    const p = c.get_program(new koinky.get_program_arguments(2)).value!;
    expect(p.name).toBe("Match day");
    expect(p.kind).toBe(2);
    expect(p.cap).toBe(100);
    expect(p.active).toBe(true);
    expect(p.created).toBe(T0);

    const page = c.get_programs(new koinky.get_programs_arguments(0, 10)).values;
    expect(page.length).toBe(2);
    expect(page[0].id).toBe(1);
    expect(page[1].id).toBe(2);

    const page2 = c.get_programs(new koinky.get_programs_arguments(1, 10)).values;
    expect(page2.length).toBe(1);
    expect(page2[0].id).toBe(2);
  });

  it("rejects bad programs", () => {
    const c = setup();
    expectFail(() => {
      const c2 = new Koinky();
      c2.create_program(new koinky.create_program_arguments(SHOP, "x", 3, "", 0, 0, 0, 0));
    }, "kind");
    expectFail(() => {
      const c2 = new Koinky();
      c2.create_program(new koinky.create_program_arguments(SHOP, "", 1, "", 0, 0, 0, 0));
    }, "name");
    expectFail(() => {
      const c2 = new Koinky();
      c2.create_program(new koinky.create_program_arguments(SHOP, "x", 1, "", 10, 5, 0, 0));
    }, "ends");
    expect(c.get_config().value!.programs).toBe(0);
  });

  it("stamps, counts and emits events", () => {
    const c = setup();
    const id = loyalty(c);

    let r = c.stamp(new koinky.stamp_arguments(id, ALICE, 1, "flat white"));
    expect(r.stamps).toBe(1);
    expect(r.unspent).toBe(1);

    setTime(T0 + 60_000);
    r = c.stamp(new koinky.stamp_arguments(id, ALICE, 2, ""));
    expect(r.stamps).toBe(3);

    const bal = c.balance_of(new koinky.balance_of_arguments(ALICE, id));
    expect(bal.stamps).toBe(3);
    expect(bal.spent).toBe(0);
    expect(bal.unspent).toBe(3);
    expect(bal.last).toBe(T0 + 60_000);

    const other = c.balance_of(new koinky.balance_of_arguments(BOB, id));
    expect(other.stamps).toBe(0);

    const p = c.get_program(new koinky.get_program_arguments(id)).value!;
    expect(p.minted).toBe(3);
    expect(c.get_config().value!.stamps).toBe(3);

    const events = MockVM.getEvents();
    // issuer_event, program_event, 2 x stamp_event
    expect(events.length).toBe(4);
    expect(events[2].name).toBe("koinky.stamp_event");
    const ev = Protobuf.decode<koinky.stamp_event>(events[2].data!, koinky.stamp_event.decode);
    expect(ev.count).toBe(1);
    expect(ev.memo).toBe("flat white");
    expect(Base58.encode(events[2].impacted[0])).toBe(Base58.encode(ALICE));
  });

  it("redeems when the threshold is met and not before", () => {
    const c = setup();
    const id = loyalty(c, 5);
    c.stamp(new koinky.stamp_arguments(id, ALICE, 4, ""));

    expectFail(() => {
      const c2 = new Koinky();
      c2.redeem(new koinky.redeem_arguments(1, ALICE, 1, ""));
    }, "not enough");

    c.stamp(new koinky.stamp_arguments(id, ALICE, 3, ""));
    const r = c.redeem(new koinky.redeem_arguments(id, ALICE, 0, "free coffee"));
    expect(r.unspent).toBe(2);
    expect(r.rewards).toBe(1);

    const bal = c.balance_of(new koinky.balance_of_arguments(ALICE, id));
    expect(bal.stamps).toBe(7);
    expect(bal.spent).toBe(5);
    expect(bal.unspent).toBe(2);
    expect(bal.rewards).toBe(1);

    const p = c.get_program(new koinky.get_program_arguments(id)).value!;
    expect(p.redeemed).toBe(1);
    expect(c.get_config().value!.redeemed).toBe(1);

    // two rewards at once needs 10 unspent
    c.stamp(new koinky.stamp_arguments(id, ALICE, 8, ""));
    const r2 = c.redeem(new koinky.redeem_arguments(id, ALICE, 2, ""));
    expect(r2.unspent).toBe(0);
    expect(r2.rewards).toBe(3);
  });

  it("refuses to redeem on a program with no reward rule", () => {
    expectFail(() => {
      const c = setup();
      const id = loyalty(c, 0);
      c.stamp(new koinky.stamp_arguments(id, ALICE, 5, ""));
      c.redeem(new koinky.redeem_arguments(id, ALICE, 1, ""));
    }, "no reward rule");
  });

  it("attendance programs allow one stamp per holder", () => {
    const c = setup();
    const id = c.create_program(new koinky.create_program_arguments(SHOP, "AGM", 2, "", 0, 0, 0, 0)).id;
    c.stamp(new koinky.stamp_arguments(id, ALICE, 1, ""));
    c.stamp(new koinky.stamp_arguments(id, BOB, 1, ""));
    expectFail(() => {
      const c2 = new Koinky();
      c2.stamp(new koinky.stamp_arguments(1, ALICE, 1, ""));
    }, "already stamped");
    expectFail(() => {
      const c2 = new Koinky();
      c2.stamp(new koinky.stamp_arguments(1, COLD, 2, ""));
    }, "already stamped");
    expect(c.get_program(new koinky.get_program_arguments(id)).value!.minted).toBe(2);
  });

  it("enforces cap, window and active flag", () => {
    const c = setup();
    const id = c.create_program(new koinky.create_program_arguments(SHOP, "Gig", 2, "", T0 + 1000, T0 + 5000, 2, 0)).id;

    expectFail(() => {
      const c2 = new Koinky();
      c2.stamp(new koinky.stamp_arguments(1, ALICE, 1, ""));
    }, "not started");

    setTime(T0 + 2000);
    c.stamp(new koinky.stamp_arguments(id, ALICE, 1, ""));
    c.stamp(new koinky.stamp_arguments(id, BOB, 1, ""));
    expectFail(() => {
      const c2 = new Koinky();
      c2.stamp(new koinky.stamp_arguments(1, COLD, 1, ""));
    }, "cap");

    setTime(T0 + 9000);
    expectFail(() => {
      const c2 = new Koinky();
      c2.stamp(new koinky.stamp_arguments(1, COLD, 1, ""));
    }, "ended");

    // clearing the window and cap lets stamping resume
    c.update_program(new koinky.update_program_arguments(id, "", "", 0, 0, 0, true));
    c.stamp(new koinky.stamp_arguments(id, COLD, 1, ""));

    c.update_program(new koinky.update_program_arguments(id, "", "", 0, 0, 0, false));
    expectFail(() => {
      const c2 = new Koinky();
      c2.stamp(new koinky.stamp_arguments(1, SHOP, 1, ""));
    }, "inactive");
  });

  it("revokes unspent stamps only", () => {
    const c = setup();
    const id = loyalty(c, 3);
    c.stamp(new koinky.stamp_arguments(id, ALICE, 5, ""));
    c.redeem(new koinky.redeem_arguments(id, ALICE, 1, ""));
    // 5 stamps, 3 spent, 2 unspent
    expectFail(() => {
      const c2 = new Koinky();
      c2.revoke(new koinky.revoke_arguments(1, ALICE, 3));
    }, "not enough");
    const r = c.revoke(new koinky.revoke_arguments(id, ALICE, 2));
    expect(r.unspent).toBe(0);
    const bal = c.balance_of(new koinky.balance_of_arguments(ALICE, id));
    expect(bal.stamps).toBe(3);
    expect(bal.spent).toBe(3);
    expect(c.get_program(new koinky.get_program_arguments(id)).value!.minted).toBe(3);
    expect(c.get_config().value!.stamps).toBe(3);
  });

  it("only the issuer can stamp", () => {
    const c = setup();
    const id = loyalty(c);
    deny();
    expectFail(() => {
      const c2 = new Koinky();
      c2.stamp(new koinky.stamp_arguments(1, ALICE, 1, ""));
    }, "authorization failed");
    allow(SHOP);
    expectFail(() => {
      const c2 = new Koinky();
      c2.stamp(new koinky.stamp_arguments(1, ALICE, 1, ""));
    }, "authorization failed");
    expect(c.balance_of(new koinky.balance_of_arguments(ALICE, id)).stamps).toBe(0);
  });

  it("validates stamp arguments", () => {
    const c = setup();
    loyalty(c);
    expectFail(() => {
      const c2 = new Koinky();
      c2.stamp(new koinky.stamp_arguments(1, ALICE, 0, ""));
    }, "count");
    expectFail(() => {
      const c2 = new Koinky();
      c2.stamp(new koinky.stamp_arguments(1, ALICE, 101, ""));
    }, "count");
    expectFail(() => {
      const c2 = new Koinky();
      c2.stamp(new koinky.stamp_arguments(99, ALICE, 1, ""));
    }, "not found");
    expectFail(() => {
      const c2 = new Koinky();
      c2.stamp(new koinky.stamp_arguments(1, new Uint8Array(3), 1, ""));
    }, "holder");
  });
});
