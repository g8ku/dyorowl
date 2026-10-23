#!/usr/bin/env node
/**
 * Runs the X bot.
 *
 *   npm run bot            poll for mentions every BOT_POLL_SECONDS
 *   npm run bot -- --once  one pass, then exit (for a cron job)
 *
 * Posts nothing unless BOT_LIVE=true. See .env.example for every setting.
 */
import { investigate } from "../index.js";
import { runOnce, type BotConfig } from "./bot.js";
import { loadState, saveState } from "./state.js";
import { createXClient, XApiError } from "./x.js";

try {
  process.loadEnvFile?.();
} catch {
  // no .env file; use the environment
}

const env = (k: string) => process.env[k]?.trim() || undefined;
const num = (k: string, d: number) => {
  const v = Number(env(k));
  return Number.isFinite(v) && v > 0 ? v : d;
};

const missing = ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"].filter((k) => !env(k));
if (missing.length) {
  console.error(`🦉 Missing X credentials in .env: ${missing.join(", ")}`);
  process.exit(1);
}

const cfg: BotConfig = {
  live: env("BOT_LIVE") === "true",
  dailyReplyCap: num("BOT_DAILY_REPLY_CAP", 50),
  perUserDailyCap: num("BOT_PER_USER_DAILY_CAP", 3),
  cacheMinutes: num("BOT_CACHE_MINUTES", 15),
  skipBacklog: env("BOT_ANSWER_BACKLOG") !== "true",
};
const pollMs = num("BOT_POLL_SECONDS", 120) * 1000;
const statePath = env("BOT_STATE_FILE") ?? ".bot-state.json";
const once = process.argv.includes("--once");

const x = createXClient({
  apiKey: env("X_API_KEY")!,
  apiSecret: env("X_API_SECRET")!,
  accessToken: env("X_ACCESS_TOKEN")!,
  accessSecret: env("X_ACCESS_SECRET")!,
});

const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const log = (line: string) => console.log(`${stamp()}  ${line}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const me = await x.me();
  log(
    `🦉 @${me.username} ${cfg.live ? "is LIVE and will post replies" : "in DRY RUN (set BOT_LIVE=true to post)"}. ` +
      `Caps: ${cfg.dailyReplyCap}/day, ${cfg.perUserDailyCap}/person/day. Cache: ${cfg.cacheMinutes}m.`
  );

  for (;;) {
    const today = new Date().toISOString().slice(0, 10);
    const state = loadState(statePath, today);
    try {
      const result = await runOnce(state, cfg, { x, me, investigate, log, save: (s) => saveState(statePath, s) });
      const replied = result.outcomes.filter((o) => o.kind !== "skipped").length;
      log(
        `pass done: ${result.outcomes.length} new mention(s), ${replied} ${cfg.live ? "replied" : "would reply"}. ` +
          `Today: ${result.state.repliesToday}/${cfg.dailyReplyCap}`
      );
    } catch (err) {
      if (err instanceof XApiError && err.status === 429) {
        log("X rate limit hit; waiting 15 minutes.");
        if (once) return;
        await sleep(15 * 60_000);
        continue;
      }
      if (err instanceof XApiError && [401, 402, 403].includes(err.status)) {
        // Bad keys, missing write permission, or out of credits: stop instead of retrying.
        console.error(`🦉 Stopping: ${err.message}\n${err.body}`);
        process.exit(1);
      }
      log(`pass failed, will retry: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (once) return;
    await sleep(pollMs);
  }
}

main().catch((err: unknown) => {
  console.error(`🦉 The bot crashed: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof XApiError) console.error(err.body);
  process.exit(1);
});
