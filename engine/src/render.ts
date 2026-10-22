/**
 * Turn a Report into text: a short X reply (fits 280 weighted characters)
 * and a long-form case file for the CLI and website.
 */
import type { Report, Severity, Signal } from "./types.js";
import { shortAddr } from "./util/address.js";

const ICON: Record<Severity, string> = { good: "✅", warn: "⚠️", bad: "🚩" };
const RANK: Record<Severity, number> = { bad: 0, warn: 1, good: 2 };

/**
 * X counts most characters as 1 and emoji/CJK as 2. URLs count as 23, but the
 * owl's replies never contain links (links make posts far more expensive on
 * the X API), so we don't handle them here.
 */
export function tweetLength(text: string): number {
  let n = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0xfe0f || cp === 0x200d) continue; // variation selector / ZWJ add nothing
    n += cp <= 0x10ff || (cp >= 0x2000 && cp <= 0x200d) || (cp >= 0x2010 && cp <= 0x201f) || (cp >= 0x2032 && cp <= 0x2037) ? 1 : 2;
  }
  return n;
}

function caseName(r: Report): string {
  const sym = r.evidence.token?.symbol;
  return sym ? `$${sym.replace(/^\$/, "")}` : shortAddr(r.evidence.mint);
}

/** The reply the bot posts on X. */
export function renderReply(r: Report, maxLen = 280): string {
  const head = [`🦉 Case file: ${caseName(r)}`, `Hoot score ${r.hootScore}/100 · ${r.verdict.title}`];
  const foot = `Checked ${Math.round(r.coverage * 100)}% · NFA, DYOR`;

  const measured = r.signals.filter((s) => s.score !== null);
  const lines: string[] = [];

  // Authorities collapse into one line when both agree.
  const mint = measured.find((s) => s.id === "mintAuthority");
  const freeze = measured.find((s) => s.id === "freezeAuthority");
  if (mint && freeze && mint.value === freeze.value) {
    lines.push(`${ICON[mint.severity]} Mint & freeze ${mint.value.toLowerCase()}`);
  } else {
    for (const s of [mint, freeze]) if (s) lines.push(`${ICON[s.severity]} ${s.label} ${s.value.toLowerCase()}`);
  }

  // Then the rest, worst first.
  const rest = measured
    .filter((s) => s.id !== "mintAuthority" && s.id !== "freezeAuthority")
    .sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.weight - a.weight);
  for (const s of rest) lines.push(`${ICON[s.severity]} ${replyLine(s)}`);

  // Drop lines from the bottom until it fits.
  while (lines.length > 0) {
    const text = [...head, "", ...lines, "", foot].join("\n");
    if (tweetLength(text) <= maxLen) return text;
    lines.pop();
  }
  return [...head, "", foot].join("\n");
}

function replyLine(s: Signal): string {
  switch (s.id) {
    case "top10":
      return `Top 10 wallets: ${s.value.replace(" of supply", "")}`;
    case "largestWallet":
      return `Largest wallet: ${s.value.replace(" of supply", "")}`;
    case "devHoldings":
      return `Dev ${s.value}`;
    case "pressure":
      return `1h: ${s.value}`;
    default:
      return `${s.label}: ${s.value}`;
  }
}

/** Long-form case file in Markdown (CLI output, website, logs). */
export function renderCaseFile(r: Report): string {
  const ev = r.evidence;
  const t = ev.token;
  const out: string[] = [];
  out.push(`# Case file: ${caseName(r)}${t?.name ? ` (${t.name})` : ""}`);
  out.push("");
  out.push(`Contract: ${ev.mint}`);
  out.push(`Checked: ${new Date(ev.fetchedAt).toUTCString()}`);
  out.push("");
  out.push(`## Hoot score: ${r.hootScore}/100. ${r.verdict.title}`);
  out.push(r.verdict.advice);
  out.push(`Evidence covered: ${Math.round(r.coverage * 100)}% of the checks.`);
  out.push("");
  out.push("## Evidence");
  for (const s of r.signals) {
    const pts = s.score === null ? "not scored" : `${Math.round(s.score * s.weight)}/${s.weight} pts`;
    out.push(`- ${s.score === null ? "▫️" : ICON[s.severity]} **${s.label}:** ${s.value} (${pts})${s.detail ? `. ${s.detail}` : ""}`);
  }
  const wallets = ev.holders?.filter((h) => h.kind === "wallet").slice(0, 5);
  if (wallets?.length) {
    out.push("");
    out.push("## Top wallets");
    for (const h of wallets) {
      const tag = ev.creator?.address === h.owner ? " (creator)" : "";
      out.push(`- ${shortAddr(h.owner)}${tag}: ${h.pct.toFixed(2)}%`);
    }
  }
  const excluded = ev.holders?.filter((h) => h.kind !== "wallet");
  if (excluded?.length) {
    out.push("");
    out.push(`Excluded from concentration: ${excluded.map((h) => `${shortAddr(h.owner)} (${h.kind}, ${h.pct.toFixed(1)}%)`).join(", ")}`);
  }
  if (ev.market?.url) {
    out.push("");
    out.push(`Chart: ${ev.market.url}`);
  }
  if (ev.gaps.length) {
    out.push("");
    out.push("## Not checked");
    for (const g of ev.gaps) out.push(`- ${g}`);
  }
  out.push("");
  out.push("Not financial advice. The owl checks a few things; it can't see everything. Always do your own research.");
  return out.join("\n");
}
