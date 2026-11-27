import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { SERVER_NAME, SERVER_VERSION, type Deps } from "./deps.js";
import { InputError, SourceError } from "./http.js";
import { ToiCatalog } from "./sources/exofop.js";
import { crossmatchSignal, starInfo, tessObservations, toiLookup, type Ctx, type Output } from "./tools.js";

export { SERVER_NAME, SERVER_VERSION };

const INSTRUCTIONS = `Gaussia tools for TESS exoplanet signals, backed by public NASA data (ExoFOP TOI table, NASA Exoplanet Archive, MAST).
Use toi_lookup to see which TESS Objects of Interest a star already has, star_info for the star's TIC parameters, tess_observations for the sectors and light curves TESS has for it.
Before treating any transit signal as new, run crossmatch_signal: it checks the TOIs and confirmed planets on the star, including period aliases and transit times.
Every number comes from the named source at the time of the call; when a source fails the tool returns an error naming it, never substitute data.
Say "candidate", never "planet": only follow-up observations confirm a planet.`;

const READ_WEB = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

const TIC = z.union([z.string().min(1).max(30), z.number().int().positive()]).describe('TESS Input Catalog ID: 307210830 or "TIC 307210830".');

function ok(out: Output): CallToolResult {
  return {
    content: [
      { type: "text", text: out.summary },
      { type: "text", text: JSON.stringify(out.data) },
    ],
    structuredContent: out.data,
  };
}

function errorCode(e: unknown): string {
  if (e instanceof SourceError || e instanceof InputError) return e.code;
  return "error";
}

/** Errors come back as tool results the model can read, never as crashes or protocol errors. */
async function run(deps: Deps, name: string, fn: () => Promise<Output>): Promise<CallToolResult> {
  try {
    return ok(await fn());
  } catch (e) {
    const code = errorCode(e);
    const message = e instanceof Error ? e.message : String(e);
    deps.log(`${name} failed (${code}): ${message}`);
    return { isError: true, content: [{ type: "text", text: `${code}: ${message}` }] };
  }
}

/** A fresh McpServer with every Gaussia tool. Transport wiring is in index.ts so tests can use an in-memory pair. */
export function createServer(deps: Deps): McpServer {
  const ctx: Ctx = { deps, tois: new ToiCatalog(deps) };
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "toi_lookup",
    {
      title: "Look up TESS Objects of Interest",
      description:
        "Finds TESS Objects of Interest (TOIs) by TIC ID or TOI number in the public ExoFOP TOI table and returns each one as ExoFOP gives it: TESS and TFOPWG dispositions (PC candidate, CP confirmed, KP known planet, APC, FP false positive, FA false alarm), period (days), epoch (BJD_TDB), duration (hours), depth (ppm), planet radius (Earth radii), SNR, sectors and comments. The first call downloads the whole table (about 4 MB; ExoFOP takes 10-30 s), later calls reuse it.",
      inputSchema: {
        tic_id: TIC.optional(),
        toi: z.union([z.string().min(1).max(20), z.number().positive()]).optional().describe('TOI number: 175 (all planets of TOI-175), 175.01, or "TOI-700". Give tic_id or toi, not both.'),
      },
      annotations: { title: "Look up TESS Objects of Interest", ...READ_WEB },
    },
    async (args, extra) => run(deps, "toi_lookup", () => toiLookup(ctx, args, extra.signal)),
  );

  server.registerTool(
    "star_info",
    {
      title: "TIC star parameters",
      description:
        "Returns a star's parameters from the TESS Input Catalog (TIC v8.2) at MAST: TESS magnitude, Teff (K), log g, radius and mass (solar), density (solar), luminosity class, distance (pc), parallax, contamination ratio, TIC disposition (e.g. SPLIT, DUPLICATE, ARTIFACT) and Gaia DR2 / 2MASS / HIP IDs. Values are the catalog's, not a fit. Usually 1-3 s.",
      inputSchema: { tic_id: TIC },
      annotations: { title: "TIC star parameters", ...READ_WEB },
    },
    async (args, extra) => run(deps, "star_info", () => starInfo(ctx, args, extra.signal)),
  );

  server.registerTool(
    "tess_observations",
    {
      title: "TESS sectors and light curves for a star",
      description:
        "Lists the TESS sectors that observed a TIC and which light curves exist per sector: whether the star fell in the full-frame images (MAST TESScut, with camera and CCD), SPOC 2-min and 20-s light curves (MAST CAOM), and high-level science product light curves such as QLP, TESS-SPOC, TASOC, TGLC and CDIPS with their cadence. Answers 'has this star got 2-min SPOC data?'. Uses the TIC position from MAST; three MAST requests, usually 2-5 s.",
      inputSchema: { tic_id: TIC },
      annotations: { title: "TESS sectors and light curves for a star", ...READ_WEB },
    },
    async (args, extra) => run(deps, "tess_observations", () => tessObservations(ctx, args, extra.signal)),
  );

  server.registerTool(
    "crossmatch_signal",
    {
      title: "Cross-match a transit signal against known objects",
      description:
        "Checks a transit signal (TIC ID, period, epoch, duration) against the TOIs on the same star (ExoFOP TOI table) and its confirmed planets (NASA Exoplanet Archive, pscomppars table, matched by TIC ID). A match needs the period at the known period times n/m (n, m up to 3: 1, 1/2, 2, 1/3, 3, 2/3, 3/2) within the tolerance, and transit times that line up after propagating the known ephemeris (window: half the longer duration, or 3 sigma of the propagated ephemeris). A same-period signal at phase 0.5 is flagged as a likely secondary eclipse. Returns verdict known_planet, known_toi, alias_of_known or no_match with a reason per match and period-only near misses. no_match only means these catalogs have nothing there; it is not a discovery.",
      inputSchema: {
        tic_id: TIC,
        period_days: z.number().positive().max(2000).describe("Orbital period of the signal in days."),
        epoch: z.number().positive().describe("Mid-transit time of one transit, BJD_TDB (e.g. 2459000.5) or BTJD (BJD - 2457000, e.g. 2000.5)."),
        epoch_format: z.enum(["auto", "bjd", "btjd"]).optional().describe("auto (default) treats values above 2,400,000 as BJD_TDB and values below 100,000 as BTJD."),
        duration_hours: z.number().positive().max(72).describe("Transit duration in hours (first to fourth contact)."),
        period_tolerance: z.number().min(1e-7).max(0.05).optional().describe("Relative period tolerance for a match. Default 0.002 (0.2%). Widen for periods from few transits."),
      },
      annotations: { title: "Cross-match a transit signal", ...READ_WEB },
    },
    async (args, extra) => run(deps, "crossmatch_signal", () => crossmatchSignal(ctx, args, extra.signal)),
  );

  return server;
}
