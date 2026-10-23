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
  top10: 20,
  largestWallet: 5,
  liquidity: 10,
  devHoldings: 10,
  snipers: 10,
  freshWallets: 10,
  age: 5,
  pressure: 5,
} as const;

export const CAPS = {
  perfect: 99, // no coin is ever a sure thing, so nothing scores 100
  authorityActive: 40, // mint or freeze authority still live
  whaleOver30: 35, // one wallet holds more than 30%
  lowCoverageMax: 74, // can't be a "clean file" unless at least 80% of the checks ran
  cleanMinCoverage: 0.8,
  // Token-2022 traps
  permanentDelegate: 15, // someone can move or burn your tokens
  nonTransferable: 10, // you can't sell at all
  transferHook: 40, // custom code runs on every transfer and can block sells
  pausable: 40, // transfers can be switched off
  defaultFrozen: 40, // new holders start frozen
  taxOver10: 25,
  taxOver5: 40,
  anyTax: 60,
};

/** Coins older than this aren't scored on last-hour selling: for an established coin it's just trading. */
const PRESSURE_MAX_AGE_HOURS = 72;
/** Past this, a coin's launch is usually too far back to read, so missing sniper data isn't held against it. */
const SNIPERS_MAX_AGE_HOURS = 7 * 24;

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
    // Token-2022 traps (no weight: they act through hard caps instead)
    const traps = trapsOf(ev);
    add({
      id: "tokenRules",
      label: "Token rules",
      value: traps.length ? traps.map((t) => t.label).join(", ") : ev.token.program === "token-2022" ? "Token-2022, no traps found" : "Standard token",
      score: traps.length === 0 ? 1 : Math.min(...traps.map((t) => t.cap)) <= 40 ? 0 : 0.5,
      weight: 0,
      detail: traps.length ? traps.map((t) => t.detail).join(" ") : "No transfer tax, no permanent delegate, no transfer hook.",
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
      notApplicable: true,
    });
  } else if (m?.liquidityUsd !== undefined) {
    const liq = m.liquidityUsd;
    const score = liq <= 0 ? 0 : higherIsBetter(Math.log10(liq), Math.log10(10_000), Math.log10(50_000));
    add({ id: "liquidity", label: "Liquidity", value: fmtUsd(liq), score, weight: WEIGHTS.liquidity });
  } else if (m) {
    add({
      id: "liquidity",
      label: "Liquidity",
      value: "Not reported",
      score: null,
      weight: WEIGHTS.liquidity,
      detail: "DexScreener doesn't report liquidity for the main pair (often a pool against another token).",
    });
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

  const ageHours = m?.pairCreatedAt ? Math.max(0, (now.getTime() - m.pairCreatedAt) / 3_600_000) : undefined;

  // 7. Launch snipers and bundles: what the first-blocks buyers still hold
  const l = ev.launch;
  if (l) {
    const n = l.buyers.length;
    const seconds = Math.max(1, Math.round((l.windowSlots + 1) * 0.4));
    add({
      id: "snipers",
      label: "Launch snipers",
      value: n === 0 ? "None found" : `bought ${fmtPct(l.boughtPct)}, still hold ${fmtPct(l.stillHeldPct)}`,
      score: lowerIsBetter(l.stillHeldPct, 3, 15),
      weight: WEIGHTS.snipers,
      detail:
        n === 0
          ? `No wallet bought in the first ~${seconds}s after launch.`
          : `${n} wallet${n === 1 ? "" : "s"} (dev included) bought in the first ~${seconds}s after launch, which takes a bundle or a bot. Scored on what they still hold.`,
    });
  } else if (ageHours !== undefined && ageHours > SNIPERS_MAX_AGE_HOURS) {
    // An old coin's launch is too far back to read, and any big sniper bag shows up in the top holders anyway.
    add({ id: "snipers", label: "Launch snipers", value: "Not checked on coins over 7 days old", score: null, weight: WEIGHTS.snipers, notApplicable: true });
  } else {
    add({ id: "snipers", label: "Launch snipers", value: "Not checked", score: null, weight: WEIGHTS.snipers });
  }

  // 8. Fresh wallets among the largest holders
  const a = ev.walletAges;
  if (a && a.checked > 0) {
    add({
      id: "freshWallets",
      label: "Fresh wallets",
      value: `${fmtPct(a.fresh7dPct)} held by wallets under 7d old`,
      score: lowerIsBetter(a.fresh7dPct, 3, 15),
      weight: WEIGHTS.freshWallets,
      detail: `${a.freshCount7d} of the top ${a.checked} wallets were created in the last week (${fmtPct(a.fresh1dPct)} of supply in the last 24h). Brand-new wallets often mean one person split their bag.`,
    });
  } else if (a) {
    add({ id: "freshWallets", label: "Fresh wallets", value: "No wallets to check", score: null, weight: WEIGHTS.freshWallets, notApplicable: true });
  } else {
    add({ id: "freshWallets", label: "Fresh wallets", value: "Not checked", score: null, weight: WEIGHTS.freshWallets });
  }

  // 9. Age
  if (ageHours !== undefined) {
    const hours = ageHours;
    add({ id: "age", label: "Age", value: fmtAge(hours), score: higherIsBetter(hours, 1, 24), weight: WEIGHTS.age });
  } else {
    add({ id: "age", label: "Age", value: "Not checked", score: null, weight: WEIGHTS.age });
  }

  // 10. Buy vs sell pressure, last hour (needs at least 10 trades, and only for young coins)
  const t = m?.txns1h;
  if (ageHours !== undefined && ageHours > PRESSURE_MAX_AGE_HOURS) {
    add({
      id: "pressure",
      label: "Last hour",
      value: "Not scored after 3 days",
      score: null,
      weight: WEIGHTS.pressure,
      notApplicable: true,
    });
  } else if (t && t.buys + t.sells >= 10) {
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
  const totalWeight = signals.filter((s) => !s.notApplicable).reduce((s, x) => s + x.weight, 0);

  let hoot = measuredWeight > 0 ? (measured.reduce((s, x) => s + x.weight * x.score!, 0) / measuredWeight) * 100 : 0;
  const coverage = totalWeight > 0 ? measuredWeight / totalWeight : 0;

  // Hard caps: some red flags override an otherwise good score.
  const capsApplied: string[] = [];
  const cap = (max: number, reason: string) => {
    if (hoot > max) {
      hoot = max;
      capsApplied.push(`${reason} (max ${max})`);
    }
  };
  const authorityActive = ev.token && (ev.token.mintAuthority !== null || ev.token.freezeAuthority !== null);
  if (authorityActive) cap(CAPS.authorityActive, "Mint or freeze authority is still active");
  for (const t of trapsOf(ev)) cap(t.cap, t.capReason);
  const largest = ev.holders?.find((h) => h.kind === "wallet")?.pct ?? 0;
  if (largest > 30) cap(CAPS.whaleOver30, `One wallet holds ${fmtPct(largest)}`);
  const thinEvidence = coverage < CAPS.cleanMinCoverage;
  if (thinEvidence) cap(CAPS.lowCoverageMax, "Too few checks ran for a clean file");

  // Applied after rounding, so 99.6 can't round up to 100. Not listed in capsApplied: it isn't a red flag.
  const hootScore = Math.min(Math.round(hoot), CAPS.perfect);
  const verdict = verdictFor(hootScore);
  if (thinEvidence && verdict.band === "care") {
    verdict.advice = "Looks okay so far, but too much is still unknown for a clean file. Size small.";
  }
  return { evidence: ev, signals, hootScore, coverage, verdict, capsApplied };
}

interface Trap {
  label: string; // short, for the card
  detail: string; // one sentence, for the case file
  cap: number;
  capReason: string;
}

/** Token-2022 settings that let the dev tax, block or take holders' tokens. */
function trapsOf(ev: Evidence): Trap[] {
  const r = ev.token?.risks;
  if (!r) return [];
  const traps: Trap[] = [];
  if (r.permanentDelegate) {
    traps.push({
      label: "permanent delegate",
      detail: "One address can move or burn anyone's tokens at any time.",
      cap: CAPS.permanentDelegate,
      capReason: "A permanent delegate can take holders' tokens",
    });
  }
  if (r.nonTransferable) {
    traps.push({ label: "can't be transferred", detail: "Tokens can't be moved, so they can't be sold.", cap: CAPS.nonTransferable, capReason: "Tokens can't be transferred" });
  }
  if (r.transferFeeBps) {
    const pct = r.transferFeeBps / 100;
    const [max, why] = pct >= 10 ? [CAPS.taxOver10, "10%+"] : pct >= 5 ? [CAPS.taxOver5, "5%+"] : [CAPS.anyTax, "any"];
    traps.push({
      label: `${pct.toFixed(pct % 1 ? 1 : 0)}% transfer tax`,
      detail: `Every transfer, including buys and sells, pays a ${pct}% fee to the dev's fee account.`,
      cap: max,
      capReason: `Transfer tax (${why})`,
    });
  }
  if (r.transferHookProgram) {
    traps.push({
      label: "transfer hook",
      detail: "Custom code runs on every transfer and can block sells.",
      cap: CAPS.transferHook,
      capReason: "A transfer hook can block sells",
    });
  }
  if (r.pausable) {
    traps.push({ label: "pausable", detail: "An authority can pause all transfers.", cap: CAPS.pausable, capReason: "Transfers can be paused" });
  }
  if (r.defaultFrozen) {
    traps.push({ label: "frozen by default", detail: "New token accounts start frozen until the dev unfreezes them.", cap: CAPS.defaultFrozen, capReason: "New holders start frozen" });
  }
  return traps;
}

export function verdictFor(score: number): Verdict {
  if (score >= 75) return { band: "clean", title: "Clean file", advice: "No major red flags in what the owl checked. Still size small." };
  if (score >= 50) return { band: "care", title: "Proceed with care", advice: "Some flags. Size small and know your exit." };
  if (score >= 25) return { band: "suspicious", title: "Suspicious", advice: "Several red flags. The owl would sit this one out." };
  return { band: "red", title: "Red flags everywhere", advice: "This looks built to rug. Hard pass." };
}

// ---- formatting helpers (shared with render.ts) ----
export function fmtPct(x: number): string {
  if (x === 0) return "0%";
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
