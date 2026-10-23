import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreEvidence, buildSignals, CAPS } from "../src/score.js";
import { curveCoin, healthyCoin, ruggyCoin, DEMO_NOW } from "../src/fixtures.js";
import type { Evidence } from "../src/types.js";

const now = new Date(DEMO_NOW);
const clone = (e: Evidence): Evidence => structuredClone(e);

test("healthy coin is a clean file with full coverage", () => {
  const r = scoreEvidence(healthyCoin, now);
  assert.equal(r.coverage, 1);
  assert.ok(r.hootScore >= 75, `got ${r.hootScore}`);
  assert.equal(r.verdict.band, "clean");
});

test("ruggy coin gets red flags", () => {
  const r = scoreEvidence(ruggyCoin, now);
  assert.equal(r.verdict.band, "red");
  assert.ok(r.hootScore <= CAPS.authorityActive);
});

test("active mint authority caps an otherwise perfect coin at 40", () => {
  const ev = clone(healthyCoin);
  ev.token!.mintAuthority = "TnwAxosU8ktpUAKNtemzMevVCZzejsrwishXA31hUDK";
  const r = scoreEvidence(ev, now);
  assert.equal(r.hootScore, CAPS.authorityActive);
});

test("active freeze authority also caps at 40", () => {
  const ev = clone(healthyCoin);
  ev.token!.freezeAuthority = "TnwAxosU8ktpUAKNtemzMevVCZzejsrwishXA31hUDK";
  assert.ok(scoreEvidence(ev, now).hootScore <= CAPS.authorityActive);
});

test("one wallet over 30% caps the score at 35", () => {
  const ev = clone(healthyCoin);
  ev.holders!.splice(1, 0, { owner: "x", amount: 310_000_000, pct: 31, kind: "wallet" });
  assert.ok(scoreEvidence(ev, now).hootScore <= CAPS.whaleOver30);
});

test("thin evidence can't be a clean file", () => {
  const r = scoreEvidence(curveCoin, now);
  assert.ok(r.coverage < CAPS.cleanMinCoverage);
  assert.ok(r.hootScore <= CAPS.lowCoverageMax);
  assert.notEqual(r.verdict.band, "clean");
});

test("missing checks are skipped, not counted as zero", () => {
  const signals = buildSignals(curveCoin, now);
  const liq = signals.find((s) => s.id === "liquidity")!;
  const dev = signals.find((s) => s.id === "devHoldings")!;
  assert.equal(liq.score, null); // bonding curve
  assert.equal(dev.score, null); // creator not traced
});

test("pools and program accounts are excluded from concentration", () => {
  const top10 = buildSignals(healthyCoin, now).find((s) => s.id === "top10")!;
  // Wallets only: 6.2+4.8+4.1+3.3+2.9+2.6+2.1 = 26%, the 18% pool is ignored.
  assert.equal(top10.value, "26% of supply");
});

test("top 10 at 30% earns about two-thirds of its points", () => {
  const ev = clone(healthyCoin);
  ev.holders = [{ owner: "a", amount: 0, pct: 30, kind: "wallet" }];
  const top10 = buildSignals(ev, now).find((s) => s.id === "top10")!;
  assert.ok(Math.abs(top10.score! - 2 / 3) < 0.01);
});

test("liquidity scales on a log curve between $10K and $50K", () => {
  const at = (usd: number) => {
    const ev = clone(healthyCoin);
    ev.market!.liquidityUsd = usd;
    return buildSignals(ev, now).find((s) => s.id === "liquidity")!.score!;
  };
  assert.equal(at(5_000), 0);
  assert.equal(at(80_000), 1);
  const mid = at(Math.sqrt(10_000 * 50_000)); // geometric midpoint
  assert.ok(Math.abs(mid - 0.5) < 0.01);
});

