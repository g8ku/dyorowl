/**
 * On-chain lookups via Solana JSON-RPC:
 *  - mint info (supply, decimals, mint/freeze authority, token program)
 *  - largest holders, grouped by owner and classified wallet / pool / program
 *  - the token's creator (first signer of its oldest transaction) and what it still holds
 */
import type { Evidence, Holder } from "../types.js";
import type { RpcClient } from "./rpc.js";
import { isOnCurve } from "../util/address.js";

const SPL_TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS14TjCh7HqYomg3JRz4mZK";

/** Pool authorities that are not PDAs-with-data and would otherwise look odd. Extend as needed. */
const KNOWN_POOL_OWNERS = new Set<string>([
  "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1", // Raydium AMM v4 authority
]);

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
  };
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
  return isOnCurve(owner) ? "wallet" : "program";
}

/**
 * Walk the mint's signature history back to its first transaction and return
 * that transaction's fee payer. Gives up after `maxPages` pages (1,000 each)
 * so a busy old token can't burn the RPC budget.
 */
export async function findCreator(rpc: RpcClient, mint: string, maxPages: number): Promise<string | undefined> {
  let before: string | undefined;
  let oldest: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const sigs = await rpc.call<{ signature: string }[]>("getSignaturesForAddress", [
      mint,
      { limit: 1000, commitment: "confirmed", ...(before ? { before } : {}) },
    ]);
    if (sigs.length === 0) break;
    oldest = sigs[sigs.length - 1]!.signature;
    if (sigs.length < 1000) {
      return payerOf(rpc, oldest);
    }
    before = oldest;
  }
  return undefined; // history longer than our budget
}

async function payerOf(rpc: RpcClient, signature: string): Promise<string | undefined> {
  const tx = await rpc.call<{
    transaction: { message: { accountKeys: ({ pubkey: string; signer: boolean } | string)[] } };
  } | null>("getTransaction", [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]);
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
