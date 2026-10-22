/**
 * Gather all evidence for one token. Network only; no scoring here.
 * A failing source never sinks the whole case: it is recorded in `gaps`
 * and the score is computed from whatever we did get.
 */
import type { Evidence } from "./types.js";
import type { RpcClient } from "./sources/rpc.js";
import { fetchPairs, toMarket } from "./sources/dexscreener.js";
import { balanceOf, fetchHolders, fetchMint, findCreator } from "./sources/solana.js";
import { isSolanaAddress } from "./util/address.js";

export interface AnalyzeOptions {
  rpc: RpcClient;
  fetchImpl?: typeof fetch;
  creatorLookupMaxPages?: number;
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
  const [holders, creator] = await Promise.all([
    fetchHolders(rpc, mint, token.supply, pools).catch(() => undefined),
    findCreator(rpc, mint, opts.creatorLookupMaxPages ?? 5).catch(() => undefined),
  ]);

  if (holders) evidence.holders = holders;
  else gaps.push("Holder list was unavailable.");

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
