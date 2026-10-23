/**
 * On-chain lookups via Solana JSON-RPC:
 *  - mint info (supply, decimals, mint/freeze authority, token program, Token-2022 traps)
 *  - largest holders, grouped by owner and classified wallet / pool / program / exchange
 *  - the token's creator (first signer of its oldest transaction) and what it still holds
 *  - who bought in the first blocks after launch (bundles and snipers)
 *  - how old the largest wallets are
 */
import type { Evidence, Holder, TokenRisks } from "../types.js";
import type { RpcClient } from "./rpc.js";
import { isOnCurve } from "../util/address.js";

const SPL_TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/** Pool authorities that are not PDAs-with-data and would otherwise look odd. Extend as needed. */
const KNOWN_POOL_OWNERS = new Set<string>([
  "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1", // Raydium AMM v4 authority
]);

/**
 * Exchange hot wallets. They hold customers' coins, so they aren't whales.
 * Labels from Solscan; extend as needed.
 */
const KNOWN_EXCHANGES = new Set<string>([
  "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", // Binance
  "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9", // Binance
  "H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS", // Coinbase
  "GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE", // Coinbase
  "5VCwKtCXgCJ6kit5FybXjvriW3xELsFDhYrPSqtJNmcD", // OKX
  "AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2", // Bybit
  "FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5", // Kraken
]);

/** Transactions newer than v0 exist on mainnet; asking for less makes getTransaction fail. */
const MAX_TX_VERSION = 1;

type Parsed<T> = { parsed: { type: string; info: T }; program: string };
interface AccountInfo<D> {
  owner: string;
  data: D;
}

interface MintInfo {
  decimals: number;
  supply: string;
  mintAuthority?: string | null;
  freezeAuthority?: string | null;
  extensions?: { extension: string; state?: Record<string, unknown> }[];
}

interface SignatureInfo {
  signature: string;
  slot?: number;
  blockTime?: number | null;
  err?: unknown;
}

export async function fetchMint(rpc: RpcClient, mint: string): Promise<NonNullable<Evidence["token"]>> {
  const res = await rpc.call<{ value: AccountInfo<Parsed<MintInfo> | unknown> | null }>("getAccountInfo", [
    mint,
    { encoding: "jsonParsed", commitment: "confirmed" },
  ]);
  const acct = res.value;
  if (!acct) throw new Error("No account found at this address on Solana mainnet.");
  const data = acct.data as Parsed<MintInfo>;
  if (!data?.parsed || data.parsed.type !== "mint") {
    throw new Error("This address is not a token mint. Make sure you copied the contract address, not a wallet or pair.");
  }
  const info = data.parsed.info;
  return {
    decimals: info.decimals,
    supply: Number(info.supply) / 10 ** info.decimals,
    program: acct.owner === SPL_TOKEN ? "spl-token" : acct.owner === TOKEN_2022 ? "token-2022" : "unknown",
    mintAuthority: info.mintAuthority ?? null,
    freezeAuthority: info.freezeAuthority ?? null,
    ...(info.extensions ? { risks: readRisks(info.extensions) } : {}),
  };
}

/** Pull the holder-hostile Token-2022 extensions out of a parsed mint. */
export function readRisks(extensions: NonNullable<MintInfo["extensions"]>): TokenRisks {
  const risks: TokenRisks = {};
  for (const { extension, state = {} } of extensions) {
    switch (extension) {
      case "transferFeeConfig": {
        // A newer fee may already be scheduled; take the higher of the two.
        const bps = (k: string) => Number((state[k] as { transferFeeBasisPoints?: number } | undefined)?.transferFeeBasisPoints ?? 0);
        const fee = Math.max(bps("olderTransferFee"), bps("newerTransferFee"));
        if (fee > 0) risks.transferFeeBps = fee;
        break;
      }
      case "permanentDelegate":
        if (typeof state.delegate === "string") risks.permanentDelegate = state.delegate;
        break;
      case "transferHook":
        if (typeof state.programId === "string") risks.transferHookProgram = state.programId;
        break;
      case "nonTransferable":
        risks.nonTransferable = true;
        break;
      case "defaultAccountState":
        if (state.accountState === "frozen") risks.defaultFrozen = true;
        break;
      case "pausableConfig":
        if (typeof state.authority === "string") risks.pausable = true;
        break;
    }
  }
  return risks;
}

