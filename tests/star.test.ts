import { describe, expect, it } from "vitest";

import { connect, data, fakeFetch, testDeps, text } from "./helpers.js";

// MAST TIC responses recorded 2026-11-27 (tests/fixtures/sources.json).
const MAST = [
  { match: /mast\.stsci\.edu\/api\/v0\/invoke .*Tic.*"307210830"/, file: "mast-tic-307210830.json" },
  { match: /mast\.stsci\.edu\/api\/v0\/invoke .*Tic.*"150428135"/, file: "mast-tic-150428135.json" },
  { match: /mast\.stsci\.edu\/api\/v0\/invoke .*Tic.*"9999999999"/, file: "mast-tic-missing.json" },
];

describe("star_info", () => {
  it("returns L 98-59's TIC parameters as MAST gives them", async () => {
    const { call } = await connect(testDeps({ fetch: fakeFetch(MAST).fetch }));
    const r = await call("star_info", { tic_id: "TIC 307210830" });
    expect(r.isError).toBeFalsy();
    const s = data(r).star;
    expect(s.tmag).toBeCloseTo(9.41242, 5);
    expect(s.teff_k).toBe(3429);
    expect(s.radius_rsun).toBeCloseTo(0.31416, 5);
    expect(s.mass_msun).toBeCloseTo(0.292836, 6);
    expect(s.distance_pc).toBeCloseTo(10.6194, 4);
    expect(s.gaia_dr2).toBe("5271055243163629056");
    expect(text(r)).toMatch(/Teff 3429 K/);
  });
  it("reports TOI-700 too", async () => {
    const { call } = await connect(testDeps({ fetch: fakeFetch(MAST).fetch }));
    expect(data(await call("star_info", { tic_id: 150428135 })).star.tmag).toBeCloseTo(10.9102, 4);
  });
  it("says when the TIC has no such star", async () => {
    const { call } = await connect(testDeps({ fetch: fakeFetch(MAST).fetch }));
    const r = await call("star_info", { tic_id: 9999999999 });
    expect(data(r).found).toBe(false);
    expect(text(r)).toMatch(/no TIC entry/);
  });
  it("names MAST when it fails", async () => {
    const down = await connect(testDeps({ fetch: fakeFetch([{ match: /mast/, status: 502 }]).fetch }));
    expect(text(await down.call("star_info", { tic_id: 1 }))).toBe("source_unavailable: MAST TIC catalog: HTTP 502");
    const odd = await connect(testDeps({ fetch: fakeFetch([{ match: /mast/, body: '{"status":"ERROR","msg":"bad filter"}' }]).fetch }));
    expect(text(await odd.call("star_info", { tic_id: 1 }))).toMatch(/MAST TIC catalog: MAST answered status "ERROR" \(bad filter\)/);
  });
});
