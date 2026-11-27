export const SERVER_NAME = "gaussia-mcp";
export const SERVER_VERSION = "0.3.0";
export const USER_AGENT = `${SERVER_NAME}/${SERVER_VERSION} (+https://gaussia.app)`;

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Everything a tool needs. Built from the environment in index.ts, injected in tests. */
export type Deps = {
  /** fetch for every outbound call (ExoFOP, NASA Exoplanet Archive, MAST). Default: global fetch. */
  fetch: FetchLike;
  log: (message: string) => void;
  /** Clock, injectable for cache tests. */
  now: () => number;
};

export function depsFromEnv(): Deps {
  return {
    fetch: (url, init) => fetch(url, init),
    log: (message) => process.stderr.write(`[gaussia-mcp] ${message}\n`),
    now: () => Date.now(),
  };
}
