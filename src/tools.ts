import type { Deps } from "./deps.js";
import { InputError } from "./http.js";
import { parseTic, parseToi } from "./ids.js";
import { TOI_SOURCE, TOI_URL, type Toi, type ToiCatalog } from "./sources/exofop.js";
import { coverage, type SectorCoverage } from "./coverage.js";
import { CAOM_SOURCE, caomTimeseries, MAST_INVOKE, TESSCUT_SOURCE, TESSCUT_URL, tesscutSectors, TIC_SOURCE, ticById } from "./sources/mast.js";

/** A tool result: a short summary for people, structured data for code. */
export type Output = { summary: string; data: Record<string, unknown> };

/** Everything the tools share for the life of one server. */
export type Ctx = { deps: Deps; tois: ToiCatalog };

const iso = (ms: number) => new Date(ms).toISOString();
const fmt = (n: number | null, digits = 4) => (n === null ? "?" : Number(n.toPrecision(digits)).toString());

export function toiLine(t: Toi): string {
  const disp = [t.tfopwg_disposition && `TFOPWG ${t.tfopwg_disposition}`, t.tess_disposition && `TESS ${t.tess_disposition}`].filter(Boolean).join(", ");
  return `TOI-${t.toi} (TIC ${t.tic_id}) ${disp || "no disposition"}: P=${fmt(t.period_days, 8)} d, epoch BJD ${t.epoch_bjd ?? "?"}, dur ${fmt(t.duration_hours)} h, depth ${fmt(t.depth_ppm)} ppm, Rp ${fmt(t.planet_radius_earth)} R_earth${t.comments ? ` — ${t.comments}` : ""}`;
}

export async function toiLookup(ctx: Ctx, args: { tic_id?: string | number; toi?: string | number }, signal?: AbortSignal): Promise<Output> {
  if ((args.tic_id === undefined) === (args.toi === undefined)) throw new InputError("give exactly one of tic_id or toi");
  const table = await ctx.tois.get(signal);
  let query: Record<string, unknown>;
  let rows: Toi[];
  if (args.tic_id !== undefined) {
    const tic = parseTic(args.tic_id);
    query = { tic_id: tic };
    rows = table.rows.filter((r) => r.tic_id === tic);
  } else {
    const { star, planet } = parseToi(args.toi!);
    query = { toi: planet ? `${star}.${planet}` : String(star) };
    rows = table.rows.filter((r) => (planet ? r.toi === `${star}.${planet}` : r.toi.split(".")[0] === String(star)));
  }
  const source = { name: TOI_SOURCE, url: TOI_URL, fetched_at: iso(table.fetchedAt), rows_in_table: table.rows.length };
  const label = "tic_id" in query ? `TIC ${query.tic_id}` : `TOI ${query.toi}`;
  const summary = rows.length
    ? `${rows.length} TOI${rows.length > 1 ? "s" : ""} for ${label} (ExoFOP, fetched ${source.fetched_at}):\n${rows.map(toiLine).join("\n")}`
    : `No TOI for ${label} in the ExoFOP TOI table (${table.rows.length} rows, fetched ${source.fetched_at}). That only means no TOI has been issued; it says nothing about whether the star has planets.`;
  return { summary, data: { query, count: rows.length, tois: rows, source } };
}

