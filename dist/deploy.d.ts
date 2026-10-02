import { type Network } from "./network.js";
export interface KeyPair {
    role: string;
    address: string;
    wif: string;
}
/** Two fresh keys: the contract key (cold, uploads) and the issuer (hot, stamps). */
export declare function generateKeys(): {
    contract: KeyPair;
    issuer: KeyPair;
};
export declare function bundledWasm(): Uint8Array;
/**
 * Upload the bundled contract with the contract key and point it at the issuer.
 * The contract's address is the contract key's address. Re-running re-uploads
 * code but keeps every stored program and balance.
 */
export declare function deployContract(opts: {
    network?: Network;
    contractWif: string;
    issuerAddress: string;
    rpc?: string;
    wasm?: Uint8Array;
    log?: (s: string) => void;
    skipUpload?: boolean;
}): Promise<{
    contractId: string;
    config: Record<string, any> | undefined;
}>;
