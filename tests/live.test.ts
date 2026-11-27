// Live tests against the real public sources. Off by default: run with `pnpm test:live` (GAUSSIA_LIVE=1).
import { describe, expect, it } from "vitest";

import { depsFromEnv } from "../src/deps.js";
import { connect, data } from "./helpers.js";

const LIVE = process.env.GAUSSIA_LIVE === "1";
const deps = () => ({ ...depsFromEnv(), log: () => {} });

describe.skipIf(!LIVE)("live: ExoFOP", () => {
  it("toi_lookup finds the L 98-59 TOIs in today's table", { timeout: 180_000 }, async () => {
    const { call } = await connect(deps());
    const r = data(await call("toi_lookup", { tic_id: 307210830 }));
    expect(r.count).toBeGreaterThanOrEqual(3);
    expect(r.source.rows_in_table).toBeGreaterThan(7000);
  });
  it("crossmatch_signal: TOI-700 d's published ephemeris is a known TOI, a random period is not", { timeout: 180_000 }, async () => {
    const { call } = await connect(deps());
    const d = data(await call("crossmatch_signal", { tic_id: 150428135, period_days: 37.4236838, epoch: 2458330.486155, duration_hours: 3.37 }));
    expect(["known_toi", "known_planet"]).toContain(d.verdict);
    const r = data(await call("crossmatch_signal", { tic_id: 150428135, period_days: 4.1234, epoch: 2459400.5, duration_hours: 2 }));
    expect(r.verdict).toBe("no_match");
  });
});

describe.skipIf(!LIVE)("live: MAST", () => {
  it("star_info returns L 98-59 from the TIC", { timeout: 60_000 }, async () => {
    const { call } = await connect(deps());
    const s = data(await call("star_info", { tic_id: 307210830 })).star;
    expect(s.tmag).toBeCloseTo(9.41, 1);
    expect(s.distance_pc).toBeGreaterThan(10);
  });
  it("tess_observations finds SPOC 2-min sectors for L 98-59", { timeout: 90_000 }, async () => {
    const { call } = await connect(deps());
    const d = data(await call("tess_observations", { tic_id: 307210830 }));
    expect(d.has_spoc_2min).toBe(true);
    expect(d.sectors_spoc_2min).toEqual(expect.arrayContaining([2, 5, 8]));
  });
  it("vet_signal passes L 98-59 c's TOI values", { timeout: 60_000 }, async () => {
    const { call } = await connect(deps());
    const d = data(await call("vet_signal", { tic_id: 307210830, period_days: 3.6906758578, duration_hours: 1.107, depth_ppm: 1657 }));
    expect(d.flags).toEqual([]);
  });
});
