import type { Deps } from "./deps.js";
import { InputError } from "./http.js";
import { parseTic, parseToi } from "./ids.js";
import { TOI_SOURCE, TOI_URL, type Toi, type ToiCatalog } from "./sources/exofop.js";
import { checkReveal, commitment, matchReveals, randomSalt, type Reveal } from "./commit.js";
import { crossmatch, RATIOS, toBjd, type Known, type Signal } from "./crossmatch.js";
import { ARCHIVE_SOURCE, ARCHIVE_TAP, planetsByTic, type ArchivePlanet } from "./sources/archive.js";
import { vet, type VetInput } from "./vet.js";
import { coverage, type SectorCoverage } from "./coverage.js";
import { CAOM_SOURCE, caomTimeseries, MAST_INVOKE, TESSCUT_SOURCE, TESSCUT_URL, tesscutSectors, TIC_SOURCE, ticById } from "./sources/mast.js";

/** A tool result: a short summary for people, structured data for code. */
export type Output = { summary: string; data: Record<string, unknown> };

/** Everything the tools share for the life of one server. */
export type Ctx = { deps: Deps; tois: ToiCatalog };

/** Default relative period tolerance for a match (0.2%). */
export const DEFAULT_PERIOD_TOLERANCE = 0.002;

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
  const source = { name: TOI_SOURCE, url: TOI_URL, fetched_at: iso(table.fetchedAt), rows_in_table: table.rows.length, stale: table.stale };
  const label = "tic_id" in query ? `TIC ${query.tic_id}` : `TOI ${query.toi}`;
  const summary = rows.length
    ? `${rows.length} TOI${rows.length > 1 ? "s" : ""} for ${label} (ExoFOP, fetched ${source.fetched_at}):\n${rows.map(toiLine).join("\n")}`
    : `No TOI for ${label} in the ExoFOP TOI table (${table.rows.length} rows, fetched ${source.fetched_at}). That only means no TOI has been issued; it says nothing about whether the star has planets.`;
  return { summary: table.stale ? `${summary}\nWarning: ExoFOP ${table.stale}.` : summary, data: { query, count: rows.length, tois: rows, source } };
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

export type CrossmatchArgs = {
  tic_id: string | number;
  period_days: number;
  epoch: number;
  epoch_format?: "auto" | "bjd" | "btjd";
  duration_hours: number;
  period_tolerance?: number;
};

export function toiToKnown(t: Toi): Known {
  return {
    kind: "toi",
    id: `TOI-${t.toi}`,
    tic_id: t.tic_id,
    period_days: t.period_days,
    period_err_days: t.period_err_days,
    epoch_bjd: t.epoch_bjd,
    epoch_err_days: t.epoch_err_days,
    duration_hours: t.duration_hours,
    disposition: t.tfopwg_disposition ?? t.tess_disposition,
    note: t.comments,
  };
}

export function planetToKnown(p: ArchivePlanet, tic: number): Known {
  return {
    kind: "planet",
    id: p.pl_name,
    tic_id: tic,
    period_days: p.pl_orbper,
    period_err_days: p.pl_orbpererr1,
    // A planet not known to transit (tran_flag 0, e.g. found by radial velocity) has no observed transit
    // time; pl_tranmid is then a predicted conjunction, so only the period is compared.
    epoch_bjd: p.tran_flag === 0 ? null : p.pl_tranmid,
    epoch_err_days: p.tran_flag === 0 ? null : p.pl_tranmiderr1,
    duration_hours: p.pl_trandur,
    disposition: "confirmed",
    note: [p.disc_facility && `discovered by ${p.disc_facility}`, p.disc_year, p.tran_flag === 0 ? "not known to transit, period-only check" : null].filter(Boolean).join(", ") || null,
  };
}

