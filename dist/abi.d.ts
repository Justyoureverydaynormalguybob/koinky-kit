import type { Abi } from "koilib";
/**
 * The Koinos AssemblyScript SDK writes "entry-point" / "read-only" in its ABI;
 * koilib reads "entry_point" / "read_only". Normalise so both agree.
 */
export declare function normaliseAbi(raw: unknown): Abi;
export declare function kitAbi(): Abi;
/** Entry point id for a method name, the way the Koinos SDK derives it. */
export declare function entryPointOf(abi: Abi, method: string): number;
