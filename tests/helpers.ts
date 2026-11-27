import { readFileSync } from "node:fs";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { Deps, FetchLike } from "../src/deps.js";
import { createServer } from "../src/server.js";

/** A recorded response from tests/fixtures (see sources.json for where and when each was fetched). */
export function fx(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

export interface Route {
  /** Matched against the URL plus, for POSTs, the decoded body. */
  match: RegExp;
  status?: number;
  file?: string;
  body?: string;
  error?: Error;
}

export function timeoutError(): Error {
  const e = new Error("The operation was aborted due to timeout");
  e.name = "TimeoutError";
  return e;
}

/** A fetch that answers from fixtures. Unrouted requests get a 404 and are listed in `unrouted`. */
export function fakeFetch(routes: Route[]) {
  const calls: string[] = [];
  const unrouted: string[] = [];
  const fetch: FetchLike = async (url, init) => {
    const body = typeof init?.body === "string" ? decodeURIComponent(init.body.replace(/\+/g, " ")) : "";
    const key = body ? `${url} ${body}` : url;
    calls.push(key);
    const r = routes.find((x) => x.match.test(key));
    if (!r) {
      unrouted.push(key);
      return new Response("not found", { status: 404 });
    }
    if (r.error) throw r.error;
    return new Response(r.file ? fx(r.file) : (r.body ?? ""), { status: r.status ?? 200 });
  };
  return { fetch, calls, unrouted };
}

export const TOI_ROUTE: Route = { match: /exofop\.ipac\.caltech\.edu\/tess\/download_toi\.php/, file: "exofop-toi-subset.csv" };

/** Archive answers recorded 2026-11-27. The TOI-2220 answer (no planets) stands in for any other star. */
export const ARCHIVE_ROUTES: Route[] = [
  { match: /exoplanetarchive\.ipac\.caltech\.edu\/TAP\/sync.*TIC%20307210830/, file: "archive-pscomppars-307210830.json" },
  { match: /exoplanetarchive\.ipac\.caltech\.edu\/TAP\/sync.*TIC%20150428135/, file: "archive-pscomppars-150428135.json" },
  { match: /exoplanetarchive\.ipac\.caltech\.edu\/TAP\/sync.*TIC%20231663901/, file: "archive-pscomppars-231663901.json" },
  { match: /exoplanetarchive\.ipac\.caltech\.edu\/TAP\/sync/, file: "archive-pscomppars-150437346.json" },
];

export function testDeps(over: Partial<Deps> = {}): Deps {
  return { fetch: fakeFetch([TOI_ROUTE, ...ARCHIVE_ROUTES]).fetch, log: () => {}, now: () => Date.UTC(2026, 10, 27), ...over };
}

export async function connect(deps: Deps) {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await createServer(deps).connect(serverT);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientT);
  const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as CallToolResult;
  return { client, call };
}

export const text = (r: CallToolResult, i = 0) => (r.content[i] as { type: "text"; text: string }).text;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const data = (r: CallToolResult) => r.structuredContent as any;
