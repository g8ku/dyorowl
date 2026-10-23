import { test } from "node:test";
import assert from "node:assert/strict";
import { findMint, runOnce, withCaseNo, type BotConfig } from "../src/bot/bot.js";
import { emptyState } from "../src/bot/state.js";
import { oauthHeader, XApiError, type MentionsPage, type Tweet, type XClient } from "../src/bot/x.js";
import { scoreEvidence } from "../src/score.js";
import { healthyCoin, DEMO_MINT, DEMO_NOW } from "../src/fixtures.js";
import { tweetLength } from "../src/render.js";

const ME = { id: "1", username: "dyorowl" };
const CA = DEMO_MINT;
const now = () => new Date(DEMO_NOW);
const cfg: BotConfig = { live: true, dailyReplyCap: 50, perUserDailyCap: 3, cacheMinutes: 15, skipBacklog: false, tagThread: false };
const report = scoreEvidence(healthyCoin, new Date(DEMO_NOW));

function fakeX(tweets: Tweet[], referenced: Tweet[] = [], opts: { failWith?: XApiError; lookup?: Tweet[] } = {}) {
  const posted: { text: string; inReplyTo: string; exclude?: string[] }[] = [];
  const x: XClient = {
    me: async () => ME,
    mentions: async (): Promise<MentionsPage> => ({
      tweets,
      referenced: new Map(referenced.map((t) => [t.id, t])),
      newestId: tweets.map((t) => t.id).sort().at(-1),
    }),
    tweet: async (id) => opts.lookup?.find((t) => t.id === id),
    reply: async (text, inReplyTo, exclude) => {
      if (opts.failWith) throw opts.failWith;
      posted.push({ text, inReplyTo, exclude });
      return { id: `r${posted.length}` };
    },
  };
  return { x, posted };
}

const mention = (id: string, text: string, author = "u1", refs?: Tweet["referenced_tweets"]): Tweet => ({ id, text, author_id: author, referenced_tweets: refs });

