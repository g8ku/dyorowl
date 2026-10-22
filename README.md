# DYOR Owl

An AI detective owl that investigates memecoins, plus comics that teach you to do it yourself.

```
dyorowl/
├── engine/   Research engine: Solana contract address → case file + Hoot score (TypeScript)
└── web/      dyorowl.com coming-soon site (Next.js)
```

---

## engine/

Takes a Solana token's contract address, pulls on-chain and market data, scores it with fixed rules, and writes:

- **an X reply** that fits in one post (no links, since links make posts much more expensive on the X API)
- **a long-form case file** for the website and logs
- **JSON** for anything else

It doesn't call any AI model, so a case costs nothing in AI tokens. The only costs are your RPC provider and, later, the X API.

### Setup

Requires Node 20 or newer.

```bash
cd engine
npm install
cp .env.example .env     # then paste your RPC URL into .env
npm run demo             # three made-up sample cases, no network needed
npm test                 # 25 tests
```

Investigate a real coin:

```bash
npm run case -- <contract address>           # full case file + X reply
npm run case -- <contract address> --reply   # just the X reply
npm run case -- <contract address> --json    # everything as JSON
```

**RPC:** the public Solana endpoint works for a few lookups but rate-limits hard. Get a free key from Helius (or QuickNode / Triton) and put the full URL in `SOLANA_RPC_URL`.

### Where the data comes from

| Data | Source |
|---|---|
| Supply, decimals, mint & freeze authority | Solana RPC `getAccountInfo` |
| Largest holders | Solana RPC `getTokenLargestAccounts` (top 20 token accounts), grouped by owner |
| Pool vs wallet | Owner matches a DexScreener pair address, or the owner is off-curve (a program-derived address such as a bonding curve, pool or locker) |
| Creator wallet | Fee payer of the mint's oldest transaction, then its current balance |
| Liquidity, age, trades, price | DexScreener `token-pairs/v1/solana/{address}` (no key) |

### The Hoot score

The rules live in `src/score.ts`. Weights add up to 100:

| Check | Pts | Full points | Zero points |
|---|---|---|---|
| Mint authority revoked | 15 | revoked | active |
| Freeze authority revoked | 10 | revoked | active |
| Top 10 wallets (pools excluded) | 25 | ≤ 20% | ≥ 50% |
| Largest wallet | 10 | ≤ 5% | ≥ 15% |
| Liquidity (log scale) | 15 | ≥ $50K | ≤ $10K |
| Dev wallet holdings | 10 | ≤ 3% | ≥ 10% |
| Age | 5 | ≥ 24h | ≤ 1h |
| Last-hour sells per buy (needs 10+ trades) | 10 | ≤ 1 | ≥ 2 |

- Missing data is skipped and the score is rescaled; the reply says what share was checked.
- Hard caps: an active mint or freeze authority caps the score at 40, and one wallet over 30% caps it at 35.
- Under 80% coverage the score is capped at 74, so a coin can't be called a "Clean file" while too much is unknown.
- Verdicts: 75+ Clean file · 50–74 Proceed with care · 25–49 Suspicious · under 25 Red flags everywhere.

**Not checked yet** (don't claim these until they're built): bundled launches, the dev's sell history, chart patterns, socials.

### Using it from code

```ts
import { investigate, renderReply, renderCaseFile, extractAddress } from "dyor-owl-core";

const mint = extractAddress(tweetText);          // pull the CA out of a mention
const report = await investigate(mint!, { rpcUrl: process.env.SOLANA_RPC_URL });
renderReply(report);                             // post this on X
```

---

## web/

The dyorowl.com coming-soon page: hero with the owl, "Coming soon...", a follow-on-X button, and two teasers (case files, Owl Academy). No ticker or contract address anywhere.

```bash
cd web
npm install
npm run dev        # http://localhost:3000
npm run build      # production build
```

### Deploying to Vercel and connecting dyorowl.com

1. Push this repo to GitHub.
2. In Vercel, choose **Add New → Project**, import the repo, and set **Root Directory** to `web`. Framework preset: Next.js. Deploy.
3. In the project, open **Settings → Domains** and add `dyorowl.com` and `www.dyorowl.com`. Vercel shows the exact DNS records to use.
4. At Domain.com, open the DNS settings for dyorowl.com and add those records. Keep your existing email (MX) records as they are.
5. Give DNS some time to update. Vercel issues the HTTPS certificate on its own.

Edit the copy in `web/app/page.tsx` and the colors in `web/app/globals.css`.

---

## Next steps

1. **Run the engine on real coins** you know well and check the scores feel right before anything goes public. Tune thresholds in `src/score.ts`.
2. **X bot:** poll mentions, pull the contract address, run `investigate`, post `renderReply`. Build in the cost safeguards: an X spending limit with auto-recharge off, a daily reply cap, per-user limits, and a per-contract cache.
3. **Site v2:** a "paste a contract address" tool page backed by a Next.js API route that calls the engine, plus the Owl Academy comics.

Not financial advice. The owl checks a few things; it can't see everything.
