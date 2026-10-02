import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Contract, Provider, Signer, utils } from "koilib";
import { kitAbi } from "./abi.js";
import { MANA, networkConfig } from "./network.js";
/** Two fresh keys: the contract key (cold, uploads) and the issuer (hot, stamps). */
export function generateKeys() {
    const mk = (role) => {
        const s = new Signer({ privateKey: randomBytes(32).toString("hex") });
        return { role, address: s.getAddress(), wif: s.getPrivateKey("wif") };
    };
    return { contract: mk("contract"), issuer: mk("issuer") };
}
export function bundledWasm() {
    return new Uint8Array(readFileSync(fileURLToPath(new URL("../contract/build/release/contract.wasm", import.meta.url))));
}
/**
 * Upload the bundled contract with the contract key and point it at the issuer.
 * The contract's address is the contract key's address. Re-running re-uploads
 * code but keeps every stored program and balance.
 */
export async function deployContract(opts) {
    const net = networkConfig(opts.network ?? "testnet", { rpc: opts.rpc });
    const log = opts.log ?? (() => { });
    const provider = new Provider([net.rpc]);
    const signer = Signer.fromWif(opts.contractWif);
    signer.provider = provider;
    const abi = kitAbi();
    const bytecode = opts.wasm ?? bundledWasm();
    const rc = BigInt(await provider.getAccountRc(signer.getAddress()));
    log(`contract address ${signer.getAddress()} · mana ${utils.formatUnits(rc.toString(), 8)}`);
    if (!opts.skipUpload && rc < 2n * MANA)
        throw new Error("contract address needs at least ~2 KOIN of mana to upload; fund it first");
    const contract = new Contract({ id: signer.getAddress(), abi, provider, signer, bytecode });
    if (!opts.skipUpload) {
        log(`uploading ${bytecode.length} bytes…`);
        const { transaction, receipt } = await contract.deploy({ abi: JSON.stringify(abi), rcLimit: (10n * MANA).toString() });
        log(`upload tx ${transaction.id} rc_used ${utils.formatUnits(receipt.rc_used ?? "0", 8)}`);
        await transaction.wait("byBlock", 120_000);
    }
    log(`setting issuer ${opts.issuerAddress}…`);
    const r = await contract.functions.set_issuer({ issuer: opts.issuerAddress }, { rcLimit: (1n * MANA).toString() });
    await r.transaction.wait("byBlock", 120_000);
    const cfg = (await contract.functions.get_config({})).result;
    return { contractId: signer.getAddress(), config: cfg };
}
