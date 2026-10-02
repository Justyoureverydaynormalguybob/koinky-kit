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

export const NETWORKS: Record<Network, NetworkConfig> = {
  mainnet: {
    network: "mainnet",
    rpc: "https://api.koinos.io",
    rest: "https://api.koinos.io",
    koin: "19GYjDBVXU7keLbYvMLazsGQn3GTWHjHkK",
  },
  testnet: {
    network: "testnet",
    rpc: "https://testnet.koinosfoundation.org/jsonrpc",
    rest: "https://testnet.koinosfoundation.org",
    koin: "1FaSvLjQJsCJKq5ybmGsMMQs8RQYyVv8ju",
  },
};

export function networkConfig(network: Network = "testnet", overrides: Partial<NetworkConfig> = {}): NetworkConfig {
  return { ...NETWORKS[network], ...overrides, network };
}

/** 1 KOIN = 1 mana = 100,000,000 "satoshis" of rc. */
export const MANA = 100_000_000n;

export const manaToString = (units: bigint | string | number) => (Number(BigInt(units)) / Number(MANA)).toFixed(4);
