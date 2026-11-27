export const SERVER_NAME = "gaussia-mcp";
export const SERVER_VERSION = "0.8.0";
export const USER_AGENT = `${SERVER_NAME}/${SERVER_VERSION} (+https://gaussia.app)`;

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Everything a tool needs. Built from the environment in index.ts, injected in tests. */
export type Deps = {
  /** fetch for every outbound call (ExoFOP, NASA Exoplanet Archive, MAST). Default: global fetch. */
  fetch: FetchLike;
  log: (message: string) => void;
  /** Clock, injectable for cache tests. */
  now: () => number;
  /** Extra attempts after a failed request (network error, timeout, HTTP 429/5xx). */
  retries: number;
  /** Wait between attempts; injectable so tests do not sleep. */
  sleep: (ms: number) => Promise<void>;
  /** How long the downloaded TOI table is used before it is fetched again. */
  toiTtlMs: number;
};

function envNumber(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${name} must be a number from ${min} to ${max}, got ${JSON.stringify(raw)}`);
  return n;
}

export function depsFromEnv(env: NodeJS.ProcessEnv = process.env): Deps {
  return {
    fetch: (url, init) => fetch(url, init),
    log: (message) => process.stderr.write(`[gaussia-mcp] ${message}\n`),
    now: () => Date.now(),
    retries: envNumber(env, "GAUSSIA_RETRIES", 2, 0, 5),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    toiTtlMs: envNumber(env, "GAUSSIA_TOI_TTL_HOURS", 6, 0, 168) * 3_600_000,
  };
}
