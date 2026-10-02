import { test } from "node:test";
import assert from "node:assert/strict";
import { Contract } from "koilib";
import { kitAbi, normaliseAbi, entryPointOf, deriveHolder, holderAddress, isAddress, Batcher, networkConfig, MANA } from "../dist/index.js";

test("bundled ABI is normalised for koilib", () => {
  const abi = kitAbi();
  assert.equal(typeof abi.methods.stamp.entry_point, "number");
  assert.equal(abi.methods.stamp.read_only, false);
  assert.equal(abi.methods.balance_of.read_only, true);
  assert.equal(entryPointOf(abi, "stamp"), 0xe0afcdbf);
  assert.throws(() => entryPointOf(abi, "nope"));
});

test("normaliseAbi accepts both key styles", () => {
  const a = normaliseAbi({ methods: { x: { "entry-point": "0x0000000a", "read-only": true } }, types: "" });
  const b = normaliseAbi({ methods: { x: { entry_point: 10, read_only: true } }, types: "" });
  assert.equal(a.methods.x.entry_point, 10);
  assert.equal(b.methods.x.entry_point, 10);
  assert.equal(a.methods.x.read_only, true);
});

test("holder derivation is deterministic and namespaced", () => {
  const a = deriveHolder("a-secret-of-sufficient-length", 42);
  const b = deriveHolder("a-secret-of-sufficient-length", "42");
  const c = deriveHolder("a-secret-of-sufficient-length", 43);
  const d = deriveHolder("a-secret-of-sufficient-length", 42, "other");
  assert.equal(a.address, b.address);
  assert.notEqual(a.address, c.address);
  assert.notEqual(a.address, d.address);
  assert.equal(holderAddress("a-secret-of-sufficient-length", 42), a.address);
  assert.ok(isAddress(a.address));
  assert.equal(isAddress("not an address"), false);
  assert.throws(() => deriveHolder("short", 1));
});

test("events decode with the bundled ABI", async () => {
  const c = new Contract({ id: "1CduyMhmFhZdpEZgtdyxPUTTezfNFfJoHx", abi: kitAbi() });
  // program_event captured from testnet
  const p = (await c.serializer!.deserialize("CAISGQDAiNglkfVMY60cMKsiVqZBpVB4di8DHbMaD1Ntb2tlIHRlc3QgY2FyZCABKAE=", "koinky.program_event")) as { id: string; name: string; kind: number; active: boolean };
  assert.equal(p.id, "2");
  assert.equal(p.name, "Smoke test card");
  assert.equal(p.kind, 1);
  assert.equal(p.active, true);
});

test("network config and mana units", () => {
  assert.equal(networkConfig("testnet").rpc, "https://testnet.koinosfoundation.org/jsonrpc");
  assert.equal(networkConfig("mainnet", { rpc: "http://localhost:8080" }).rpc, "http://localhost:8080");
  assert.equal(MANA, 100_000_000n);
});

test("batcher keeps one transaction in flight and reports callbacks", async () => {
  const sent: string[][] = [];
  const included: string[][] = [];
  let txCounter = 0;
  const found = new Set<string>();
  const fakeIssuer = {
    sendBatch: async (ops: { ref: string }[]) => {
      txCounter++;
      return { txId: `tx${txCounter}`, rcUsed: "1", receipt: {} };
    },
    txStatus: async (txId: string) => (found.has(txId) ? { found: true, height: "10", final: true } : { found: false, height: null, final: false }),
  };
  const b = new Batcher({
    issuer: fakeIssuer as never,
    batchSize: 2,
    onSent: (refs) => void sent.push(refs.map(String)),
    onIncluded: (refs) => void included.push(refs.map(String)),
  });
  for (const ref of ["a", "b", "c"]) b.enqueue({ ref, kind: "stamp", programId: 1, holder: "x", count: 1 });
  await b.tick(); // sends a+b
  assert.deepEqual(sent, [["a", "b"]]);
  assert.equal(b.pending, 1);
  await b.tick(); // tx1 not found yet: nothing new sent
  assert.equal(sent.length, 1);
  found.add("tx1");
  await b.tick(); // tx1 included, in-flight cleared
  assert.deepEqual(included, [["a", "b"]]);
  await b.tick(); // sends c
  assert.deepEqual(sent, [["a", "b"], ["c"]]);
});
