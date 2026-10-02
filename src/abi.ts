import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Abi } from "koilib";

/**
 * The Koinos AssemblyScript SDK writes "entry-point" / "read-only" in its ABI;
 * koilib reads "entry_point" / "read_only". Normalise so both agree.
 */
export function normaliseAbi(raw: unknown): Abi {
  const abi = raw as { methods?: Record<string, Record<string, unknown>>; types?: string; koilib_types?: unknown; events?: unknown };
  const methods: Abi["methods"] = {};
  for (const [name, m] of Object.entries(abi.methods ?? {})) {
    const ep = (m.entry_point ?? m["entry-point"]) as string | number | undefined;
    methods[name] = {
      ...(m as object),
      entry_point: typeof ep === "string" ? parseInt(ep, 16) : (ep as number),
      read_only: Boolean(m.read_only ?? m["read-only"]),
    } as Abi["methods"][string];
  }
  return { ...(abi as object), methods } as Abi;
}

/** The kit's bundled contract ABI, normalised. */
let cached: Abi | null = null;
export function kitAbi(): Abi {
  if (!cached) {
    const file = fileURLToPath(new URL("../contract/abi/koinky.abi", import.meta.url));
    cached = normaliseAbi(JSON.parse(readFileSync(file, "utf8")));
  }
  return cached;
}

/** Entry point id for a method name, the way the Koinos SDK derives it. */
export function entryPointOf(abi: Abi, method: string): number {
  const m = abi.methods[method];
  if (!m) throw new Error(`unknown method ${method}`);
  return m.entry_point;
}
