/**
 * Minimal Solana JSON-RPC client using global fetch (Node 20+).
 * Retries on HTTP 429 / 5xx with exponential backoff, since free RPC tiers
 * rate-limit aggressively.
 */

export class RpcError extends Error {
  constructor(message: string, public readonly code?: number) {
    super(message);
    this.name = "RpcError";
  }
}

export interface RpcClient {
  call<T>(method: string, params: unknown[]): Promise<T>;
}

export function createRpcClient(
  url: string,
  opts: { maxRetries?: number; timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): RpcClient {
  const maxRetries = opts.maxRetries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const doFetch = opts.fetchImpl ?? fetch;
  let id = 0;

  return {
    async call<T>(method: string, params: unknown[]): Promise<T> {
      for (let attempt = 0; ; attempt++) {
        const res = await doFetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
          signal: AbortSignal.timeout(timeoutMs),
        });

        if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        if (!res.ok) throw new RpcError(`${method} failed: HTTP ${res.status}`, res.status);

        const body = (await res.json()) as { result?: T; error?: { message: string; code: number } };
        if (body.error) throw new RpcError(`${method} failed: ${body.error.message}`, body.error.code);
        return body.result as T;
      }
    },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
