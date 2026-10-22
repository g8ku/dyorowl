/**
 * End-to-end test of evidence gathering with a fake RPC and a fake DexScreener,
 * so the parsing of real response shapes is covered without network access.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { gatherEvidence, InvalidAddressError } from "../src/analyze.js";
import { scoreEvidence } from "../src/score.js";
import type { RpcClient } from "../src/sources/rpc.js";

const MINT = "Fc8BhCnq9GLDL238MKCEBfwcSsrCKjV3z7C5Jz4QUb3V";
const POOL = "Esb5p2wnCJemyYRKPs8Tc3yVgs6LSBQb51oSX9jTiHsN"; // off-curve, also the pair address
const DEV = "TnwAxosU8ktpUAKNtemzMevVCZzejsrwishXA31hUDK";
const W1 = "954tHrQZbCtqEchfMT7u27bLBh63hqrcGr6vuFvBrSQh";
const TA = ["9MdXQZcX7K6D4tTwLztyR5E1QhBf5559F6GjgPGXChoS", "6T35SwUqMAHsBoAammaPQfHcmwpxi8yDVGWrKE9eT24t", "7kcz2rRgbqCmsjB8DBHt7sQzcas1iPqhKBWgRB8Vh8gs", "5UBctrxczucWM1RKqLeB4QHiUG4C7Ldicq2aeUA2mwSk"];

function fakeRpc(overrides: Record<string, (params: unknown[]) => unknown> = {}): RpcClient & { calls: string[] } {
  const calls: string[] = [];
  const handlers: Record<string, (params: unknown[]) => unknown> = {
    getAccountInfo: () => ({
      value: {
        owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        data: { program: "spl-token", parsed: { type: "mint", info: { decimals: 6, supply: "1000000000000000", mintAuthority: null, freezeAuthority: null } } },
      },
    }),
    getTokenLargestAccounts: () => ({
      value: [
        { address: TA[0], uiAmountString: "200000000" }, // pool
        { address: TA[1], uiAmountString: "50000000" }, // W1
        { address: TA[2], uiAmountString: "30000000" }, // W1 again (second account)
        { address: TA[3], uiAmountString: "20000000" }, // dev
      ],
    }),
    getMultipleAccounts: () => ({
      value: [POOL, W1, W1, DEV].map((owner) => ({ owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", data: { parsed: { type: "account", info: { owner } } } })),
    }),
    getSignaturesForAddress: () => [{ signature: "sig2" }, { signature: "sig1" }],
    getTransaction: () => ({ transaction: { message: { accountKeys: [{ pubkey: DEV, signer: true }] } } }),
    getTokenAccountsByOwner: () => ({ value: [{ account: { data: { parsed: { info: { tokenAmount: { uiAmountString: "20000000" } } } } } }] }),
    ...overrides,
  };
  return {
    calls,
    async call<T>(method: string, params: unknown[]): Promise<T> {
      calls.push(method);
      const h = handlers[method];
      if (!h) throw new Error(`unexpected ${method}`);
      return h(params) as T;
    },
  };
}

const dexFetch = (async () =>
  new Response(
    JSON.stringify([
      {
        chainId: "solana",
        dexId: "pumpswap",
        pairAddress: POOL,
        url: "https://dexscreener.com/solana/example",
        baseToken: { address: MINT, name: "Example Coin", symbol: "EXMPL" },
        priceUsd: "0.000183",
        txns: { h1: { buys: 120, sells: 90 }, h24: { buys: 3000, sells: 2500 } },
        volume: { h24: 400000 },
        priceChange: { h1: 4.2, h24: 30 },
        liquidity: { usd: 52000 },
        marketCap: 183000,
        pairCreatedAt: Date.parse("2026-10-20T00:00:00Z"),
      },
    ]),
    { status: 200, headers: { "content-type": "application/json" } }
  )) as typeof fetch;

const now = () => new Date("2026-10-21T06:00:00Z");

test("gathers mint, market, holders and creator from real-shaped responses", async () => {
  const ev = await gatherEvidence(MINT, { rpc: fakeRpc(), fetchImpl: dexFetch, now });
  assert.equal(ev.token?.symbol, "EXMPL");
  assert.equal(ev.token?.supply, 1_000_000_000);
  assert.equal(ev.token?.mintAuthority, null);
  assert.equal(ev.market?.liquidityUsd, 52000);

  // W1's two token accounts are merged into one holder; the pool is flagged.
  const w1 = ev.holders?.find((h) => h.owner === W1);
  assert.equal(w1?.pct, 8);
  assert.equal(ev.holders?.find((h) => h.owner === POOL)?.kind, "pool");
  assert.equal(ev.holders?.find((h) => h.owner === DEV)?.kind, "wallet");

  assert.equal(ev.creator?.address, DEV);
  assert.equal(ev.creator?.holdsPct, 2);
  assert.deepEqual(ev.gaps, []);

  const r = scoreEvidence(ev);
  assert.equal(r.coverage, 1);
  assert.equal(r.verdict.band, "clean");
});

test("a DexScreener outage becomes a gap, not a crash", async () => {
  const down = (async () => new Response("", { status: 503 })) as typeof fetch;
  const ev = await gatherEvidence(MINT, { rpc: fakeRpc(), fetchImpl: down, now });
  assert.equal(ev.market, undefined);
  assert.match(ev.gaps.join(" "), /Market data was unavailable/);
  assert.ok(scoreEvidence(ev).coverage < 1);
});

test("rejects things that aren't addresses before touching the network", async () => {
  const rpc = fakeRpc();
  await assert.rejects(gatherEvidence("0xdeadbeef", { rpc, fetchImpl: dexFetch }), InvalidAddressError);
  assert.equal(rpc.calls.length, 0);
});

test("a wallet address instead of a mint gives a clear error", async () => {
  const rpc = fakeRpc({ getAccountInfo: () => ({ value: { owner: "11111111111111111111111111111111", data: ["", "base64"] } }) });
  await assert.rejects(gatherEvidence(MINT, { rpc, fetchImpl: dexFetch }), /not a token mint/);
});

test("creator lookup stops at the page budget", async () => {
  const full = Array.from({ length: 1000 }, (_, i) => ({ signature: `s${i}` }));
  const rpc = fakeRpc({ getSignaturesForAddress: () => full });
  const ev = await gatherEvidence(MINT, { rpc, fetchImpl: dexFetch, creatorLookupMaxPages: 2, now });
  assert.equal(ev.creator, undefined);
  assert.equal(rpc.calls.filter((c) => c === "getSignaturesForAddress").length, 2);
  assert.match(ev.gaps.join(" "), /creator wallet/);
});
