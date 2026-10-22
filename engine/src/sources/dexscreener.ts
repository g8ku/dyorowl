/**
 * DexScreener public API (no key). Pairs endpoints allow roughly 300 requests/minute.
 * GET https://api.dexscreener.com/token-pairs/v1/solana/{tokenAddress}
 * returns an array of pairs that include this token.
 */
import type { Evidence } from "../types.js";

const BASE = "https://api.dexscreener.com";

/** The subset of DexScreener's pair object we use. Every field is treated as optional. */
export interface DexPair {
  chainId?: string;
  dexId?: string;
  url?: string;
  pairAddress?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  quoteToken?: { address?: string; symbol?: string };
  priceUsd?: string;
  txns?: Record<string, { buys?: number; sells?: number } | undefined>;
  volume?: Record<string, number | undefined>;
  priceChange?: Record<string, number | undefined>;
  liquidity?: { usd?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
}

export async function fetchPairs(mint: string, fetchImpl: typeof fetch = fetch): Promise<DexPair[]> {
  const res = await fetchImpl(`${BASE}/token-pairs/v1/solana/${mint}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`DexScreener HTTP ${res.status}`);
  const body = (await res.json()) as unknown;
  // The endpoint returns an array; older endpoints wrap it as { pairs: [...] }.
  if (Array.isArray(body)) return body as DexPair[];
  if (body && typeof body === "object" && Array.isArray((body as { pairs?: unknown }).pairs)) {
    return (body as { pairs: DexPair[] }).pairs;
  }
  return [];
}

/**
 * Pick the main pair (highest USD liquidity where the token is the base token)
 * and convert it into our Evidence["market"] shape.
 */
export function toMarket(mint: string, pairs: DexPair[]): { market?: Evidence["market"]; name?: string; symbol?: string } {
  const ours = pairs.filter((p) => p.chainId === undefined || p.chainId === "solana");
  if (ours.length === 0) return {};

  const asBase = ours.filter((p) => p.baseToken?.address === mint);
  const pool = (asBase.length ? asBase : ours).slice().sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  const main = pool[0]!;

  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const price = main.priceUsd !== undefined ? Number(main.priceUsd) : undefined;
  const tx = (k: string) => {
    const t = main.txns?.[k];
    return t ? { buys: t.buys ?? 0, sells: t.sells ?? 0 } : undefined;
  };

  return {
    name: main.baseToken?.address === mint ? main.baseToken?.name : undefined,
    symbol: main.baseToken?.address === mint ? main.baseToken?.symbol : undefined,
    market: {
      pairAddress: main.pairAddress ?? "",
      dexId: main.dexId ?? "unknown",
      url: main.url,
      priceUsd: Number.isFinite(price) ? price : undefined,
      liquidityUsd: num(main.liquidity?.usd),
      marketCapUsd: num(main.marketCap),
      fdvUsd: num(main.fdv),
      volume24hUsd: num(main.volume?.h24),
      priceChange: {
        m5: num(main.priceChange?.m5),
        h1: num(main.priceChange?.h1),
        h6: num(main.priceChange?.h6),
        h24: num(main.priceChange?.h24),
      },
      txns1h: tx("h1"),
      txns24h: tx("h24"),
      pairCreatedAt: num(main.pairCreatedAt),
      poolAddresses: ours.map((p) => p.pairAddress).filter((a): a is string => Boolean(a)),
    },
  };
}
