export type Network = "mainnet" | "testnet";
export interface NetworkConfig {
    network: Network;
    /** JSON-RPC endpoint for koilib. Testnet serves it under /jsonrpc, mainnet at the root. */
    rpc: string;
    /** REST base for /v1/... lookups. */
    rest: string;
    /** KOIN token contract, for funding checks. */
    koin: string;
}
export declare const NETWORKS: Record<Network, NetworkConfig>;
export declare function networkConfig(network?: Network, overrides?: Partial<NetworkConfig>): NetworkConfig;
/** 1 KOIN = 1 mana = 100,000,000 "satoshis" of rc. */
export declare const MANA = 100000000n;
export declare const manaToString: (units: bigint | string | number) => string;
