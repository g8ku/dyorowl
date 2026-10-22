/**
 * The Hoot score rulebook. Pure functions: Evidence in, Report out.
 *
 * Weights add up to 100. Each signal scores 0..1 (or null when the data is
 * missing). Missing signals are left out and the score is rescaled over what
 * was measured; `coverage` says how much of the file was checked.
 */
import type { Evidence, Report, Severity, Signal, Verdict } from "./types.js";

export const WEIGHTS = {
  mintAuthority: 15,
  freezeAuthority: 10,
  top10: 25,
  largestWallet: 10,
  liquidity: 15,
  devHoldings: 10,
  age: 5,
  pressure: 10,
} as const;

export const CAPS = {
  authorityActive: 40, // mint or freeze authority still live
  whaleOver30: 35, // one wallet holds more than 30%
  lowCoverageMax: 74, // can't be a "clean file" unless at least 80% of the checks ran
  cleanMinCoverage: 0.8,
};

/** DexScreener dexIds that mean the token is still on a launchpad bonding curve. */
const BONDING_CURVE_DEXES = new Set(["pumpfun", "moonshot"]);

/** Linear: 1 at or below `good`, 0 at or above `bad` (good < bad). */
const lowerIsBetter = (x: number, good: number, bad: number) => clamp01((bad - x) / (bad - good));
/** Linear: 1 at or above `good`, 0 at or below `bad` (bad < good). */
const higherIsBetter = (x: number, bad: number, good: number) => clamp01((x - bad) / (good - bad));
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

const severityOf = (score: number | null): Severity =>
  score === null ? "warn" : score >= 0.8 ? "good" : score >= 0.4 ? "warn" : "bad";

export function buildSignals(ev: Evidence, now: Date = new Date(ev.fetchedAt)): Signal[] {
  const signals: Signal[] = [];
  const add = (s: Omit<Signal, "severity"> & { severity?: Severity }) =>
    signals.push({ ...s, severity: s.severity ?? severityOf(s.score) });

  // 1. Mint authority
  if (ev.token) {
    const revoked = ev.token.mintAuthority === null;
    add({
      id: "mintAuthority",
      label: "Mint authority",
      value: revoked ? "Revoked" : "Active",
      score: revoked ? 1 : 0,
      weight: WEIGHTS.mintAuthority,
      detail: revoked ? "No one can print more tokens." : "The dev can still mint more tokens and dilute holders.",
    });
    // 2. Freeze authority
    const frozen = ev.token.freezeAuthority === null;
    add({
      id: "freezeAuthority",
      label: "Freeze authority",
      value: frozen ? "Revoked" : "Active",
      score: frozen ? 1 : 0,
      weight: WEIGHTS.freezeAuthority,
      detail: frozen ? "No one can freeze your tokens." : "The dev can freeze token accounts, which can stop you selling.",
    });
  } else {
    add({ id: "mintAuthority", label: "Mint authority", value: "Not checked", score: null, weight: WEIGHTS.mintAuthority });
    add({ id: "freezeAuthority", label: "Freeze authority", value: "Not checked", score: null, weight: WEIGHTS.freezeAuthority });
  }

  // 3 + 4. Holder concentration (wallets only; pools and program accounts excluded)
  const wallets = ev.holders?.filter((h) => h.kind === "wallet");
  if (wallets) {
    const top10 = wallets.slice(0, 10).reduce((s, h) => s + h.pct, 0);
    add({
      id: "top10",
      label: "Top 10 wallets",
      value: `${fmtPct(top10)} of supply`,
      score: lowerIsBetter(top10, 20, 50),
      weight: WEIGHTS.top10,
      detail: "Share held by the 10 largest wallets, not counting pools or program accounts.",
    });
    const largest = wallets[0]?.pct ?? 0;
    add({
      id: "largestWallet",
      label: "Largest wallet",
      value: `${fmtPct(largest)} of supply`,
      score: lowerIsBetter(largest, 5, 15),
      weight: WEIGHTS.largestWallet,
    });
  } else {
    add({ id: "top10", label: "Top 10 wallets", value: "Not checked", score: null, weight: WEIGHTS.top10 });
    add({ id: "largestWallet", label: "Largest wallet", value: "Not checked", score: null, weight: WEIGHTS.largestWallet });
  }

  // 5. Liquidity (log scale between $10K and $50K; not scored on a bonding curve)
  const m = ev.market;
  if (m && BONDING_CURVE_DEXES.has(m.dexId)) {
    add({
      id: "liquidity",
      label: "Liquidity",
      value: "Bonding curve",
      score: null,
      weight: WEIGHTS.liquidity,
      detail: "Still on the launchpad curve, so pool liquidity doesn't apply yet.",
      severity: "warn",
    });
  } else if (m?.liquidityUsd !== undefined) {
    const liq = m.liquidityUsd;
    const score = liq <= 0 ? 0 : higherIsBetter(Math.log10(liq), Math.log10(10_000), Math.log10(50_000));
    add({ id: "liquidity", label: "Liquidity", value: fmtUsd(liq), score, weight: WEIGHTS.liquidity });
  } else {
    add({ id: "liquidity", label: "Liquidity", value: "Not checked", score: null, weight: WEIGHTS.liquidity });
  }

  // 6. Dev (creator) holdings
  if (ev.creator) {
    add({
      id: "devHoldings",
      label: "Dev wallet",
      value: `holds ${fmtPct(ev.creator.holdsPct)}`,
      score: lowerIsBetter(ev.creator.holdsPct, 3, 10),
      weight: WEIGHTS.devHoldings,
      detail: "Share of supply still in the wallet that created the token.",
    });
  } else {
    add({ id: "devHoldings", label: "Dev wallet", value: "Not traced", score: null, weight: WEIGHTS.devHoldings });
  }

  // 7. Age
  if (m?.pairCreatedAt) {
    const hours = Math.max(0, (now.getTime() - m.pairCreatedAt) / 3_600_000);
    add({ id: "age", label: "Age", value: fmtAge(hours), score: higherIsBetter(hours, 1, 24), weight: WEIGHTS.age });
  } else {
    add({ id: "age", label: "Age", value: "Not checked", score: null, weight: WEIGHTS.age });
  }

  // 8. Buy vs sell pressure, last hour (needs at least 10 trades to mean anything)
  const t = m?.txns1h;
  if (t && t.buys + t.sells >= 10) {
    const ratio = t.buys === 0 ? Infinity : t.sells / t.buys;
    add({
      id: "pressure",
      label: "Last hour",
      value: `${t.buys} buys / ${t.sells} sells`,
      score: ratio === Infinity ? 0 : lowerIsBetter(ratio, 1, 2),
      weight: WEIGHTS.pressure,
    });
  } else {
    add({
      id: "pressure",
      label: "Last hour",
      value: t ? "Too few trades" : "Not checked",
      score: null,
      weight: WEIGHTS.pressure,
    });
  }

  return signals;
}