export async function fetchHolders(
  rpc: RpcClient,
  mint: string,
  supply: number,
  poolAddresses: string[]
): Promise<Holder[]> {
  const largest = await rpc.call<{ value: { address: string; uiAmountString: string }[] }>("getTokenLargestAccounts", [
    mint,
    { commitment: "confirmed" },
  ]);
  const accounts = largest.value;
  if (accounts.length === 0) return [];

  // Token account -> owner wallet.
  const infos = await rpc.call<{ value: (AccountInfo<Parsed<{ owner: string }>> | null)[] }>("getMultipleAccounts", [
    accounts.map((a) => a.address),
    { encoding: "jsonParsed", commitment: "confirmed" },
  ]);

  const byOwner = new Map<string, number>();
  accounts.forEach((a, i) => {
    const owner = infos.value[i]?.data?.parsed?.info?.owner ?? a.address;
    byOwner.set(owner, (byOwner.get(owner) ?? 0) + Number(a.uiAmountString));
  });

  const pools = new Set(poolAddresses);
  return [...byOwner.entries()]
    .map(([owner, amount]) => ({
      owner,
      amount,
      pct: supply > 0 ? (amount / supply) * 100 : 0,
      kind: classifyOwner(owner, pools),
    }))
    .sort((a, b) => b.amount - a.amount);
}

export function classifyOwner(owner: string, pools: Set<string>): Holder["kind"] {
  if (pools.has(owner) || KNOWN_POOL_OWNERS.has(owner)) return "pool";
  if (KNOWN_EXCHANGES.has(owner)) return "exchange";
  return isOnCurve(owner) ? "wallet" : "program";
}

/**
 * Walk the mint's signature history back to its first transaction. Returns that
 * transaction's fee payer (the creator) and the oldest page of signatures, which
 * holds the launch. Gives up after `maxPages` pages (1,000 each) so a busy old
 * token can't burn the RPC budget.
 */
export async function traceLaunch(
  rpc: RpcClient,
  mint: string,
  maxPages: number
): Promise<{ creator?: string; firstPage?: SignatureInfo[] }> {
  let before: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const sigs = await rpc.call<SignatureInfo[]>("getSignaturesForAddress", [
      mint,
      { limit: 1000, commitment: "confirmed", ...(before ? { before } : {}) },
    ]);
    if (sigs.length === 0) break;
    const oldest = sigs[sigs.length - 1]!.signature;
    if (sigs.length < 1000) {
      return { creator: await payerOf(rpc, oldest), firstPage: sigs };
    }
    before = oldest;
  }
  return {}; // history longer than our budget
}

export async function findCreator(rpc: RpcClient, mint: string, maxPages: number): Promise<string | undefined> {
  return (await traceLaunch(rpc, mint, maxPages)).creator;
}

/**
 * Who bought in the first `windowSlots` slots after launch (about 0.4s each).
 * Buying in the launch block or right after it takes a bundle or a bot, so a
 * big early share usually means the dev or snipers loaded up before anyone
 * else could. Reads at most `maxTx` transactions.
 */
