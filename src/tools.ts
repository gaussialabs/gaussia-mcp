import type { Deps } from "./deps.js";
import { InputError } from "./http.js";
import { parseTic, parseToi } from "./ids.js";
import { TOI_SOURCE, TOI_URL, type Toi, type ToiCatalog } from "./sources/exofop.js";
import { MAST_INVOKE, TIC_SOURCE, ticById } from "./sources/mast.js";

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
