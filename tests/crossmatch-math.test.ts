import { describe, expect, it } from "vitest";

import { atHalfPhase, crossmatch, epochCheck, periodMatch, RATIOS, separationArcsec, toBjd, type Known } from "../src/crossmatch.js";

const T = 2459000;
const known = (over: Partial<Known> = {}): Known => ({
  kind: "toi",
  id: "TOI-1.01",
  tic_id: 1,
  period_days: 10,
  period_err_days: 0,
  epoch_bjd: T,
  epoch_err_days: 0,
  duration_hours: 3,
  disposition: "PC",
  note: null,
  ...over,
});
const sig = (period_days: number, epoch_bjd: number, duration_hours = 3) => ({ period_days, epoch_bjd, duration_hours });

describe("period aliases", () => {
  it("covers every n/m with n, m <= 3 and gcd 1", () => {
    const vals = RATIOS.map((r) => r.n / r.m).sort((a, b) => a - b);
    expect(vals).toEqual([1 / 3, 1 / 2, 2 / 3, 1, 3 / 2, 2, 3]);
  });
  it.each([
    [10, "1/1"],
    [5, "1/2"],
    [20, "2/1"],
    [10 / 3, "1/3"],
    [30, "3/1"],
    [20 / 3, "2/3"],
    [15, "3/2"],
  ])("period %f matches 10 d at %s", (p, label) => {
    const m = periodMatch(p * 1.0005, 10, 0, 0.002)!;
    expect(`${m.ratio.n}/${m.ratio.m}`).toBe(label);
    expect(m.rel_diff).toBeCloseTo(0.0005, 6);
  });
  it("rejects periods outside the tolerance", () => {
    expect(periodMatch(10.03, 10, 0, 0.002)).toBeNull();
    expect(periodMatch(12.5, 10, 0, 0.002)).toBeNull();
    expect(periodMatch(10.03, 10, 0, 0.005)).not.toBeNull();
  });
  it("widens to 3 sigma of the known period when that is larger", () => {
    expect(periodMatch(10.05, 10, 0.02, 0.002)).not.toBeNull();
    expect(periodMatch(20.1, 10, 0.02, 0.002)!.allowed_days).toBeCloseTo(0.12, 9);
  });
});

describe("epoch alignment", () => {
  it("lines up a same-period signal many orbits later", () => {
    const e = epochCheck(sig(10, T + 500 + 0.02), known(), { n: 1, m: 1 })!;
    expect(e.aligned).toBe(true);
    expect(e.cycles).toBeCloseTo(50, 2);
    expect(e.offset_hours).toBeCloseTo(0.48, 6);
    expect(e.window_hours).toBeCloseTo(1.5, 9);
  });
  it("rejects a same-period signal at another phase", () => {
    const e = epochCheck(sig(10, T + 2), known(), { n: 1, m: 1 })!;
    expect(e.aligned).toBe(false);
    expect(e.phase).toBeCloseTo(0.2, 9);
  });
  it("accepts the in-between transit for half the period, and the 1/m grid generally", () => {
    expect(epochCheck(sig(5, T + 5), known(), { n: 1, m: 2 })!.aligned).toBe(true);
    expect(epochCheck(sig(15, T + 5), known(), { n: 3, m: 2 })!.aligned).toBe(true);
    expect(epochCheck(sig(20 / 3, T + 10 / 3), known(), { n: 2, m: 3 })!.aligned).toBe(true);
    expect(epochCheck(sig(20, T + 5), known(), { n: 2, m: 1 })!.aligned).toBe(false);
  });
  it("propagates the known ephemeris error over the elapsed orbits", () => {
    const e = epochCheck(sig(10, T + 10_000 + 2), known({ period_err_days: 0.001, epoch_err_days: 0 }), { n: 1, m: 1 })!;
    expect(e.cycles).toBeCloseTo(1000, 0);
    expect(e.sigma_hours).toBeCloseTo(24, 1);
    expect(e.window_hours).toBeCloseTo(72, 1);
    expect(e.aligned).toBe(true);
  });
  it("finds phase 0.5", () => {
    expect(atHalfPhase(sig(10, T + 5.01), known(), 1.5)).toBe(true);
    expect(atHalfPhase(sig(10, T + 3), known(), 1.5)).toBe(false);
  });
  it("returns null without a known epoch", () => {
    expect(epochCheck(sig(10, T), known({ epoch_bjd: null }), { n: 1, m: 1 })).toBeNull();
  });
});

describe("verdicts", () => {
  it("known_toi for a direct match, alias_of_known for an aligned alias", () => {
    expect(crossmatch(sig(10.001, T + 100), [known()], 0.002).verdict).toBe("known_toi");
    const a = crossmatch(sig(20.002, T + 100), [known()], 0.002);
    expect(a.verdict).toBe("alias_of_known");
    expect(a.matches[0]!.ratio).toBe("2x");
  });
  it("known_planet beats known_toi when both match", () => {
    const r = crossmatch(sig(10, T), [known(), known({ kind: "planet", id: "X b", disposition: "confirmed" })], 0.002);
    expect(r.verdict).toBe("known_planet");
    expect(r.matches[0]!.known.id).toBe("X b");
  });
  it("flags a secondary eclipse as alias_of_known", () => {
    const r = crossmatch(sig(10, T + 5), [known()], 0.002);
    expect(r.verdict).toBe("alias_of_known");
    expect(r.matches[0]!.kind).toBe("secondary_eclipse");
  });
  it("counts a period match to an object without an epoch", () => {
    const r = crossmatch(sig(10, T + 3), [known({ epoch_bjd: null })], 0.002);
    expect(r.verdict).toBe("alias_of_known");
    expect(r.matches[0]!.kind).toBe("period_no_epoch");
  });
  it("no_match keeps period-only near misses for the record", () => {
    const r = crossmatch(sig(10, T + 2), [known()], 0.002);
    expect(r.verdict).toBe("no_match");
    expect(r.near_misses).toHaveLength(1);
    expect(r.reasons[0]).toMatch(/near miss/);
    expect(crossmatch(sig(7.77, T), [known()], 0.002).near_misses).toHaveLength(0);
  });
});

describe("epoch formats", () => {
  it("converts BTJD and passes BJD through", () => {
    expect(toBjd(2000.5, "auto")).toBe(2459000.5);
    expect(toBjd(2459000.5, "auto")).toBe(2459000.5);
    expect(toBjd(100, "btjd")).toBe(2457100);
    expect(toBjd(500_000, "auto")).toBeNull();
  });
});

describe("angular separation", () => {
  it("measures arcseconds on the sky", () => {
    expect(separationArcsec(10, 0, 10, 1)).toBeCloseTo(3600, 6);
    expect(separationArcsec(0, 60, 1, 60)).toBeCloseTo(1800, 0);
    expect(separationArcsec(359.99, 0, 0.01, 0)).toBeCloseTo(72, 3);
  });
});