export async function fetchLaunchBuyers(
  rpc: RpcClient,
  mint: string,
  firstPage: SignatureInfo[],
  supply: number,
  holders: Holder[] | undefined,
  opts: { windowSlots?: number; maxTx?: number } = {}
): Promise<NonNullable<Evidence["launch"]> | undefined> {
  const windowSlots = opts.windowSlots ?? 3;
  const launchSlot = firstPage[firstPage.length - 1]?.slot;
  if (launchSlot === undefined || supply <= 0) return undefined;

  const early = firstPage
    .filter((s) => s.slot !== undefined && s.slot <= launchSlot + windowSlots && !s.err)
    .reverse()
    .slice(0, opts.maxTx ?? 25);

  const txs = await mapLimit(early, 4, (s) =>
    rpc.call<{ meta: { preTokenBalances?: TokenBalance[]; postTokenBalances?: TokenBalance[] } | null } | null>(
      "getTransaction",
      [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: MAX_TX_VERSION, commitment: "confirmed" }]
    )
  );

  const bought = new Map<string, number>();
  for (const tx of txs) {
    if (!tx?.meta) continue;
    const delta = new Map<string, number>();
    const tally = (list: TokenBalance[] | undefined, sign: number) => {
      for (const b of list ?? []) {
        if (b.mint !== mint || !b.owner) continue;
        delta.set(b.owner, (delta.get(b.owner) ?? 0) + sign * Number(b.uiTokenAmount.uiAmountString ?? 0));
      }
    };
    tally(tx.meta.preTokenBalances, -1);
    tally(tx.meta.postTokenBalances, 1);
    for (const [owner, d] of delta) {
      // Bonding curves and pools are off-curve; only people (wallets) count as buyers.
      if (d > 0 && isOnCurve(owner)) bought.set(owner, (bought.get(owner) ?? 0) + d);
    }
  }

  const held = new Map(holders?.map((h) => [h.owner, h.pct]) ?? []);
  const buyers = [...bought.entries()]
    .map(([owner, amount]) => ({ owner, boughtPct: (amount / supply) * 100, holdsPct: held.get(owner) ?? 0 }))
    .sort((a, b) => b.boughtPct - a.boughtPct);
  return {
    slot: launchSlot,
    windowSlots,
    buyers,
    boughtPct: buyers.reduce((s, b) => s + b.boughtPct, 0),
    stillHeldPct: buyers.reduce((s, b) => s + b.holdsPct, 0),
  };
}

/**
 * When each of the largest wallets first appeared on-chain. A wallet with fewer
 * than 1,000 transactions is dated by its oldest one; a wallet with more is
 * treated as established.
 */
export async function fetchWalletAges(
  rpc: RpcClient,
  holders: Holder[],
  now: Date,
  maxWallets = 10
): Promise<NonNullable<Evidence["walletAges"]>> {
  const wallets = holders.filter((h) => h.kind === "wallet").slice(0, maxWallets);
  const firstSeen = await mapLimit(wallets, 4, async (h) => {
    const sigs = await rpc.call<SignatureInfo[]>("getSignaturesForAddress", [h.owner, { limit: 1000, commitment: "confirmed" }]);
    if (sigs.length === 0 || sigs.length >= 1000) return undefined;
    return sigs[sigs.length - 1]!.blockTime ?? undefined;
  });

  const ageDays = (t: number | undefined) => (t === undefined ? Infinity : (now.getTime() / 1000 - t) / 86_400);
  let fresh1dPct = 0;
  let fresh7dPct = 0;
  let freshCount7d = 0;
  wallets.forEach((h, i) => {
    const days = ageDays(firstSeen[i]);
    if (days <= 1) fresh1dPct += h.pct;
    if (days <= 7) {
      fresh7dPct += h.pct;
      freshCount7d++;
    }
  });
  return { checked: wallets.length, fresh1dPct, fresh7dPct, freshCount7d };
}

interface TokenBalance {
  mint: string;
  owner?: string;
  uiTokenAmount: { uiAmountString?: string };
}

/** Run `fn` over `items` with at most `limit` in flight, keeping order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function payerOf(rpc: RpcClient, signature: string): Promise<string | undefined> {
  const tx = await rpc.call<{
    transaction: { message: { accountKeys: ({ pubkey: string; signer: boolean } | string)[] } };
  } | null>("getTransaction", [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: MAX_TX_VERSION, commitment: "confirmed" }]);
  const first = tx?.transaction.message.accountKeys[0];
  return typeof first === "string" ? first : first?.pubkey;
}

export async function balanceOf(rpc: RpcClient, owner: string, mint: string): Promise<number> {
  const res = await rpc.call<{ value: { account: AccountInfo<Parsed<{ tokenAmount: { uiAmountString: string } }>> }[] }>(
    "getTokenAccountsByOwner",
    [owner, { mint }, { encoding: "jsonParsed", commitment: "confirmed" }]
  );
  return res.value.reduce((sum, a) => sum + Number(a.account.data.parsed.info.tokenAmount.uiAmountString), 0);
}
