/**
 * Shared types for the DYOR Owl research engine.
 *
 * The pipeline is: gather Evidence (network) -> score it (pure) -> render it (pure).
 * Keeping scoring and rendering pure means they are easy to test and can run
 * unchanged in the CLI, the X bot and the Next.js site.
 */

/** Raw facts collected about a token. Every field may be missing if a source failed. */
export interface Evidence {
  mint: string;
  fetchedAt: string; // ISO timestamp

  token?: {
    name?: string;
    symbol?: string;
    decimals: number;
    supply: number; // UI units (decimal-adjusted)
    program: "spl-token" | "token-2022" | "unknown";
    mintAuthority: string | null; // null = revoked
    freezeAuthority: string | null; // null = revoked
  };

  /** Largest holders, already grouped by owner wallet. Pools and program accounts are flagged. */
  holders?: Holder[];

  market?: {
    pairAddress: string;
    dexId: string; // e.g. "raydium", "pumpswap", "pumpfun"
    url?: string;
    priceUsd?: number;
    liquidityUsd?: number;
    marketCapUsd?: number;
    fdvUsd?: number;
    volume24hUsd?: number;
    priceChange: { m5?: number; h1?: number; h6?: number; h24?: number };
    txns1h?: { buys: number; sells: number };
    txns24h?: { buys: number; sells: number };
    pairCreatedAt?: number; // epoch ms
    poolAddresses: string[]; // all pair addresses for this token, used to spot pool holders
  };

  creator?: {
    address: string;
    holdsPct: number; // % of supply the creator wallet holds right now
    isTopHolder: boolean;
  };

  /** Human-readable notes about anything we could not check. Shown on the card. */
  gaps: string[];
}

export interface Holder {
  owner: string; // wallet (or program account) that owns the token accounts
  amount: number; // UI units
  pct: number; // % of total supply
  kind: "wallet" | "pool" | "program";
}

export type Severity = "good" | "warn" | "bad";

export interface Signal {
  id: string;
  label: string; // short name shown on the card, e.g. "Top 10 holders"
  value: string; // short value shown on the card, e.g. "31% of supply"
  severity: Severity;
  /** 0..1 score for this signal, or null when the data was missing. */
  score: number | null;
  weight: number;
  detail?: string; // one-line explanation for the long-form report
}

export interface Verdict {
  band: "clean" | "care" | "suspicious" | "red";
  title: string;
  advice: string;
}

export interface Report {
  evidence: Evidence;
  signals: Signal[];
  hootScore: number; // 0..100
  /** Share of the total weight we could actually measure, 0..1. */
  coverage: number;
  verdict: Verdict;
}
