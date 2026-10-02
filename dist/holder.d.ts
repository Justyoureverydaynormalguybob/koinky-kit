import { Signer } from "koilib";
/**
 * Holders never sign anything, so their keys can be derived from an app secret
 * and a stable user id. The same (secret, id) always yields the same address,
 * which is how a user's records survive a database loss: log in again, same address.
 *
 * Rotating the secret orphans every address. Treat it like a master key.
 */
export declare function deriveHolder(secret: string, userId: string | number, namespace?: string): {
    address: string;
    signer: Signer;
};
export declare function holderAddress(secret: string, userId: string | number, namespace?: string): string;
/** Validate a Koinos address string (Base58Check, 25 bytes). */
export declare function isAddress(a: unknown): a is string;
