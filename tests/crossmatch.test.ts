import { describe, expect, it } from "vitest";

import { connect, data, fakeFetch, testDeps, text, TOI_ROUTE } from "./helpers.js";

// Uses the ExoFOP TOI table recorded 2026-11-27. Signals below are ephemerides published for L 98-59 and TOI-101.
describe("crossmatch_signal against the TOI table", () => {
  it("L 98-59 c's TOI ephemeris is known_planet, matching both the archive planet and TOI-175.01", async () => {
    const { call } = await connect(testDeps());
    const r = await call("crossmatch_signal", { tic_id: 307210830, period_days: 3.6906758578, epoch: 2460688.70837, duration_hours: 1.107 });
    expect(r.isError).toBeFalsy();
    const d = data(r);
    expect(d.verdict).toBe("known_planet");
    expect(d.matches.map((m: { known: { id: string } }) => m.known.id)).toEqual(["L 98-59 c", "TOI-175.01"]);
    expect(d.matches[0].epoch.aligned).toBe(true);
    expect(d.checked).toEqual({ tois_on_star: 3, confirmed_planets_on_star: 5 });
    expect(text(r)).toMatch(/^Verdict for TIC 307210830, P=3.6906758578 d: known_planet/);
  });
  it("TOI-700 d is known_planet", async () => {
    const { call } = await connect(testDeps());
    const d = data(await call("crossmatch_signal", { tic_id: 150428135, period_days: 37.4236838274161, epoch: 2458330.486155, duration_hours: 3.365 }));
    expect(d.verdict).toBe("known_planet");
    expect(d.matches[0].known.id).toBe("TOI-700 d");
  });
  it("a period match to L 98-59 e (not known to transit, so period only) counts as alias_of_known", async () => {
    const { call } = await connect(testDeps());
    const d = data(await call("crossmatch_signal", { tic_id: 307210830, period_days: 12.8278, epoch: 2459000.1, duration_hours: 1.5 }));
    expect(d.verdict).toBe("alias_of_known");
    expect(d.matches[0]).toMatchObject({ kind: "period_no_epoch" });
    expect(d.matches[0].known.id).toBe("L 98-59 e");
  });
  it("names the archive when it fails, and gives no verdict", async () => {
    const f = fakeFetch([TOI_ROUTE, { match: /exoplanetarchive/, status: 500 }]);
    const { call } = await connect(testDeps({ fetch: f.fetch }));
    const r = await call("crossmatch_signal", { tic_id: 307210830, period_days: 3.69, epoch: 2460688.7, duration_hours: 1 });
    expect(r.isError).toBe(true);
    expect(text(r)).toBe("source_unavailable: NASA Exoplanet Archive (pscomppars): HTTP 500");
  });
  it("accepts BTJD", async () => {
    const { call } = await connect(testDeps());
    const d = data(await call("crossmatch_signal", { tic_id: 307210830, period_days: 3.6906764, epoch: 1367.27303, duration_hours: 1.28 }));
    expect(d.signal.epoch_bjd).toBeCloseTo(2458367.27303, 6);
    expect(d.verdict).toBe("known_planet");
  });
  it("twice L 98-59 c's period is alias_of_known", async () => {
    const { call } = await connect(testDeps());
    const d = data(await call("crossmatch_signal", { tic_id: 307210830, period_days: 7.3813517, epoch: 2460688.70837, duration_hours: 1.1 }));
    expect(d.verdict).toBe("alias_of_known");
    expect(d.matches[0]).toMatchObject({ ratio: "2x", alias: true });
  });
  it("a dip at phase 0.5 of the hot Jupiter TOI-101.01 is a likely secondary eclipse", async () => {
    const { call } = await connect(testDeps());
    const d = data(await call("crossmatch_signal", { tic_id: 231663901, period_days: 1.43037, epoch: 2458326.009117 + 1.43036994965074 / 2, duration_hours: 1.6 }));
    expect(d.verdict).toBe("alias_of_known");
    expect(d.matches[0].kind).toBe("secondary_eclipse");
  });
  it("a made-up period on L 98-59 is no_match", async () => {
    const { call } = await connect(testDeps());
    const d = data(await call("crossmatch_signal", { tic_id: 307210830, period_days: 5.4321, epoch: 2459500.123, duration_hours: 1.5 }));
    expect(d.verdict).toBe("no_match");
    expect(d.matches).toEqual([]);
  });
  it("refuses an epoch in neither format", async () => {
    const { call } = await connect(testDeps());
    const r = await call("crossmatch_signal", { tic_id: 1, period_days: 3, epoch: 500000, duration_hours: 2 });
    expect(text(r)).toMatch(/^invalid_input: epoch 500000 is neither/);
  });
});
