/**
 * Sample evidence for demos and tests. Addresses are randomly generated and
 * belong to no real token. Do not present these numbers as real data.
 */
import type { Evidence } from "./types.js";

export const DEMO_NOW = "2026-10-21T06:00:00.000Z";
const hoursAgo = (h: number) => new Date(Date.parse(DEMO_NOW) - h * 3_600_000).getTime();

const W = [
  "TnwAxosU8ktpUAKNtemzMevVCZzejsrwishXA31hUDK",
  "954tHrQZbCtqEchfMT7u27bLBh63hqrcGr6vuFvBrSQh",
  "9MdXQZcX7K6D4tTwLztyR5E1QhBf5559F6GjgPGXChoS",
  "6T35SwUqMAHsBoAammaPQfHcmwpxi8yDVGWrKE9eT24t",
  "7kcz2rRgbqCmsjB8DBHt7sQzcas1iPqhKBWgRB8Vh8gs",
  "5UBctrxczucWM1RKqLeB4QHiUG4C7Ldicq2aeUA2mwSk",
  "BeVTFEnFy1RM6hg6QHwQiyNtvXMSu79ajHNQPruivxPq",
] as const;
const POOL = "Esb5p2wnCJemyYRKPs8Tc3yVgs6LSBQb51oSX9jTiHsN";
export const DEMO_MINT = "Fc8BhCnq9GLDL238MKCEBfwcSsrCKjV3z7C5Jz4QUb3V";

/** A reasonably healthy migrated coin: authorities revoked, decent liquidity, a slightly heavy top 10. */
export const healthyCoin: Evidence = {
  mint: DEMO_MINT,
  fetchedAt: DEMO_NOW,
  token: {
    name: "Example Coin",
    symbol: "EXMPL",
    decimals: 6,
    supply: 1_000_000_000,
    program: "spl-token",
    mintAuthority: null,
    freezeAuthority: null,
  },
  holders: [
    { owner: POOL, amount: 180_000_000, pct: 18, kind: "pool" },
    { owner: W[0], amount: 62_000_000, pct: 6.2, kind: "wallet" },
    { owner: W[1], amount: 48_000_000, pct: 4.8, kind: "wallet" },
    { owner: W[2], amount: 41_000_000, pct: 4.1, kind: "wallet" },
    { owner: W[3], amount: 33_000_000, pct: 3.3, kind: "wallet" },
    { owner: W[4], amount: 29_000_000, pct: 2.9, kind: "wallet" },
    { owner: W[5], amount: 26_000_000, pct: 2.6, kind: "wallet" },
    { owner: W[6], amount: 21_000_000, pct: 2.1, kind: "wallet" },
  ],
  market: {
    pairAddress: POOL,
    dexId: "pumpswap",
    priceUsd: 0.000_183,
    liquidityUsd: 48_200,
    marketCapUsd: 183_000,
    volume24hUsd: 412_000,
    priceChange: { m5: 1.2, h1: 6.4, h6: 18.0, h24: 42.0 },
    txns1h: { buys: 212, sells: 168 },
    txns24h: { buys: 4100, sells: 3600 },
    pairCreatedAt: hoursAgo(30),
    poolAddresses: [POOL],
  },
  creator: { address: W[6], holdsPct: 2.1, isTopHolder: true },
  launch: {
    slot: 400_000_000,
    windowSlots: 3,
    buyers: [{ owner: W[6], boughtPct: 2.4, holdsPct: 2.1 }],
    boughtPct: 2.4,
    stillHeldPct: 2.1,
  },
  walletAges: { checked: 7, fresh1dPct: 0, fresh7dPct: 2.6, freshCount7d: 1 },
  gaps: [],
};

/** A coin that looks built to rug: live mint authority, one whale, thin liquidity, sell pressure. */
export const ruggyCoin: Evidence = {
  mint: DEMO_MINT,
  fetchedAt: DEMO_NOW,
  token: {
    name: "Totally Safe",
    symbol: "SAFE",
    decimals: 6,
    supply: 1_000_000_000,
    program: "spl-token",
    mintAuthority: W[0],
    freezeAuthority: null,
  },
  holders: [
    { owner: W[0], amount: 420_000_000, pct: 42, kind: "wallet" },
    { owner: POOL, amount: 90_000_000, pct: 9, kind: "pool" },
    { owner: W[1], amount: 80_000_000, pct: 8, kind: "wallet" },
    { owner: W[2], amount: 60_000_000, pct: 6, kind: "wallet" },
  ],
  market: {
    pairAddress: POOL,
    dexId: "raydium",
    liquidityUsd: 6_100,
    priceChange: { h1: -22 },
    txns1h: { buys: 14, sells: 41 },
    pairCreatedAt: hoursAgo(0.5),
    poolAddresses: [POOL],
  },
  creator: { address: W[0], holdsPct: 42, isTopHolder: true },
  launch: {
    slot: 400_000_000,
    windowSlots: 3,
    buyers: [
      { owner: W[0], boughtPct: 30, holdsPct: 42 },
      { owner: W[1], boughtPct: 9, holdsPct: 8 },
      { owner: W[2], boughtPct: 7, holdsPct: 6 },
    ],
    boughtPct: 46,
    stillHeldPct: 56,
  },
  walletAges: { checked: 3, fresh1dPct: 14, fresh7dPct: 56, freshCount7d: 3 },
  gaps: [],
};

/** A fresh pump.fun coin still on the bonding curve, creator not traced. */
export const curveCoin: Evidence = {
  mint: DEMO_MINT,
  fetchedAt: DEMO_NOW,
  token: {
    symbol: "FRESH",
    decimals: 6,
    supply: 1_000_000_000,
    program: "spl-token",
    mintAuthority: null,
    freezeAuthority: null,
  },
  holders: [
    { owner: POOL, amount: 790_000_000, pct: 79, kind: "program" },
    { owner: W[0], amount: 31_000_000, pct: 3.1, kind: "wallet" },
    { owner: W[1], amount: 22_000_000, pct: 2.2, kind: "wallet" },
  ],
  market: {
    pairAddress: POOL,
    dexId: "pumpfun",
    priceChange: {},
    txns1h: { buys: 6, sells: 2 },
    pairCreatedAt: hoursAgo(2),
    poolAddresses: [POOL],
  },
  gaps: ["Couldn't trace the creator wallet (history too long or unavailable)."],
};
