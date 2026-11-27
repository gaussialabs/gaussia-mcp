import type { Deps } from "./deps.js";
import { USER_AGENT } from "./deps.js";

/** A public data source failed. The message always names the source; no tool falls back to made-up data. */
export class SourceError extends Error {
  readonly code = "source_unavailable";
  constructor(
    readonly source: string,
    message: string,
  ) {
    super(`${source}: ${message}`);
    this.name = "SourceError";
  }
}

/** Bad input from the caller (unparseable TIC ID, TOI number, ...). */
export class InputError extends Error {
  readonly code = "invalid_input";
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

export type RequestOptions = {
  /** Human name of the source, used in every error message. */
  source: string;
  method?: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
  timeoutMs: number;
  signal?: AbortSignal;
};

function isTimeout(e: unknown): boolean {
  return e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
}

const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
class Retryable extends Error {}

/** Seconds from a Retry-After header, capped at 10 s. */
function retryAfterMs(res: Response): number | null {
  const v = res.headers.get("retry-after");
  if (!v) return null;
  const s = Number(v);
  return Number.isFinite(s) && s >= 0 ? Math.min(s, 10) * 1000 : null;
}

/**
 * One HTTP request with a timeout per attempt and up to `deps.retries` retries on network errors,
 * timeouts and HTTP 408/425/429/5xx (backoff 1 s, 3 s, 9 s ..., or Retry-After up to 10 s).
 * Returns the body of a 2xx response or throws a SourceError that names the source and the attempts.
 */
export async function requestText(deps: Deps, url: string, opts: RequestOptions): Promise<string> {
  const attempts = deps.retries + 1;
  for (let i = 1; ; i++) {
    try {
      return await attempt(deps, url, opts);
    } catch (e) {
      if (!(e instanceof Retryable)) throw e;
      const tail = attempts > 1 ? ` after ${i} attempt${i > 1 ? "s" : ""}` : "";
      if (i >= attempts || opts.signal?.aborted) throw new SourceError(opts.source, `${e.message}${tail}`);
      const wait = (e as Retryable & { waitMs?: number }).waitMs ?? 1000 * 3 ** (i - 1);
      deps.log(`${opts.source}: ${e.message}, retrying in ${wait / 1000} s (attempt ${i + 1} of ${attempts})`);
      await deps.sleep(wait);
    }
  }
}

async function attempt(deps: Deps, url: string, opts: RequestOptions): Promise<string> {
  const signals = [AbortSignal.timeout(opts.timeoutMs)];
  if (opts.signal) signals.push(opts.signal);
  let res: Response;
  try {
    res = await deps.fetch(url, {
      method: opts.method ?? "GET",
      body: opts.body,
      headers: { "user-agent": USER_AGENT, ...opts.headers },
      signal: AbortSignal.any(signals),
    });
  } catch (e) {
    if (opts.signal?.aborted) throw new SourceError(opts.source, "request cancelled by the client");
    if (isTimeout(e)) throw new Retryable(`no answer within ${Math.round(opts.timeoutMs / 1000)} s`);
    throw new Retryable(`network error: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (RETRY_STATUS.has(res.status)) {
    const err = new Retryable(`HTTP ${res.status}`) as Retryable & { waitMs?: number };
    err.waitMs = retryAfterMs(res) ?? undefined;
    throw err;
  }
  if (!res.ok) throw new SourceError(opts.source, `HTTP ${res.status}`);
  return res.text();
}

export async function requestJson<T>(deps: Deps, url: string, opts: RequestOptions): Promise<T> {
  const text = await requestText(deps, url, opts);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new SourceError(opts.source, "answered with something that is not JSON");
  }
}
