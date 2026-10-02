import { createHmac } from "node:crypto";
import { Signer, utils } from "koilib";
/**
 * Holders never sign anything, so their keys can be derived from an app secret
 * and a stable user id. The same (secret, id) always yields the same address,
 * which is how a user's records survive a database loss: log in again, same address.
 *
 * Rotating the secret orphans every address. Treat it like a master key.
 */
export function deriveHolder(secret, userId, namespace = "koinky:holder") {
    if (!secret || secret.length < 16)
        throw new Error("holder secret must be at least 16 characters");
    const seed = createHmac("sha256", secret).update(`${namespace}:${userId}`).digest("hex");
    const signer = Signer.fromSeed(seed);
    return { address: signer.getAddress(), signer };
}
export function holderAddress(secret, userId, namespace) {
    return deriveHolder(secret, userId, namespace).address;
}
/** Validate a Koinos address string (Base58Check, 25 bytes). */
export function isAddress(a) {
    if (typeof a !== "string")
        return false;
    try {
        return utils.isChecksumAddress(a);
    }
    catch {
        return false;
    }
}
