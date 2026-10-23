/**
 * Minimal X API v2 client for the bot: who am I, read mentions, post a reply.
 * Signs requests with OAuth 1.0a user context (the bot account's own tokens),
 * using node:crypto so there are no extra dependencies.
 */
import { createHmac, randomBytes } from "node:crypto";

const BASE = "https://api.x.com/2";

export interface XCredentials {
  apiKey: string; // a.k.a. consumer key
  apiSecret: string;
  accessToken: string; // the bot account's token
  accessSecret: string;
}

export interface Tweet {
  id: string;
  text: string;
  author_id?: string;
  referenced_tweets?: { type: "replied_to" | "quoted" | "retweeted"; id: string }[];
}

export interface MentionsPage {
  tweets: Tweet[];
  /** Tweets referenced by the mentions (the post someone replied under or quoted). */
  referenced: Map<string, Tweet>;
  newestId?: string;
}

export interface XClient {
  me(): Promise<{ id: string; username: string }>;
  mentions(userId: string, sinceId?: string): Promise<MentionsPage>;
  reply(text: string, inReplyTo: string): Promise<{ id: string }>;
}

export class XApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
    /** From x-rate-limit-reset: when the rate limit window reopens (epoch ms). */
    public readonly resetAt?: number
  ) {
    super(message);
    this.name = "XApiError";
  }
  /** X refuses to post the exact same text twice. */
  get isDuplicate(): boolean {
    return this.status === 403 && /duplicate/i.test(this.body);
  }
}

export function createXClient(creds: XCredentials, fetchImpl: typeof fetch = fetch): XClient {
  async function request<T>(method: "GET" | "POST", path: string, query: Record<string, string> = {}, body?: unknown): Promise<T> {
    const url = `${BASE}${path}`;
    const qs = new URLSearchParams(query).toString();
    const res = await fetchImpl(qs ? `${url}?${qs}` : url, {
      method,
      headers: {
        authorization: oauthHeader(method, url, query, creds),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok) {
      const reset = Number(res.headers.get("x-rate-limit-reset"));
      throw new XApiError(`X API ${method} ${path} failed: HTTP ${res.status}`, res.status, text, reset > 0 ? reset * 1000 : undefined);
    }
    return JSON.parse(text) as T;
  }

  return {
    async me() {
      const r = await request<{ data: { id: string; username: string } }>("GET", "/users/me");
      return r.data;
    },

    async mentions(userId, sinceId) {
      const r = await request<{
        data?: Tweet[];
        includes?: { tweets?: Tweet[] };
        meta?: { newest_id?: string };
      }>("GET", `/users/${userId}/mentions`, {
        max_results: "100",
        "tweet.fields": "author_id,referenced_tweets",
        expansions: "referenced_tweets.id",
        ...(sinceId ? { since_id: sinceId } : {}),
      });
      return {
        tweets: r.data ?? [],
        referenced: new Map((r.includes?.tweets ?? []).map((t) => [t.id, t])),
        newestId: r.meta?.newest_id,
      };
    },

    async reply(text, inReplyTo) {
      const r = await request<{ data: { id: string } }>("POST", "/tweets", {}, { text, reply: { in_reply_to_tweet_id: inReplyTo } });
      return r.data;
    },
  };
}

/** RFC 3986 percent-encoding, as OAuth 1.0a requires. */
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * Build the OAuth 1.0a Authorization header. Query parameters are signed;
 * JSON bodies are not (only form-encoded bodies would be).
 */
export function oauthHeader(
  method: string,
  url: string,
  params: Record<string, string>,
  creds: XCredentials,
  nonce = randomBytes(16).toString("hex"),
  timestamp = Math.floor(Date.now() / 1000).toString()
): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };
  const all = { ...params, ...oauth };
  const paramString = Object.keys(all)
    .map((k) => [enc(k), enc(all[k]!)] as const)
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const base = [method.toUpperCase(), enc(url), enc(paramString)].join("&");
  const key = `${enc(creds.apiSecret)}&${enc(creds.accessSecret)}`;
  oauth.oauth_signature = createHmac("sha1", key).update(base).digest("base64");
  return (
    "OAuth " +
    Object.keys(oauth)
      .sort()
      .map((k) => `${enc(k)}="${enc(oauth[k]!)}"`)
      .join(", ")
  );
}
