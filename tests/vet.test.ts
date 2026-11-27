import { describe, expect, it } from "vitest";

import { aOverRstar, maxDurationHours, radiusRatio, vet } from "../src/vet.js";
import { connect, data, fakeFetch, testDeps, text } from "./helpers.js";

const SUN = { radius_rsun: 1, mass_msun: 1, contamination_ratio: 0 };

describe("vetting math", () => {
  it("puts the Earth at 215 solar radii with a 13-hour central transit", () => {
    const aR = aOverRstar(365.25, 1, 1);
    expect(aR).toBeCloseTo(215.0, 0);
    expect(maxDurationHours(365.25, aR, radiusRatio(84))).toBeCloseTo(13.0, 0);
  });
  it("turns a 1% dip on a Sun-like star into about a Jupiter radius", () => {
    const v = vet({ period_days: 10, duration_hours: 3, depth_ppm: 10_000 }, SUN);
    expect(v.radius_ratio).toBeCloseTo(0.1, 9);
    expect(v.planet_radius_earth).toBeCloseTo(10.9, 1);
    expect(v.planet_radius_jupiter).toBeCloseTo(0.973, 2);
    expect(v.flags).toEqual([]);
  });
  it("flags eclipses only a star produces", () => {
    const codes = vet({ period_days: 2, duration_hours: 3, depth_ppm: 300_000 }, SUN).flags.map((f) => f.code);
    expect(codes).toEqual(expect.arrayContaining(["deep_eclipse", "too_large_for_planet"]));
  });
  it("flags durations far from what the star allows", () => {
    expect(vet({ period_days: 3, duration_hours: 9, depth_ppm: 1000 }, SUN).flags.map((f) => f.code)).toEqual(["too_long"]);
    expect(vet({ period_days: 30, duration_hours: 0.5, depth_ppm: 1000 }, SUN).flags.map((f) => f.code)).toEqual(["very_short"]);
    expect(vet({ period_days: 0.1, duration_hours: 1, depth_ppm: 1000 }, SUN).flags.map((f) => f.code)).toEqual(["inside_star"]);
  });
  it("removes TIC contamination from the depth, and flags crowding", () => {
    const v = vet({ period_days: 10, duration_hours: 3, depth_ppm: 10_000 }, { ...SUN, contamination_ratio: 1 });
    expect(v.planet_radius_earth_decontaminated! / v.planet_radius_earth!).toBeCloseTo(Math.SQRT2, 9);
    expect(v.flags.map((f) => f.code)).toEqual(["crowded"]);
  });
  it("skips the duration check without a stellar mass", () => {
    const v = vet({ period_days: 10, duration_hours: 3, depth_ppm: 1000 }, { radius_rsun: 1, mass_msun: null, contamination_ratio: null });
    expect(v.max_duration_hours).toBeNull();
    expect(v.planet_radius_earth).not.toBeNull();
  });
});

// TIC parameters recorded from MAST 2026-11-27.
const MAST = [{ match: /api\/v0\/invoke .*Tic.*"307210830"/, file: "mast-tic-307210830.json" }];

describe("vet_signal", () => {
  it("L 98-59 c's TOI values pass both checks, with a radius close to ExoFOP's", async () => {
    const { call } = await connect(testDeps({ fetch: fakeFetch(MAST).fetch }));
    const r = await call("vet_signal", { tic_id: 307210830, period_days: 3.6906758578, duration_hours: 1.107, depth_ppm: 1657 });
    expect(r.isError).toBeFalsy();
    const d = data(r);
    expect(d.flags).toEqual([]);
    expect(d.planet_radius_earth).toBeCloseTo(1.39, 1); // ExoFOP lists 1.37
    expect(d.max_duration_hours).toBeGreaterThan(1.107);
    expect(text(r)).toMatch(/No flags from these two checks/);
  });
  it("a 6-hour, 30% dip on the same M dwarf gets flagged", async () => {
    const { call } = await connect(testDeps({ fetch: fakeFetch(MAST).fetch }));
    const d = data(await call("vet_signal", { tic_id: 307210830, period_days: 3.69, duration_hours: 6, depth_ppm: 300_000 }));
    expect(d.flags.map((f: { code: string }) => f.code)).toEqual(["deep_eclipse", "too_long"]);
  });
});
