/**
 * Gather all evidence for one token. Network only; no scoring here.
 * A failing source never sinks the whole case: it is recorded in `gaps`
 * and the score is computed from whatever we did get.
 */
import type { Evidence } from "./types.js";
import type { RpcClient } from "./sources/rpc.js";
import { fetchPairs, toMarket } from "./sources/dexscreener.js";
import { balanceOf, fetchHolders, fetchLaunchBuyers, fetchMint, fetchWalletAges, traceLaunch } from "./sources/solana.js";
import { isSolanaAddress } from "./util/address.js";

export interface AnalyzeOptions {
  rpc: RpcClient;
  fetchImpl?: typeof fetch;
  creatorLookupMaxPages?: number;
  /** Page budget for coins under a week old, whose launch is worth the extra calls. */
  youngCoinMaxPages?: number;
  now?: () => Date;
}

export class InvalidAddressError extends Error {}

export async function gatherEvidence(mint: string, opts: AnalyzeOptions): Promise<Evidence> {
  if (!isSolanaAddress(mint)) throw new InvalidAddressError("That doesn't look like a Solana contract address.");

  const { rpc } = opts;
  const now = opts.now ?? (() => new Date());
  const gaps: string[] = [];

  // The mint lookup is the only hard requirement: if it fails, there is no case.
  const [token, pairsResult] = await Promise.all([
    fetchMint(rpc, mint),
    fetchPairs(mint, opts.fetchImpl).then(
      (pairs) => ({ ok: true as const, pairs }),
      (err: unknown) => ({ ok: false as const, err })
    ),
  ]);

  const evidence: Evidence = { mint, fetchedAt: now().toISOString(), token, gaps };

  if (pairsResult.ok) {
    const { market, name, symbol } = toMarket(mint, pairsResult.pairs);
    if (market) {
      evidence.market = market;
      token.name = name;
      token.symbol = symbol;
    } else {
      gaps.push("No trading pair found yet, so liquidity, age and trading activity weren't checked.");
    }
  } else {
    gaps.push("Market data was unavailable, so liquidity, age and trading activity weren't checked.");
  }

  const pools = evidence.market?.poolAddresses ?? [];
  const createdAt = evidence.market?.pairCreatedAt;
  const young = createdAt !== undefined && now().getTime() - createdAt < 7 * 86_400_000;
  const basePages = opts.creatorLookupMaxPages ?? 5;
  const maxPages = young ? Math.max(basePages, opts.youngCoinMaxPages ?? 30) : basePages;
  const [holders, trace] = await Promise.all([
    fetchHolders(rpc, mint, token.supply, pools).catch(() => undefined),
    traceLaunch(rpc, mint, maxPages).catch(() => ({ creator: undefined, firstPage: undefined })),
  ]);
  const creator = trace.creator;

  if (holders) evidence.holders = holders;
  else gaps.push("Holder list was unavailable.");

  // One after the other: each already runs several calls at once, and together they trip free-tier rate limits.
  const launch = trace.firstPage
    ? await fetchLaunchBuyers(rpc, mint, trace.firstPage, token.supply, holders).catch(() => undefined)
    : undefined;
  const walletAges = holders ? await fetchWalletAges(rpc, holders, now()).catch(() => undefined) : undefined;

  if (launch) evidence.launch = launch;
  else gaps.push("Couldn't read the launch, so snipers and bundles weren't checked.");
  if (walletAges) evidence.walletAges = walletAges;
  else if (holders) gaps.push("Couldn't date the largest wallets.");

  if (creator) {
    try {
      const held = await balanceOf(rpc, creator, mint);
      evidence.creator = {
        address: creator,
        holdsPct: token.supply > 0 ? (held / token.supply) * 100 : 0,
        isTopHolder: holders?.some((h) => h.owner === creator) ?? false,
      };
    } catch {
      gaps.push("Couldn't read the creator wallet's balance.");
    }
  } else {
    gaps.push("Couldn't trace the creator wallet (history too long or unavailable).");
  }

  return evidence;
}
