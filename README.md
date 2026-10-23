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
npm test                 # 52 tests
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
| Supply, decimals, mint & freeze authority, Token-2022 extensions | Solana RPC `getAccountInfo` |
| Largest holders | Solana RPC `getTokenLargestAccounts` (top 20 token accounts), grouped by owner |
| Pool vs wallet vs exchange | Owner matches a DexScreener pair address, or the owner is off-curve (a program-derived address such as a bonding curve, pool or locker), or it's on the known exchange hot-wallet list in `src/sources/solana.ts` |
| Creator wallet | Fee payer of the mint's oldest transaction, then its current balance |
| Launch snipers | The mint's transactions in its first 4 slots (~2s), read with `getTransaction`; any wallet whose balance went up is an early buyer |
| Fresh wallets | Oldest transaction of each of the top 10 wallets (`getSignaturesForAddress`); a wallet with 1,000+ transactions counts as established |
| Liquidity, age, trades, price | DexScreener `token-pairs/v1/solana/{address}` (no key). The main pair is the most-traded one over 24h |

Walking back to a coin's launch costs one RPC call per 1,000 transactions. The budget is `CREATOR_LOOKUP_MAX_PAGES` (default 5), raised to 30 for coins under a week old. A very busy new coin can still run past it, and then the dev wallet and launch snipers show as not checked.

### The Hoot score

The rules live in `src/score.ts`. Weights add up to 100:

| Check | Pts | Full points | Zero points |
|---|---|---|---|
| Mint authority revoked | 15 | revoked | active |
| Freeze authority revoked | 10 | revoked | active |
| Top 10 wallets (pools and exchanges excluded) | 20 | ≤ 20% | ≥ 50% |
| Largest wallet | 5 | ≤ 5% | ≥ 15% |
| Liquidity (log scale) | 10 | ≥ $50K | ≤ $10K |
| Dev wallet holdings | 10 | ≤ 3% | ≥ 10% |
| Launch snipers: share they still hold | 10 | ≤ 3% | ≥ 15% |
| Fresh wallets: share held by top-10 wallets under 7 days old | 10 | ≤ 3% | ≥ 15% |
| Age | 5 | ≥ 24h | ≤ 1h |
| Last-hour sells per buy (needs 10+ trades) | 5 | ≤ 1 | ≥ 2 |

- Missing data is skipped and the score is rescaled; the reply says what share was checked.
- Some checks don't apply and aren't counted against coverage: liquidity on a bonding curve, last-hour selling for coins over 3 days old, and launch snipers for coins over 7 days old (by then any big sniper bag shows up in the top holders).
- Nothing scores 100: the top score is 99, because no coin is a sure thing.
- Hard caps: an active mint or freeze authority caps the score at 40, and one wallet over 30% caps it at 35.
- Token-2022 traps also cap it: a permanent delegate (someone can take your tokens) at 15, non-transferable at 10, a transfer hook, pausable transfers or frozen-by-default accounts at 40, and a transfer tax at 60 (any), 40 (5%+) or 25 (10%+).
- The case file lists every cap that lowered the score.
- Under 80% coverage the score is capped at 74, so a coin can't be called a "Clean file" while too much is unknown.
- Verdicts: 75+ Clean file · 50–74 Proceed with care · 25–49 Suspicious · under 25 Red flags everywhere.

**Not checked yet** (don't claim these until they're built): whether launch snipers were funded by the same wallet, the dev's sell history and past launches, copycat tokens with the same name, chart patterns, socials.

### The X bot

`npm run bot` watches @dyorowl's mentions and replies with a case file. Someone can tag the owl with a contract address, or reply "@dyorowl" under a post that has one (or quote it).

1. Fill in the `X_…` keys in `.env` (see `.env.example`).
2. `npm run bot` runs in **dry run**: it reads mentions and prints the replies it would post, but posts nothing.
3. When the replies look right, set `BOT_LIVE=true` and run it again.

`npm run bot -- --once` does a single pass and exits, for running from a scheduler.

Cost safeguards, all set in `.env`:

- No contract address, no reply. Chatter is never answered.
- A daily reply cap (default 50) and a per-person daily cap (default 3).
- A coin's case file is reused for 15 minutes, so a coin being shilled everywhere is only investigated once.
- It only tags the person who asked, not every account in the thread.
- It never replies to itself or to the same post twice, and on its very first run it skips old mentions instead of answering the backlog.
- It stops, rather than retrying, if X says the keys are wrong, the app can't post, or the account is out of credits.
- Every reply is numbered ("🦉 Case #42: $TICKER"), because X rejects identical posts.

Also set a spending limit in the X developer portal with auto-recharge off. That is the safeguard that holds even if the bot misbehaves.

The bot keeps its memory in `.bot-state.json`. It has to run somewhere that stays on (a small server, Railway, Fly.io, or your own computer to start with); Vercel's free plan isn't suitable because it doesn't run long-lived processes.

**On Railway:** create a service from this repo with **Root Directory** set to `engine`; `npm start` runs the bot. Put the settings from `.env.example` in the service's **Variables** (never in the repo). To keep the bot's memory across redeploys, attach a volume mounted at `/data` and set `BOT_STATE_FILE=/data/.bot-state.json`. Without one, a redeploy just makes the bot start fresh from the newest mention.

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
2. **X bot:** built (`npm run bot`, see above). Next: get X API keys, run it in dry run, then host it somewhere that stays on.
3. **Site v2:** a "paste a contract address" tool page backed by a Next.js API route that calls the engine, plus the Owl Academy comics.

Not financial advice. The owl checks a few things; it can't see everything.
