/**
 * Public API of the DYOR Owl research engine.
 *
 *   const report = await investigate(mint, { rpcUrl });
 *   renderReply(report);     // for X
 *   renderCaseFile(report);  // for the site / CLI
 */
import { gatherEvidence, type AnalyzeOptions } from "./analyze.js";
import { scoreEvidence } from "./score.js";
import { createRpcClient } from "./sources/rpc.js";
import type { Report } from "./types.js";

export interface InvestigateOptions extends Partial<AnalyzeOptions> {
  rpcUrl?: string;
}

export async function investigate(mint: string, opts: InvestigateOptions = {}): Promise<Report> {
  const rpc = opts.rpc ?? createRpcClient(opts.rpcUrl ?? process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com");
  const evidence = await gatherEvidence(mint.trim(), {
    ...opts,
    rpc,
    creatorLookupMaxPages: opts.creatorLookupMaxPages ?? Number(process.env.CREATOR_LOOKUP_MAX_PAGES ?? 5),
  });
  return scoreEvidence(evidence);
}

export { gatherEvidence, InvalidAddressError } from "./analyze.js";
export { scoreEvidence, buildSignals, verdictFor, WEIGHTS, CAPS } from "./score.js";
export { renderReply, renderCaseFile, tweetLength } from "./render.js";
export { createRpcClient } from "./sources/rpc.js";
export { isSolanaAddress, extractAddress } from "./util/address.js";
export type * from "./types.js";
