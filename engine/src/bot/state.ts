/**
 * What the bot remembers between runs, kept in a small JSON file:
 * where it left off in the mentions, today's reply counts, recently answered
 * posts, and recent case files per coin.
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";

export interface BotState {
  sinceId?: string; // newest mention already seen
  caseNo: number; // last case number posted; every reply gets the next one, so no two posts are identical
  day: string; // UTC date the counters below belong to, e.g. "2026-10-23"
  repliesToday: number;
  perUser: Record<string, number>; // author id -> replies today
  answered: string[]; // mention ids already replied to (most recent last)
  cache: Record<string, { at: number; reply: string }>; // mint -> last reply text
}

const MAX_ANSWERED = 1000;

export const emptyState = (day: string): BotState => ({ caseNo: 0, day, repliesToday: 0, perUser: {}, answered: [], cache: {} });

export function loadState(path: string, day: string): BotState {
  try {
    return rollDay({ ...emptyState(day), ...(JSON.parse(readFileSync(path, "utf8")) as Partial<BotState>) }, day);
  } catch {
    return emptyState(day);
  }
}

/** Write to a temp file first so a crash mid-write can't corrupt the state. */
export function saveState(path: string, state: BotState): void {
  state.answered = state.answered.slice(-MAX_ANSWERED);
  writeFileSync(`${path}.tmp`, JSON.stringify(state, null, 2));
  renameSync(`${path}.tmp`, path);
}

/** Reset the daily counters when the UTC date changes. */
export function rollDay(state: BotState, day: string): BotState {
  if (state.day !== day) return { ...state, day, repliesToday: 0, perUser: {} };
  return state;
}
