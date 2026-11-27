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
});

describe.skipIf(!LIVE)("live: MAST", () => {
  it("star_info returns L 98-59 from the TIC", { timeout: 60_000 }, async () => {
    const { call } = await connect(deps());
    const s = data(await call("star_info", { tic_id: 307210830 })).star;
    expect(s.tmag).toBeCloseTo(9.41, 1);
    expect(s.distance_pc).toBeGreaterThan(10);
  });
});
