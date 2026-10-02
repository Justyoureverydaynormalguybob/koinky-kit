#!/usr/bin/env node
// koinky-kit CLI: keys · deploy · status · smoke · rebuild
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Signer } from "koilib";
import { Issuer, deployContract, generateKeys, rebuildFromChain, rebuiltToCsv } from "../dist/index.js";

const [cmd, ...rest] = process.argv.slice(2);
const flag = (k, d) => (rest.includes(k) ? rest[rest.indexOf(k) + 1] : d);
const network = flag("--network", process.env.KOINOS_NETWORK ?? "testnet");
const keysFile = flag("--keys", `.keys.${network}.json`);
const log = (s) => console.log(s);

function keys() {
  if (!existsSync(keysFile)) throw new Error(`${keysFile} not found; run: koinky-kit keys --network ${network}`);
  return JSON.parse(readFileSync(keysFile, "utf8"));
}
function issuer() {
  const k = keys();
  return new Issuer({ network, contractId: flag("--contract", process.env.KOINKY_CONTRACT_ID ?? k.contract.address), issuerWif: process.env.KOINKY_ISSUER_WIF ?? k.issuer.wif });
}

const commands = {
  async keys() {
    if (existsSync(keysFile) && !rest.includes("--force")) throw new Error(`${keysFile} exists; pass --force to overwrite (orphans the old keys)`);
    const k = { network, created: new Date().toISOString(), ...generateKeys() };
    writeFileSync(keysFile, JSON.stringify(k, null, 2) + "\n", { mode: 0o600 });
    log(`wrote ${keysFile}`);
    log(`contract address (fund with ~2 KOIN to upload): ${k.contract.address}`);
    log(`issuer address   (fund with KOIN for mana):     ${k.issuer.address}`);
    if (network === "testnet") log("testnet faucet: message /faucet <address> to @KoinosTestnetFaucetBot on Telegram");
  },
  async deploy() {
    const k = keys();
    const r = await deployContract({ network, contractWif: k.contract.wif, issuerAddress: k.issuer.address, log, skipUpload: rest.includes("--skip-upload") });
    log(`config: ${JSON.stringify(r.config)}`);
    log(`\nKOINKY_CONTRACT_ID=${r.contractId}`);
    log(`KOINKY_ISSUER_WIF=<issuer wif from ${keysFile}>`);
  },
  async status() {
    const s = await issuer().issuerStatus();
    log(JSON.stringify(s, null, 2));
  },
  async smoke() {
    const i = issuer();
    const before = BigInt(await i.provider.getAccountRc(i.address));
    const holder = Signer.fromSeed("koinky-kit smoke holder").getAddress();
    const { id } = await i.createProgram({ name: "Smoke test", kind: "loyalty", threshold: 3 });
    log(`program #${id}`);
    const s = await i.sendBatch([
      { kind: "stamp", programId: id, holder, count: 2, memo: "one" },
      { kind: "stamp", programId: id, holder, count: 1, memo: "two" },
      { kind: "redeem", programId: id, holder, count: 1, memo: "reward" },
    ]);
    log(`batch of 3 ops in ${s.txId} (rc ${s.rcUsed})`);
    await i.waitIncluded(s.txId);
    log(`balance: ${JSON.stringify(await i.balanceOf(holder, id))}`);
    const after = BigInt(await i.provider.getAccountRc(i.address));
    log(`mana spent: ${(Number(before - after) / 1e8).toFixed(4)}`);
  },
  async rebuild() {
    const contractId = flag("--contract", process.env.KOINKY_CONTRACT_ID ?? (existsSync(keysFile) ? keys().contract.address : null));
    if (!contractId) throw new Error("pass --contract <address>");
    const r = await rebuildFromChain({ network, contractId, programId: flag("--program", undefined), log });
    const out = flag("--out", "rebuild.json");
    writeFileSync(out, JSON.stringify(r, null, 2));
    writeFileSync(out.replace(/\.json$/, ".csv"), rebuiltToCsv(r));
    for (const p of r.programs) {
      log(`program #${p.id} "${p.name}" minted=${p.minted} redeemed=${p.redeemed} holders=${r.holders[p.id].length}`);
    }
    log(`wrote ${out} and ${out.replace(/\.json$/, ".csv")} (${r.events.length} events)`);
  },
  help() {
    log(`koinky-kit <command> [--network testnet|mainnet] [--keys file]

  keys                 generate contract + issuer keys into .keys.<network>.json
  deploy [--skip-upload]  upload the bundled contract and set the issuer
  status               issuer address, mana, on-chain config
  smoke                create a program, stamp twice, redeem, read back
  rebuild [--contract A] [--program N] [--out f.json]   rebuild records from the chain`);
  },
};

(commands[cmd] ?? commands.help)().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
