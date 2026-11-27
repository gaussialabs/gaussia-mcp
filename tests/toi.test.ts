import { describe, expect, it } from "vitest";

import { parseCsv } from "../src/csv.js";
import { parseTic, parseToi } from "../src/ids.js";
import { parseToiCsv, sexagesimal } from "../src/sources/exofop.js";
import { connect, data, fakeFetch, fx, testDeps, text, TOI_ROUTE, timeoutError } from "./helpers.js";

describe("ids", () => {
  it("parses TIC IDs in the usual spellings", () => {
    for (const s of ["307210830", "TIC 307210830", "tic-307210830", "TIC0000307210830", 307210830]) expect(parseTic(s)).toBe(307210830);
    expect(() => parseTic("L 98-59")).toThrow(/not a TIC ID/);
    expect(() => parseTic("0")).toThrow();
  });
  it("parses TOI numbers", () => {
    expect(parseToi("TOI-700")).toEqual({ star: 700, planet: null });
    expect(parseToi("175.01")).toEqual({ star: 175, planet: "01" });
    expect(parseToi(175.1)).toEqual({ star: 175, planet: "10" });
    expect(() => parseToi("TOI-abc")).toThrow(/not a TOI number/);
  });
});

describe("ExoFOP TOI table parsing (fixture fetched 2026-11-27)", () => {
  it("handles quoted fields with commas", () => {
    expect(parseCsv('a,"b,c","d ""e"""\n1,2,3\n')).toEqual([
      ["a", "b,c", 'd "e"'],
      ["1", "2", "3"],
    ]);
  });
  it("reads the L 98-59 rows as ExoFOP gives them", () => {
    const rows = parseToiCsv(fx("exofop-toi-subset.csv"));
    const c = rows.find((r) => r.toi === "175.01")!;
    expect(c.tic_id).toBe(307210830);
    expect(c.tfopwg_disposition).toBe("CP");
    expect(c.period_days).toBeCloseTo(3.6906758578021837, 12);
    expect(c.epoch_bjd).toBeCloseTo(2460688.70837, 6);
    expect(c.duration_hours).toBeCloseTo(1.107, 6);
    expect(c.depth_ppm).toBeCloseTo(1657, 6);
    expect(c.comments).toBe("L 98-59 c; TOI 175.01");
    expect(c.sectors).toContain(87);
    expect(c.ra_deg).toBeCloseTo(124.53287, 4);
    expect(c.dec_deg).toBeCloseTo(-68.31447, 4);
  });
  it("converts sexagesimal coordinates", () => {
    expect(sexagesimal("06:28:22.97", true)).toBeCloseTo(97.09571, 4);
    expect(sexagesimal("-00:30:00", false)).toBeCloseTo(-0.5, 9);
    expect(sexagesimal("nonsense", true)).toBeNull();
  });
  it("refuses a table without the columns it needs", () => {
    expect(() => parseToiCsv("TIC ID,TOI\n1,2.01\n")).toThrow(/no longer has a "TESS Disposition" column/);
  });
});

describe("toi_lookup", () => {
  it("finds the three L 98-59 TOIs by TIC ID", async () => {
    const { call } = await connect(testDeps());
    const r = await call("toi_lookup", { tic_id: "TIC 307210830" });
    expect(r.isError).toBeFalsy();
    expect(data(r).count).toBe(3);
    expect(data(r).tois.map((t: { toi: string }) => t.toi)).toEqual(["175.01", "175.02", "175.03"]);
    expect(data(r).source.url).toMatch(/exofop\.ipac\.caltech\.edu/);
    expect(text(r)).toMatch(/L 98-59 c/);
  });
  it("finds all TOI-700 planets by TOI number and one by full number", async () => {
    const { call } = await connect(testDeps());
    expect(data(await call("toi_lookup", { toi: "TOI-700" })).count).toBe(4);
    const one = data(await call("toi_lookup", { toi: "700.02" }));
    expect(one.count).toBe(1);
    expect(one.tois[0].comments).toMatch(/TOI-700 d/);
  });
  it("says plainly when a star has no TOI", async () => {
    const { call } = await connect(testDeps());
    const r = await call("toi_lookup", { tic_id: 12345 });
    expect(data(r).count).toBe(0);
    expect(text(r)).toMatch(/says nothing about whether the star has planets/);
  });
  it("downloads the table once per server", async () => {
    const f = fakeFetch([TOI_ROUTE]);
    const { call } = await connect(testDeps({ fetch: f.fetch }));
    await Promise.all([call("toi_lookup", { tic_id: 307210830 }), call("toi_lookup", { toi: 700 })]);
    await call("toi_lookup", { toi: 101 });
    expect(f.calls.length).toBe(1);
  });
  it("rejects bad input", async () => {
    const { call } = await connect(testDeps());
    const both = await call("toi_lookup", { tic_id: 1, toi: 2 });
    expect(both.isError).toBe(true);
    expect(text(both)).toMatch(/^invalid_input: give exactly one/);
    expect(text(await call("toi_lookup", { tic_id: "L 98-59" }))).toMatch(/^invalid_input: not a TIC ID/);
  });
  it("names ExoFOP when it fails and returns no data", async () => {
    const down = await connect(testDeps({ fetch: fakeFetch([{ match: /exofop/, status: 503 }]).fetch }));
    const r = await down.call("toi_lookup", { tic_id: 307210830 });
    expect(r.isError).toBe(true);
    expect(text(r)).toBe("source_unavailable: ExoFOP TOI table: HTTP 503");
    const slow = await connect(testDeps({ fetch: fakeFetch([{ match: /exofop/, error: timeoutError() }]).fetch }));
    expect(text(await slow.call("toi_lookup", { tic_id: 1 }))).toMatch(/ExoFOP TOI table: no answer within 90 s/);
  });
});
