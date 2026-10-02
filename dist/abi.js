import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
/**
 * The Koinos AssemblyScript SDK writes "entry-point" / "read-only" in its ABI;
 * koilib reads "entry_point" / "read_only". Normalise so both agree.
 */
export function normaliseAbi(raw) {
    const abi = raw;
    const methods = {};
    for (const [name, m] of Object.entries(abi.methods ?? {})) {
        const ep = (m.entry_point ?? m["entry-point"]);
        methods[name] = {
            ...m,
            entry_point: typeof ep === "string" ? parseInt(ep, 16) : ep,
            read_only: Boolean(m.read_only ?? m["read-only"]),
        };
    }
    return { ...abi, methods };
}
/** The kit's bundled contract ABI, normalised. */
let cached = null;
export function kitAbi() {
    if (!cached) {
        const file = fileURLToPath(new URL("../contract/abi/koinky.abi", import.meta.url));
        cached = normaliseAbi(JSON.parse(readFileSync(file, "utf8")));
    }
    return cached;
}
/** Entry point id for a method name, the way the Koinos SDK derives it. */
export function entryPointOf(abi, method) {
    const m = abi.methods[method];
    if (!m)
        throw new Error(`unknown method ${method}`);
    return m.entry_point;
}