export async function crossmatchSignal(ctx: Ctx, args: CrossmatchArgs, signal?: AbortSignal): Promise<Output> {
  const tic = parseTic(args.tic_id);
  const epoch = toBjd(args.epoch, args.epoch_format ?? "auto");
  if (epoch === null) throw new InputError(`epoch ${args.epoch} is neither BJD_TDB (~2,458,000-2,462,000) nor BTJD (~1,300-5,000); set epoch_format`);
  const tol = args.period_tolerance ?? DEFAULT_PERIOD_TOLERANCE;
  const sig: Signal = { period_days: args.period_days, epoch_bjd: epoch, duration_hours: args.duration_hours };

  const [table, planets] = await Promise.all([ctx.tois.get(signal), planetsByTic(ctx.deps, tic, signal)]);
  const tois = table.rows.filter((r) => r.tic_id === tic).map(toiToKnown);
  const known = [...planets.map((p) => planetToKnown(p, tic)), ...tois];
  const result = crossmatch(sig, known, tol);

  const data = {
    tic_id: tic,
    signal: sig,
    verdict: result.verdict,
    reasons: result.reasons,
    matches: result.matches,
    near_misses: result.near_misses,
    checked: { tois_on_star: tois.length, confirmed_planets_on_star: planets.length },
    settings: { period_tolerance: tol, ratios: RATIOS.map((r) => (r.m === 1 ? `${r.n}` : `${r.n}/${r.m}`)) },
    sources: [
      { name: TOI_SOURCE, url: TOI_URL, fetched_at: iso(table.fetchedAt), stale: table.stale },
      { name: ARCHIVE_SOURCE, url: ARCHIVE_TAP, fetched_at: iso(ctx.deps.now()) },
    ],
  };
  const summary = `Verdict for TIC ${tic}, P=${args.period_days} d: ${result.verdict}\n${result.reasons.map((r) => `- ${r}`).join("\n")}\nChecked ${tois.length} TOI(s) (ExoFOP, fetched ${iso(table.fetchedAt)}) and ${planets.length} confirmed planet(s) (NASA Exoplanet Archive) on the star.${table.stale ? `\nWarning: ExoFOP ${table.stale}.` : ""}`;
  return { summary, data };
}

export function sealedCommit(args: { job_id: string; result_hash: string; wallet: string; salt?: string }): Output {
  const generated = args.salt === undefined;
  const salt = args.salt ?? randomSalt();
  const c = commitment({ ...args, salt });
  const data = { ...c, salt_generated: generated, scheme: "keccak256(abi.encode(bytes32 jobId, bytes32 resultHash, address wallet, bytes32 salt))" };
  const summary = `Commitment ${c.commitment} for job ${c.job_id}, wallet ${c.wallet}.${generated ? ` Salt generated here: ${c.salt}. Keep it secret until the reveal; without it the commitment cannot be opened.` : ""}`;
  return { summary, data };
}

export function verifyReveal(args: { reveals: Reveal[] }): Output {
  const checks = args.reveals.map((r, i) => checkReveal(r, i));
  const outcome = checks.length >= 2 ? matchReveals(checks) : null;
  const lines = checks.map((c) => `reveal ${c.index}: ${c.valid ? "opens its commitment" : `does NOT open its commitment${c.error ? ` (${c.error})` : ` (recomputed ${c.recomputed})`}`}`);
  if (outcome) {
    lines.push(`match: ${outcome.status}${outcome.agreed_result_hash ? `, result ${outcome.agreed_result_hash} agreed by ${outcome.agreeing_wallets.length} wallets` : ""}`);
    lines.push(...outcome.notes);
  }
  return { summary: lines.join("\n"), data: { all_valid: checks.every((c) => c.valid), reveals: checks, match: outcome } };
}

export async function vetSignal(ctx: Ctx, args: { tic_id: string | number } & VetInput, signal?: AbortSignal): Promise<Output> {
  const tic = parseTic(args.tic_id);
  const row = await ticById(ctx.deps, tic, signal);
  if (!row) throw new InputError(`MAST has no TIC entry with ID ${tic}`);
  const star = { radius_rsun: row.rad, mass_msun: row.mass, contamination_ratio: row.contratio };
  const v = vet(args, star);
  const missing = [row.rad === null && "radius", row.mass === null && "mass"].filter(Boolean);
  const lines = [
    `TIC ${tic} (R ${fmt(row.rad)} R_sun, M ${fmt(row.mass)} M_sun from TIC v8.2): Rp/R* ${fmt(v.radius_ratio, 3)}, Rp ≈ ${fmt(v.planet_radius_earth, 3)} R_earth${v.planet_radius_jupiter !== null ? ` (${fmt(v.planet_radius_jupiter, 3)} R_Jup)` : ""}.`,
    v.max_duration_hours !== null ? `Longest central transit at P=${args.period_days} d: ${fmt(v.max_duration_hours, 3)} h (a/R* ${fmt(v.a_over_rstar, 3)}); observed ${args.duration_hours} h = ${fmt(v.duration_ratio, 3)}x.` : `Duration not checked: the TIC has no stellar ${missing.join(" or ")}.`,
    v.flags.length ? `Flags:\n${v.flags.map((f) => `- ${f.code}: ${f.message}`).join("\n")}` : "No flags from these two checks.",
    "Rough screens only; odd/even, secondary eclipse and shape need the light curve and are not run here.",
  ];
  return { summary: lines.join("\n"), data: { tic_id: tic, signal: { period_days: args.period_days, duration_hours: args.duration_hours, depth_ppm: args.depth_ppm }, star, ...v, source: { name: TIC_SOURCE, url: MAST_INVOKE, fetched_at: iso(ctx.deps.now()) } } };
}
