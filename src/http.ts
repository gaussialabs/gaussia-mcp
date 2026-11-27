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

/** One HTTP request with a timeout. Returns the body text of a 2xx response or throws a SourceError. */
export async function requestText(deps: Deps, url: string, opts: RequestOptions): Promise<string> {
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
    if (isTimeout(e)) throw new SourceError(opts.source, `no answer within ${Math.round(opts.timeoutMs / 1000)} s`);
    throw new SourceError(opts.source, `network error: ${e instanceof Error ? e.message : String(e)}`);
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