test("replies to a mention with a contract address, numbered and within 280", async () => {
  const { x, posted } = fakeX([mention("10", `@dyorowl check ${CA}`)]);
  let investigated = 0;
  const { state } = await runOnce(emptyState("2026-10-21"), cfg, { x, me: ME, now, investigate: async () => (investigated++, report) });
  assert.equal(posted.length, 1);
  assert.equal(posted[0]!.inReplyTo, "10");
  assert.match(posted[0]!.text, /^🦉 Case #1: \$EXMPL/);
  assert.ok(tweetLength(posted[0]!.text) <= 280);
  assert.equal(investigated, 1);
  assert.equal(state.repliesToday, 1);
  assert.equal(state.sinceId, "10");
});

test("finds the address in the post someone replied under", async () => {
  const shill = { id: "5", text: `aping this ${CA} 🚀` };
  const { x, posted } = fakeX([mention("10", "@dyorowl is this safe?", "u1", [{ type: "replied_to", id: "5" }])], [shill]);
  await runOnce(emptyState("2026-10-21"), cfg, { x, me: ME, now, investigate: async () => report });
  assert.equal(posted.length, 1);
});

test("no address, no reply", async () => {
  const { x, posted } = fakeX([mention("10", "@dyorowl gm owl")]);
  const { outcomes } = await runOnce(emptyState("2026-10-21"), cfg, { x, me: ME, now, investigate: async () => report });
  assert.equal(posted.length, 0);
  assert.deepEqual(outcomes, [{ kind: "skipped", mention: "10", reason: "no contract address" }]);
});

test("dry run posts nothing", async () => {
  const { x, posted } = fakeX([mention("10", CA)]);
  const { outcomes } = await runOnce(emptyState("2026-10-21"), { ...cfg, live: false }, { x, me: ME, now, investigate: async () => report });
  assert.equal(posted.length, 0);
  assert.equal(outcomes[0]!.kind, "would-reply");
});

test("caps: daily total and per person", async () => {
  const tweets = ["10", "11", "12", "13"].map((id) => mention(id, CA, "same-user"));
  const { x, posted } = fakeX(tweets);
  await runOnce(emptyState("2026-10-21"), { ...cfg, perUserDailyCap: 2 }, { x, me: ME, now, investigate: async () => report });
  assert.equal(posted.length, 2);

  const other = fakeX(["20", "21", "22"].map((id, i) => mention(id, CA, `u${i}`)));
  await runOnce(emptyState("2026-10-21"), { ...cfg, dailyReplyCap: 1 }, { x: other.x, me: ME, now, investigate: async () => report });
  assert.equal(other.posted.length, 1);
});

test("the same coin is investigated once, and every reply is still unique", async () => {
  const { x, posted } = fakeX(["10", "11", "12"].map((id, i) => mention(id, CA, `u${i}`)));
  let investigated = 0;
  await runOnce(emptyState("2026-10-21"), cfg, { x, me: ME, now, investigate: async () => (investigated++, report) });
  assert.equal(investigated, 1);
  assert.equal(new Set(posted.map((p) => p.text)).size, 3);
});

test("never answers itself or the same post twice", async () => {
  const state = emptyState("2026-10-21");
  state.answered.push("10");
  const { x, posted } = fakeX([mention("10", CA), mention("11", CA, ME.id)]);
  await runOnce(state, cfg, { x, me: ME, now, investigate: async () => report });
  assert.equal(posted.length, 0);
});

test("first run skips the backlog", async () => {
  const { x, posted } = fakeX([mention("10", CA), mention("11", CA)]);
  const { state } = await runOnce(emptyState("2026-10-21"), { ...cfg, skipBacklog: true }, { x, me: ME, now, investigate: async () => report });
  assert.equal(posted.length, 0);
  assert.equal(state.sinceId, "11");
});

test("counters reset on a new day", async () => {
  const state = { ...emptyState("2026-10-20"), repliesToday: 50, perUser: { u1: 3 } };
  const { x, posted } = fakeX([mention("10", CA)]);
  await runOnce(state, cfg, { x, me: ME, now, investigate: async () => report });
  assert.equal(posted.length, 1);
});

test("billing or auth errors stop the pass instead of being swallowed", async () => {
  const { x } = fakeX([mention("10", CA)], [], { failWith: new XApiError("nope", 402, "{}") });
  await assert.rejects(runOnce(emptyState("2026-10-21"), cfg, { x, me: ME, now, investigate: async () => report }), XApiError);
});

test("findMint ignores retweets and handles pump.fun links", () => {
  const refs = new Map([["5", { id: "5", text: CA }]]);
  assert.equal(findMint(mention("1", "@dyorowl", "u", [{ type: "retweeted", id: "5" }]), refs), undefined);
  assert.equal(findMint(mention("2", `https://pump.fun/coin/${CA}`), new Map()), CA);
});

test("withCaseNo only touches the header", () => {
  assert.equal(withCaseNo("🦉 Case file: $X\nCase file: other", 7), "🦉 Case #7: $X\nCase file: other");
});

test("OAuth 1.0a signature matches X's documented example", () => {
  // From X's "Creating a signature" guide.
  const header = oauthHeader(
    "POST",
    "https://api.twitter.com/1.1/statuses/update.json",
    { include_entities: "true", status: "Hello Ladies + Gentlemen, a signed OAuth request!" },
    {
      apiKey: "xvz1evFS4wEEPTGEFPHBog",
      apiSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
      accessToken: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
      accessSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
    },
    "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
    "1318622958"
  );
  assert.match(header, /oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"/);
});

test("a rate-limit error carries X's reset time", async () => {
  const { createXClient } = await import("../src/bot/x.js");
  const limited = (async () =>
    new Response("{}", { status: 429, headers: { "x-rate-limit-reset": "1800000000" } })) as typeof fetch;
  const x = createXClient({ apiKey: "k", apiSecret: "s", accessToken: "t", accessSecret: "a" }, limited);
  await assert.rejects(x.me(), (err: unknown) => err instanceof XApiError && err.status === 429 && err.resetAt === 1_800_000_000_000);
});

test("follows a quote one step up when the parent post has no address", async () => {
  const parent: Tweet = { id: "5", text: "still waiting on the team to fix the tag", referenced_tweets: [{ type: "quoted", id: "4" }] };
  const launch: Tweet = { id: "4", text: `we're live: ${CA}` };
  const { x, posted } = fakeX([mention("10", "@dyorowl is this safe", "u1", [{ type: "replied_to", id: "5" }])], [parent], { lookup: [launch] });
  await runOnce(emptyState("2026-10-21"), cfg, { x, me: ME, now, investigate: async () => report });
  assert.equal(posted.length, 1);
});

test("tags only the asker, or everyone in the thread when tagThread is on", async () => {
  const m: Tweet = {
    ...mention("10", `@YokaiCapital @AxiomExchange @dyorowl is this safe ${CA}`, "asker"),
    entities: { mentions: [{ id: "yokai", username: "YokaiCapital" }, { id: "axiom", username: "AxiomExchange" }, { id: ME.id, username: "dyorowl" }] },
  };
  const { x, posted } = fakeX([m]);
  await runOnce(emptyState("2026-10-21"), cfg, { x, me: ME, now, investigate: async () => report });
  assert.deepEqual(posted[0]!.exclude, ["yokai", "axiom"]);

  const all = fakeX([m]);
  await runOnce(emptyState("2026-10-21"), { ...cfg, tagThread: true }, { x: all.x, me: ME, now, investigate: async () => report });
  assert.deepEqual(all.posted[0]!.exclude, []);
});
