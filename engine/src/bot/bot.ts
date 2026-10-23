/**
 * One pass of the X bot: read new mentions, find a contract address in each
 * (or in the post it replies to or quotes), and reply with the owl's case file.
 *
 * Cost safeguards:
 *  - no address, no reply (nothing is posted for chatter)
 *  - a daily reply cap and a per-person daily limit
 *  - a per-coin cache, so a coin being shilled everywhere is investigated once
 *  - never replies to the same post twice, never replies to itself
 *  - dry-run unless `live` is set
 */
import { extractAddress } from "../util/address.js";
import type { Report } from "../types.js";
import { renderReply } from "../render.js";
import { rollDay, type BotState } from "./state.js";
import { XApiError, type Tweet, type XClient } from "./x.js";

export interface BotConfig {
  live: boolean;
  dailyReplyCap: number;
  perUserDailyCap: number;
  cacheMinutes: number;
  /** On the very first run, start from the newest mention instead of answering the backlog. */
  skipBacklog: boolean;
}

export interface BotDeps {
  x: XClient;
  me: { id: string; username: string };
  investigate: (mint: string) => Promise<Report>;
  now?: () => Date;
  log?: (line: string) => void;
  /** Called after every change worth keeping, so a crash never double-posts. */
  save?: (state: BotState) => void;
}

export type Outcome =
  | { kind: "replied" | "would-reply"; mention: string; mint: string; reply: string; cached: boolean }
  | { kind: "skipped"; mention: string; reason: string };

export async function runOnce(state: BotState, cfg: BotConfig, deps: BotDeps): Promise<{ state: BotState; outcomes: Outcome[] }> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  state = rollDay(state, now().toISOString().slice(0, 10));

  const page = await deps.x.mentions(deps.me.id, state.sinceId);
  if (state.sinceId === undefined && cfg.skipBacklog) {
    state.sinceId = page.newestId ?? "0";
    log(`first run: skipping ${page.tweets.length} older mention(s), starting from here`);
    deps.save?.(state);
    return { state, outcomes: [] };
  }
  // The API returns newest first; answer in the order people asked.
  const mentions = [...page.tweets].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  const outcomes: Outcome[] = [];
  const skip = (m: Tweet, reason: string) => {
    outcomes.push({ kind: "skipped", mention: m.id, reason });
    log(`skip ${m.id}: ${reason}`);
  };

  for (const m of mentions) {
    if (m.author_id === deps.me.id) {
      skip(m, "own post");
      continue;
    }
    if (state.answered.includes(m.id)) {
      skip(m, "already answered");
      continue;
    }
    const mint = findMint(m, page.referenced) ?? (await findMintUpstream(m, page.referenced, deps.x).catch(() => undefined));
    if (!mint) {
      skip(m, "no contract address");
      continue;
    }
    if (state.repliesToday >= cfg.dailyReplyCap) {
      skip(m, `daily cap of ${cfg.dailyReplyCap} reached`);
      continue;
    }
    const author = m.author_id ?? "unknown";
    if ((state.perUser[author] ?? 0) >= cfg.perUserDailyCap) {
      skip(m, `user ${author} hit ${cfg.perUserDailyCap} today`);
      continue;
    }

    // Reuse a recent case file for the same coin; otherwise investigate.
    const hit = state.cache[mint];
    const fresh = hit && now().getTime() - hit.at < cfg.cacheMinutes * 60_000;
    let template: string;
    if (fresh) {
      template = hit.reply;
    } else {
      try {
        template = renderReply(await deps.investigate(mint), 280 - CASE_NO_ROOM);
      } catch (err) {
        skip(m, `investigation failed: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      state.cache[mint] = { at: now().getTime(), reply: template };
    }
    const reply = withCaseNo(template, state.caseNo + 1);

    if (!cfg.live) {
      outcomes.push({ kind: "would-reply", mention: m.id, mint, reply, cached: Boolean(fresh) });
      log(`[dry run] would reply to ${m.id} about ${mint}:\n${reply}\n`);
      continue;
    }

    try {
      await deps.x.reply(reply, m.id, othersInThread(m, deps.me.id));
    } catch (err) {
      if (err instanceof XApiError && err.isDuplicate) {
        // Same coin, same minute, same text: X won't post it again. Don't retry.
        state.answered.push(m.id);
        skip(m, "X rejected it as a duplicate");
        deps.save?.(state);
        continue;
      }
      throw err; // auth or billing problems should stop the bot, not be retried in a loop
    }
    state.answered.push(m.id);
    state.caseNo++;
    state.repliesToday++;
    state.perUser[author] = (state.perUser[author] ?? 0) + 1;
    outcomes.push({ kind: "replied", mention: m.id, mint, reply, cached: Boolean(fresh) });
    log(`replied to ${m.id} about ${mint}`);
    deps.save?.(state);
  }

  // Only advance past mentions once they've all been handled.
  if (page.newestId) state.sinceId = page.newestId;
  pruneCache(state, now().getTime(), cfg.cacheMinutes);
  deps.save?.(state);
  return { state, outcomes };
}

/**
 * Everyone X would tag in the reply apart from the person who asked. Replying
 * in a thread tags every account the post mentions; a new bot pinging
 * projects nobody asked it about looks like spam.
 */
export function othersInThread(m: Tweet, selfId: string): string[] {
  const ids = (m.entities?.mentions ?? []).map((x) => x.id).filter((id): id is string => Boolean(id));
  return [...new Set(ids)].filter((id) => id !== m.author_id && id !== selfId);
}

/** Room kept free for the case number ("Case #123456: " vs "Case file: "). */
const CASE_NO_ROOM = 6;

/** "🦉 Case file: $X" -> "🦉 Case #42: $X". X rejects identical posts, so every reply needs something unique. */
export function withCaseNo(reply: string, n: number): string {
  return reply.replace(/^🦉 Case file: /, `🦉 Case #${n}: `);
}

/** The address in the mention itself, else in the post it replies to or quotes. */
export function findMint(m: Tweet, referenced: Map<string, Tweet>): string | undefined {
  const own = extractAddress(m.text);
  if (own) return own;
  for (const ref of m.referenced_tweets ?? []) {
    if (ref.type === "retweeted") continue;
    const parent = referenced.get(ref.id);
    const found = parent && extractAddress(parent.text);
    if (found) return found;
  }
  return undefined;
}

/**
 * One step further up: when the post someone replied under has no address,
 * check the post *it* quotes or replies to (a project quoting its own launch
 * post, say). Costs one extra read, and only when the cheap lookup failed.
 */
export async function findMintUpstream(m: Tweet, referenced: Map<string, Tweet>, x: XClient): Promise<string | undefined> {
  for (const ref of m.referenced_tweets ?? []) {
    if (ref.type === "retweeted") continue;
    const parent = referenced.get(ref.id);
    for (const up of parent?.referenced_tweets ?? []) {
      if (up.type === "retweeted") continue;
      const grandparent = await x.tweet(up.id);
      const found = grandparent && extractAddress(grandparent.text);
      if (found) return found;
    }
  }
  return undefined;
}

function pruneCache(state: BotState, nowMs: number, minutes: number) {
  for (const [mint, entry] of Object.entries(state.cache)) {
    if (nowMs - entry.at >= minutes * 60_000) delete state.cache[mint];
  }
}
