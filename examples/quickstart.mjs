// Issue a stamp to a user who has no wallet, in about twenty lines.
// Needs: a deployed contract (koinky-kit keys && koinky-kit deploy) and env vars below.
import { Issuer, holderAddress } from "koinky-kit";

const issuer = new Issuer({
  network: "testnet",
  contractId: process.env.KOINKY_CONTRACT_ID,
  issuerWif: process.env.KOINKY_ISSUER_WIF,
});

// Your user is identified however you like; derive their address from a secret you keep.
const alice = holderAddress(process.env.HOLDER_KEY_SECRET, "user:42");

// A loyalty card: 5 stamps earns a reward.
const { id: card } = await issuer.createProgram({ name: "Coffee card", kind: "loyalty", threshold: 5 });

// Stamp her twice in one transaction. She signs nothing; the issuer pays the mana.
const sent = await issuer.sendBatch([
  { kind: "stamp", programId: card, holder: alice, count: 1, memo: "flat white" },
  { kind: "stamp", programId: card, holder: alice, count: 1, memo: "americano" },
]);
await issuer.waitIncluded(sent.txId);

console.log(await issuer.balanceOf(alice, card)); // { stamps: "2", spent: "0", unspent: "2", rewards: "0", last: "…" }
