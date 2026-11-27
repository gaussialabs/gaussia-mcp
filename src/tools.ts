import type { Deps } from "./deps.js";
import { InputError } from "./http.js";
import { parseTic, parseToi } from "./ids.js";
import { TOI_SOURCE, TOI_URL, type Toi, type ToiCatalog } from "./sources/exofop.js";

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
