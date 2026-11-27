import { describe, expect, it } from "vitest";

import { depsFromEnv, type FetchLike } from "../src/deps.js";
import { requestText } from "../src/http.js";
import { ToiCatalog } from "../src/sources/exofop.js";
import { fakeFetch, fx, testDeps, timeoutError, TOI_ROUTE } from "./helpers.js";

/** A fetch that plays back a script of responses (a status number, "timeout" or a body). */
function scripted(script: (number | "timeout" | string)[]) {
  const calls: string[] = [];
  const fetch: FetchLike = async (url) => {
    calls.push(url);
    const step = script.shift();
    if (step === undefined) throw new Error("script exhausted");
    if (step === "timeout") throw timeoutError();
    if (typeof step === "number") return new Response("x", { status: step, headers: step === 429 ? { "retry-after": "2" } : {} });
    return new Response(step, { status: 200 });
  };
  return { fetch, calls };
}

describe("retries", () => {
  it("retries 5xx, 429 and timeouts with backoff, then succeeds", async () => {
    const waits: number[] = [];
    const s = scripted([503, "timeout", 429, "ok"]);
    const deps = testDeps({ fetch: s.fetch, retries: 3, sleep: async (ms) => void waits.push(ms) });
    expect(await requestText(deps, "https://example.test/a", { source: "Test source", timeoutMs: 1000 })).toBe("ok");
    expect(s.calls).toHaveLength(4);
    expect(waits).toEqual([1000, 3000, 2000]);
  });
  it("names the source and the attempts when every attempt fails", async () => {
    const deps = testDeps({ fetch: scripted([502, 502, 502]).fetch, retries: 2 });
    await expect(requestText(deps, "https://example.test/a", { source: "Test source", timeoutMs: 1000 })).rejects.toThrow("Test source: HTTP 502 after 3 attempts");
  });
  it("does not retry a 404", async () => {
    const s = scripted([404, "ok"]);
    await expect(requestText(testDeps({ fetch: s.fetch, retries: 2 }), "https://example.test/a", { source: "Test source", timeoutMs: 1000 })).rejects.toThrow("Test source: HTTP 404");
    expect(s.calls).toHaveLength(1);
  });
  it("reads GAUSSIA_RETRIES and GAUSSIA_TOI_TTL_HOURS, and rejects nonsense", () => {
    const d = depsFromEnv({ GAUSSIA_RETRIES: "4", GAUSSIA_TOI_TTL_HOURS: "0.5" });
    expect(d.retries).toBe(4);
    expect(d.toiTtlMs).toBe(1_800_000);
    expect(depsFromEnv({}).retries).toBe(2);
    expect(() => depsFromEnv({ GAUSSIA_RETRIES: "lots" })).toThrow(/GAUSSIA_RETRIES must be a number/);
  });
});

describe("TOI table cache", () => {
  const HOUR = 3_600_000;
  it("reuses the table within the TTL and fetches it again after", async () => {
    let now = Date.UTC(2026, 10, 27);
    const f = fakeFetch([TOI_ROUTE]);
    const cat = new ToiCatalog(testDeps({ fetch: f.fetch, now: () => now, toiTtlMs: 6 * HOUR }));
    await cat.get();
    now += 5 * HOUR;
    await cat.get();
    expect(f.calls).toHaveLength(1);
    now += 2 * HOUR;
    const t = await cat.get();
    expect(f.calls).toHaveLength(2);
    expect(t.fetchedAt).toBe(now);
    expect(t.stale).toBeNull();
  });
  it("serves the previous copy, marked stale, when a refresh fails", async () => {
    let now = Date.UTC(2026, 10, 27);
    const s = scripted([fx("exofop-toi-subset.csv"), 503]);
    const cat = new ToiCatalog(testDeps({ fetch: s.fetch, now: () => now }));
    const first = await cat.get();
    now += 7 * HOUR;
    const t = await cat.get();
    expect(t.rows).toBe(first.rows);
    expect(t.stale).toMatch(/^refresh failed \(ExoFOP TOI table: HTTP 503\); serving the copy downloaded 2026-11-27T00:00:00.000Z$/);
  });
  it("never serves a copy older than 7 days", async () => {
    let now = Date.UTC(2026, 10, 27);
    const s = scripted([fx("exofop-toi-subset.csv"), 503]);
    const cat = new ToiCatalog(testDeps({ fetch: s.fetch, now: () => now }));
    await cat.get();
    now += 8 * 24 * HOUR;
    await expect(cat.get()).rejects.toThrow("ExoFOP TOI table: HTTP 503");
  });
});