export function scoreEvidence(ev: Evidence, now?: Date): Report {
  const signals = buildSignals(ev, now);
  const measured = signals.filter((s) => s.score !== null);
  const measuredWeight = measured.reduce((s, x) => s + x.weight, 0);
  const totalWeight = signals.reduce((s, x) => s + x.weight, 0);

  let hoot = measuredWeight > 0 ? (measured.reduce((s, x) => s + x.weight * x.score!, 0) / measuredWeight) * 100 : 0;
  const coverage = totalWeight > 0 ? measuredWeight / totalWeight : 0;

  // Hard caps: some red flags override an otherwise good score.
  const authorityActive = ev.token && (ev.token.mintAuthority !== null || ev.token.freezeAuthority !== null);
  if (authorityActive) hoot = Math.min(hoot, CAPS.authorityActive);
  const largest = ev.holders?.find((h) => h.kind === "wallet")?.pct ?? 0;
  if (largest > 30) hoot = Math.min(hoot, CAPS.whaleOver30);
  const thinEvidence = coverage < CAPS.cleanMinCoverage;
  if (thinEvidence) hoot = Math.min(hoot, CAPS.lowCoverageMax);

  const hootScore = Math.round(hoot);
  const verdict = verdictFor(hootScore);
  if (thinEvidence && verdict.band === "care") {
    verdict.advice = "Looks okay so far, but too much is still unknown for a clean file. Size small.";
  }
  return { evidence: ev, signals, hootScore, coverage, verdict };
}

export function verdictFor(score: number): Verdict {
  if (score >= 75) return { band: "clean", title: "Clean file", advice: "No major red flags in what the owl checked. Still size small." };
  if (score >= 50) return { band: "care", title: "Proceed with care", advice: "Some flags. Size small and know your exit." };
  if (score >= 25) return { band: "suspicious", title: "Suspicious", advice: "Several red flags. The owl would sit this one out." };
  return { band: "red", title: "Red flags everywhere", advice: "This looks built to rug. Hard pass." };
}

// ---- formatting helpers (shared with render.ts) ----
export function fmtPct(x: number): string {
  if (x > 0 && x < 0.1) return "<0.1%";
  return `${x < 10 ? x.toFixed(1) : Math.round(x)}%`;
}
export function fmtUsd(x: number): string {
  if (x >= 1e9) return `$${(x / 1e9).toFixed(1)}B`;
  if (x >= 1e6) return `$${(x / 1e6).toFixed(1)}M`;
  if (x >= 1e3) return `$${(x / 1e3).toFixed(1)}K`;
  return `$${Math.round(x)}`;
}
export function fmtAge(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m old`;
  if (hours < 48) return `${Math.round(hours)}h old`;
  return `${Math.round(hours / 24)}d old`;
}
