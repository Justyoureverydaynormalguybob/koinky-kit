export const NETWORKS = {
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
export function networkConfig(network = "testnet", overrides = {}) {
    const clean = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined && v !== null && v !== ""));
    return { ...NETWORKS[network], ...clean, network };
}
/** 1 KOIN = 1 mana = 100,000,000 "satoshis" of rc. */
export const MANA = 100000000n;
export const manaToString = (units) => (Number(BigInt(units)) / Number(MANA)).toFixed(4);