test("too few trades means pressure isn't scored", () => {
  const ev = clone(healthyCoin);
  ev.market!.txns1h = { buys: 3, sells: 4 };
  assert.equal(buildSignals(ev, now).find((s) => s.id === "pressure")!.score, null);
});

test("a permanent delegate caps the score hard and says why", () => {
  const ev = clone(healthyCoin);
  ev.token!.risks = { permanentDelegate: "TnwAxosU8ktpUAKNtemzMevVCZzejsrwishXA31hUDK" };
  const r = scoreEvidence(ev, now);
  assert.equal(r.hootScore, CAPS.permanentDelegate);
  assert.match(r.capsApplied.join(" "), /permanent delegate/);
  assert.equal(r.signals.find((s) => s.id === "tokenRules")!.severity, "bad");
});

test("transfer tax caps scale with the rate", () => {
  const at = (bps: number) => {
    const ev = clone(healthyCoin);
    ev.token!.risks = { transferFeeBps: bps };
    return scoreEvidence(ev, now).hootScore;
  };
  assert.equal(at(100), CAPS.anyTax);
  assert.equal(at(500), CAPS.taxOver5);
  assert.equal(at(1000), CAPS.taxOver10);
});

test("snipers still holding a big share lose the points", () => {
  const ev = clone(healthyCoin);
  ev.launch = { slot: 1, windowSlots: 3, buyers: [{ owner: "a", boughtPct: 20, holdsPct: 18 }], boughtPct: 20, stillHeldPct: 18 };
  const s = buildSignals(ev, now).find((x) => x.id === "snipers")!;
  assert.equal(s.score, 0);
  assert.equal(s.severity, "bad");
});

test("fresh wallets are scored on their share of supply", () => {
  const ev = clone(healthyCoin);
  ev.walletAges = { checked: 10, fresh1dPct: 4, fresh7dPct: 9, freshCount7d: 3 };
  const s = buildSignals(ev, now).find((x) => x.id === "freshWallets")!;
  assert.ok(Math.abs(s.score! - 0.5) < 0.01);
});

test("last-hour selling doesn't count for coins older than 3 days, and doesn't hurt coverage", () => {
  const ev = clone(healthyCoin);
  ev.market!.pairCreatedAt = Date.parse(DEMO_NOW) - 30 * 86_400_000;
  ev.market!.txns1h = { buys: 10, sells: 90 };
  const r = scoreEvidence(ev, now);
  const p = r.signals.find((x) => x.id === "pressure")!;
  assert.equal(p.score, null);
  assert.equal(p.notApplicable, true);
  assert.equal(r.coverage, 1);
});

test("exchange wallets are left out of concentration", () => {
  const ev = clone(healthyCoin);
  ev.holders!.unshift({ owner: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", amount: 0, pct: 14, kind: "exchange" });
  const r = scoreEvidence(ev, now);
  assert.equal(r.signals.find((x) => x.id === "largestWallet")!.value, "6.2% of supply");
});

test("an old coin isn't marked down because its launch is too far back to read", () => {
  const ev = clone(healthyCoin);
  delete ev.launch;
  ev.market!.pairCreatedAt = Date.parse(DEMO_NOW) - 30 * 86_400_000;
  const r = scoreEvidence(ev, now);
  assert.equal(r.signals.find((x) => x.id === "snipers")!.notApplicable, true);
  assert.equal(r.coverage, 1);
});

test("no coin ever scores 100", () => {
  const ev = clone(healthyCoin);
  ev.holders = ev.holders!.map((h) => ({ ...h, pct: h.kind === "wallet" ? 1 : h.pct }));
  ev.market!.liquidityUsd = 5_000_000;
  ev.walletAges = { checked: 7, fresh1dPct: 0, fresh7dPct: 0, freshCount7d: 0 };
  ev.creator!.holdsPct = 0;
  const r = scoreEvidence(ev, now);
  assert.equal(r.hootScore, CAPS.perfect);
  assert.deepEqual(r.capsApplied, []);
});
