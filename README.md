# koinky-kit

Issue records on the [Koinos](https://koinos.io) blockchain to people who have no wallet, with one key and no fees for anyone.

A record is a stamp on a loyalty card, an attendance mark, a membership, a certificate, a volunteer hour. The kit gives you a deployed contract, a typed issuer client, a batcher that keeps exactly one transaction in flight, deterministic holder addresses derived from your own user ids, and a routine that rebuilds every program, balance and dated event from the chain alone.

Built for and extracted from [Koinky](https://koinky.ie), where it mirrors every café stamp to Koinos for about 0.05 mana each.

## Why Koinos for this

- **Feeless.** Transactions spend mana, which regenerates, never KOIN. A key holding a few thousand KOIN issues thousands of records a day for nothing.
- **Nobody needs a wallet.** The issuer signs and pays; holders are plain addresses you derive from your user ids. Records are soulbound, so those keys guard nothing of value and can stay server-side.
- **Rebuildable.** Programs and balances live in contract state; every change is an event. Lose your database and `rebuildFromChain` gives it back.

## Install

```sh
npm install koinky-kit        # or: npm install github:Justyoureverydaynormalguybob/koinky-kit
```

Node 20+. Pure TypeScript on top of [koilib](https://github.com/joticajulian/koilib); no native modules.

## Quickstart

```sh
npx koinky-kit keys --network testnet      # writes .keys.testnet.json (two keys)
# fund both addresses: testnet faucet is Telegram, /faucet <address> to @KoinosTestnetFaucetBot
npx koinky-kit deploy --network testnet    # uploads the bundled contract, sets the issuer
npx koinky-kit smoke --network testnet     # program + 3 ops in one tx + read back
```

```js
import { Issuer, holderAddress } from "koinky-kit";

const issuer = new Issuer({ network: "testnet", contractId: process.env.KOINKY_CONTRACT_ID, issuerWif: process.env.KOINKY_ISSUER_WIF });
const alice = holderAddress(process.env.HOLDER_KEY_SECRET, "user:42");

const { id: card } = await issuer.createProgram({ name: "Coffee card", kind: "loyalty", threshold: 5 });
const sent = await issuer.sendBatch([
  { kind: "stamp", programId: card, holder: alice, count: 1, memo: "flat white" },
  { kind: "stamp", programId: card, holder: alice, count: 1 },
]);
await issuer.waitIncluded(sent.txId);
console.log(await issuer.balanceOf(alice, card)); // { stamps: "2", spent: "0", unspent: "2", rewards: "0", last: "…" }
```

## The contract

AssemblyScript, 14 entry points, issuer-only writes, no transfer. Source in `contract/assembly`, prebuilt WASM and ABI bundled, 13 mock-VM tests.

| Entry point | Who | What |
|---|---|---|
| `create_program` | issuer | a loyalty card (many records per holder) or attendance event (one per holder), with optional window, cap and reward threshold |
| `update_program` | issuer | rename, pause, change cap or threshold |
| `stamp` | issuer | issue `count` records to a holder |
| `redeem` | issuer | spend `threshold × count` records for `count` rewards |
| `revoke` | issuer | remove unspent records |
| `set_issuer`, `set_owner` | owner | rotate the hot key; move ownership to a cold key |
| `balance_of`, `get_program`, `get_programs`, `get_config`, `name`, `symbol`, `uri` | anyone | reads |

Storage is one small counter per holder per program, updated in place, so a holder with 500 records uses the same space as one with a single record. Events are `koinky.program_event`, `koinky.stamp_event`, `koinky.redeem_event`, `koinky.revoke_event`, each impacting the holder, which is what makes rebuild possible.

Live on testnet at `1CduyMhmFhZdpEZgtdyxPUTTezfNFfJoHx`. Deploy your own; the contract address is your contract key's address.

## API

- `new Issuer({ network, contractId, issuerWif, rpc?, rest?, manaPerOp?, manaFloor? })`
  - `createProgram(input)`, `updateProgram(id, patch)`
  - `sendBatch(ops)` → `{ txId, rcUsed, receipt }`; `send(op)`, `stamp()`, `redeem()`, `revoke()` wait for inclusion
  - `balanceOf(holder, programId)`, `getProgram(id)`, `getPrograms(start, limit)`, `allPrograms()`, `getConfig()`, `issuerStatus()`
  - `txStatus(txId)` → `{ found, height, final }`; `waitIncluded(txId)`
  - `decodeEvent(name, data)`, `rcLimitFor(opCount)`
- `new Batcher({ issuer, batchSize, onSent, onIncluded, onFailed })` with `enqueue(op)` and `tick()`. Persistence is yours: save `ref → txId` in `onSent`, requeue in `onFailed`, re-enqueue unconfirmed refs on boot.
- `deriveHolder(secret, userId)`, `holderAddress(secret, userId)`, `isAddress(a)`
- `rebuildFromChain({ network, contractId, programId? })`, `rebuiltToCsv(result)`
- `generateKeys()`, `deployContract({ network, contractWif, issuerAddress })`, `bundledWasm()`
- `normaliseAbi(raw)`, `kitAbi()`, `networkConfig(network)`

## Things that cost us a day each, so you don't have to

1. **The VM is WASM MVP.** Build with `exportStart: "_start"` and `disable: ["sign-extension", "bulk-memory"]` in `asconfig.json`, or the node rejects the module ("unknown section 12") or traps at instantiation ("start function failed").
2. **ABI key names differ.** The SDK writes `entry-point` and `read-only`; koilib reads `entry_point` and `read_only`. Without normalising, every call hits the unknown-method branch and reverts with no message. `kitAbi()` handles it.
3. **Keep `rc_limit` tight.** The mempool reserves the full limit of recent transactions for a while, so a generous limit gets "insufficient pending account resources" even with plenty of mana. A record costs about 0.05 mana; the kit budgets 0.2 per op plus 0.5.
4. **One transaction in flight per key.** The public API's nodes do not always share a pending-nonce view; a second transaction before the first is included can fail with "invalid account nonce". The `Batcher` enforces this. A rejected batch never applied, so retrying whole is safe.
5. **Empty results are `undefined`.** An all-zero `balance_of` encodes to empty bytes; koilib returns `undefined`. `balanceOf` normalises to zeros.
6. **Testnet endpoints.** JSON-RPC at `https://testnet.koinosfoundation.org/jsonrpc`, REST under `/v1`; mainnet serves both at `https://api.koinos.io`. The faucet is a Telegram bot with a 24-hour cooldown per user.

If you need to anchor arbitrary data rather than counters, look at [KoinosProof](https://koinosproof.com): Merkle-batched hash anchoring on Koinos mainnet, where one `certify_batch` costs the same whether it carries one leaf or a thousand.

## Build the contract yourself

```sh
cd contract && npm install --ignore-scripts
sh scripts/build.sh release 0     # needs protoc on PATH (Termux: pkg install protobuf)
sh scripts/test.sh                # as-pect against @koinos/mock-vm
```

## Licence

AGPL-3.0. Use it, change it, ship it; if you run a modified version as a service, publish your changes. Koinky itself is a separate, proprietary product built on this kit.