export async function starInfo(ctx: Ctx, args: { tic_id: string | number }, signal?: AbortSignal): Promise<Output> {
  const tic = parseTic(args.tic_id);
  const row = await ticById(ctx.deps, tic, signal);
  const source = { name: TIC_SOURCE, url: MAST_INVOKE, service: "Mast.Catalogs.Filtered.Tic", fetched_at: iso(ctx.deps.now()) };
  if (!row) {
    return { summary: `MAST has no TIC entry with ID ${tic}.`, data: { tic_id: tic, found: false, source } };
  }
  const star = {
    tic_id: tic,
    tic_version: row.version,
    object_type: row.objType,
    ra_deg: row.ra,
    dec_deg: row.dec,
    tmag: row.Tmag,
    tmag_err: row.e_Tmag,
    vmag: row.Vmag,
    teff_k: row.Teff,
    teff_err_k: row.e_Teff,
    logg_cgs: row.logg,
    logg_err_cgs: row.e_logg,
    radius_rsun: row.rad,
    radius_err_rsun: row.e_rad,
    mass_msun: row.mass,
    mass_err_msun: row.e_mass,
    density_solar: row.rho,
    density_err_solar: row.e_rho,
    luminosity_lsun: row.lum,
    luminosity_class: row.lumclass,
    distance_pc: row.d,
    distance_err_pc: row.e_d,
    parallax_mas: row.plx,
    contamination_ratio: row.contratio,
    contaminants: row.numcont,
    tic_disposition: row.disposition,
    duplicate_of: row.duplicate_id,
    gaia_dr2: row.GAIA,
    twomass: row.TWOMASS,
    hip: row.HIP,
  };
  const warn = row.disposition ? ` TIC disposition: ${row.disposition}${row.duplicate_id ? ` (duplicate of TIC ${row.duplicate_id})` : ""}.` : "";
  const summary = `TIC ${tic} (${row.objType ?? "?"}, ${row.lumclass ?? "class ?"}): Tmag ${fmt(row.Tmag)}, Teff ${row.Teff ?? "?"} K, R ${fmt(row.rad)} R_sun, M ${fmt(row.mass)} M_sun, distance ${fmt(row.d)} pc, contamination ratio ${fmt(row.contratio, 3)}. Source: MAST TIC v8.2.${warn}`;
  return { summary, data: { found: true, star, source } };
}

export async function tessObservations(ctx: Ctx, args: { tic_id: string | number }, signal?: AbortSignal): Promise<Output> {
  const tic = parseTic(args.tic_id);
  const star = await ticById(ctx.deps, tic, signal);
  if (!star || star.ra === null || star.dec === null) {
    throw new InputError(`MAST has no TIC entry with coordinates for ID ${tic}`);
  }
  const [footprint, products] = await Promise.all([tesscutSectors(ctx.deps, star.ra, star.dec, signal), caomTimeseries(ctx.deps, tic, signal)]);
  const cov = coverage(footprint, products);
  const list = (f: (s: SectorCoverage) => boolean) => cov.sectors.filter(f).map((s) => s.sector);
  const spoc2 = list((s) => s.spoc_2min);
  const data = {
    tic_id: tic,
    ra_deg: star.ra,
    dec_deg: star.dec,
    sector_count: cov.sectors.length,
    has_spoc_2min: spoc2.length > 0,
    sectors_ffi: list((s) => s.in_ffi),
    sectors_spoc_2min: spoc2,
    sectors_spoc_20s: list((s) => s.spoc_20s),
    sectors_with_hlsp: list((s) => s.hlsp.length > 0),
    multi_sector_hlsp: cov.multi_sector_hlsp,
    sectors: cov.sectors,
    sources: [
      { name: TIC_SOURCE, url: MAST_INVOKE, service: "Mast.Catalogs.Filtered.Tic" },
      { name: TESSCUT_SOURCE, url: TESSCUT_URL },
      { name: CAOM_SOURCE, url: MAST_INVOKE, service: "Mast.Caom.Filtered" },
    ],
    fetched_at: iso(ctx.deps.now()),
  };
  const summary = [
    `TIC ${tic}: ${cov.sectors.length} TESS sectors with data at MAST.`,
    `In full-frame images (TESScut): ${data.sectors_ffi.join(", ") || "none"}.`,
    `SPOC 2-min light curves: ${spoc2.length ? spoc2.join(", ") : "none"}.`,
    data.sectors_spoc_20s.length ? `SPOC 20-s light curves: ${data.sectors_spoc_20s.join(", ")}.` : "",
    `High-level light curves (QLP, TESS-SPOC, ...) in sectors: ${data.sectors_with_hlsp.join(", ") || "none"}.`,
  ]
    .filter(Boolean)
    .join("\n");
  return { summary, data };
}
