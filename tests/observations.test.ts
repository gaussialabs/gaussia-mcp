import { describe, expect, it } from "vitest";

import { coverage } from "../src/coverage.js";
import { connect, data, fakeFetch, fx, testDeps, text } from "./helpers.js";

// MAST responses recorded 2026-11-27 (tests/fixtures/sources.json).
const MAST = [
  { match: /api\/v0\/invoke .*Catalogs\.Filtered\.Tic.*"307210830"/, file: "mast-tic-307210830.json" },
  { match: /api\/v0\/invoke .*Catalogs\.Filtered\.Tic.*"150428135"/, file: "mast-tic-150428135.json" },
  { match: /api\/v0\/invoke .*Catalogs\.Filtered\.Tic.*"9999999999"/, file: "mast-tic-missing.json" },
  { match: /api\/v0\/invoke .*Caom\.Filtered.*"307210830"/, file: "mast-caom-307210830.json" },
  { match: /api\/v0\/invoke .*Caom\.Filtered.*"150428135"/, file: "mast-caom-150428135.json" },
  { match: /tesscut\/api\/v0\.1\/sector\?ra=124\.53/, file: "mast-tesscut-307210830.json" },
  { match: /tesscut\/api\/v0\.1\/sector\?ra=97\.09/, file: "mast-tesscut-150428135.json" },
];

describe("coverage merge", () => {
  const cov = coverage(JSON.parse(fx("mast-tesscut-307210830.json")).results.map((r: Record<string, string>) => ({ sector: +r.sector!, camera: +r.camera!, ccd: +r.ccd! })), JSON.parse(fx("mast-caom-307210830.json")).data);
  it("puts L 98-59's SPOC 2-min sectors where MAST lists them", () => {
    const two = cov.sectors.filter((s) => s.spoc_2min).map((s) => s.sector);
    expect(two).toEqual([2, 5, 8, 9, 10, 11, 12, 28, 29, 32, 35, 36, 37, 38, 39, 61, 62, 63, 64, 65, 69, 87, 88, 89, 90, 96, 98]);
  });
  it("keeps the FFI-only sector 1 (no 2-min target that sector)", () => {
    const s1 = cov.sectors.find((s) => s.sector === 1)!;
    expect(s1).toMatchObject({ in_ffi: true, spoc_2min: false, camera: 4, ccd: 3 });
  });
  it("leaves out multi-sector DV products and files multi-sector HLSPs separately", () => {
    expect(cov.sectors.every((s) => s.sector > 0 && s.sector < 200)).toBe(true);
    expect(cov.multi_sector_hlsp).toContain("DIAMANTE");
  });
  it("labels HLSP light curves by provenance and cadence", () => {
    expect(cov.sectors.find((s) => s.sector === 12)!.hlsp).toEqual(expect.arrayContaining(["QLP 1800s", "TESS-SPOC 1800s"]));
  });
});

describe("tess_observations", () => {
  it("reports L 98-59 coverage end to end", async () => {
    const f = fakeFetch(MAST);
    const { call } = await connect(testDeps({ fetch: f.fetch }));
    const r = await call("tess_observations", { tic_id: 307210830 });
    expect(r.isError).toBeFalsy();
    expect(f.unrouted).toEqual([]);
    const d = data(r);
    expect(d.has_spoc_2min).toBe(true);
    expect(d.sectors_ffi).toHaveLength(28);
    expect(d.sectors_spoc_2min).toContain(98);
    expect(text(r)).toMatch(/SPOC 2-min light curves: 2, 5, 8/);
  });
  it("reports TOI-700 coverage", async () => {
    const { call } = await connect(testDeps({ fetch: fakeFetch(MAST).fetch }));
    const d = data(await call("tess_observations", { tic_id: "TIC 150428135" }));
    expect(d.sectors_spoc_2min.length).toBeGreaterThan(30);
    expect(d.sectors_spoc_20s.length).toBeGreaterThan(10);
  });
  it("refuses a TIC that does not exist", async () => {
    const { call } = await connect(testDeps({ fetch: fakeFetch(MAST).fetch }));
    expect(text(await call("tess_observations", { tic_id: 9999999999 }))).toMatch(/^invalid_input: MAST has no TIC entry/);
  });
  it("names TESScut when it fails", async () => {
    const routes = [{ match: /tesscut/, status: 500 }, ...MAST];
    const { call } = await connect(testDeps({ fetch: fakeFetch(routes).fetch }));
    expect(text(await call("tess_observations", { tic_id: 307210830 }))).toBe("source_unavailable: MAST TESScut sector lookup: HTTP 500");
  });
});
