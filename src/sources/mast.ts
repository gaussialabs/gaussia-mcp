import type { Deps } from "../deps.js";
import { requestJson, SourceError } from "../http.js";

export const MAST_INVOKE = "https://mast.stsci.edu/api/v0/invoke";
export const TIC_SOURCE = "MAST TIC catalog";

type MastResponse<T> = { status?: string; msg?: string; data?: T[] };

/** One call to the MAST Portal API (keyless). Returns the data rows or throws a SourceError naming `source`. */
export async function mastInvoke<T>(deps: Deps, source: string, request: Record<string, unknown>, signal?: AbortSignal, timeoutMs = 45_000): Promise<T[]> {
  const res = await requestJson<MastResponse<T>>(deps, MAST_INVOKE, {
    source,
    method: "POST",
    body: `request=${encodeURIComponent(JSON.stringify({ format: "json", ...request }))}`,
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    timeoutMs,
    signal,
  });
  if (res.status !== "COMPLETE" || !Array.isArray(res.data)) {
    throw new SourceError(source, `MAST answered status ${JSON.stringify(res.status ?? null)}${res.msg ? ` (${res.msg})` : ""}`);
  }
  return res.data;
}

/** The TIC v8.2 fields this server reports. Units: Teff K, rad/mass solar, rho solar, d pc, ra/dec deg. */
export type TicRow = {
  ID: number;
  version: string | null;
  objType: string | null;
  ra: number | null;
  dec: number | null;
  Tmag: number | null;
  e_Tmag: number | null;
  Vmag: number | null;
  Teff: number | null;
  e_Teff: number | null;
  logg: number | null;
  e_logg: number | null;
  rad: number | null;
  e_rad: number | null;
  mass: number | null;
  e_mass: number | null;
  rho: number | null;
  e_rho: number | null;
  lum: number | null;
  lumclass: string | null;
  d: number | null;
  e_d: number | null;
  plx: number | null;
  contratio: number | null;
  numcont: number | null;
  disposition: string | null;
  duplicate_id: string | number | null;
  GAIA: string | null;
  TWOMASS: string | null;
  HIP: number | null;
};

/** One star from the TIC by ID, or null when MAST has no such TIC. */
export async function ticById(deps: Deps, tic: number, signal?: AbortSignal): Promise<TicRow | null> {
  const rows = await mastInvoke<TicRow>(
    deps,
    TIC_SOURCE,
    { service: "Mast.Catalogs.Filtered.Tic", params: { columns: "*", filters: [{ paramName: "ID", values: [String(tic)] }] } },
    signal,
  );
  return rows.find((r) => Number(r.ID) === tic) ?? null;
}

export const CAOM_SOURCE = "MAST CAOM observations";
export const TESSCUT_SOURCE = "MAST TESScut sector lookup";
export const TESSCUT_URL = "https://mast.stsci.edu/tesscut/api/v0.1/sector";

export type CaomRow = {
  obs_collection: string;
  provenance_name: string | null;
  target_name: string;
  sequence_number: number | null;
  t_exptime: number | null;
  obs_id: string;
};

/** Every TESS time-series product MAST lists for a TIC: SPOC (2-min, 20-s) and HLSP light curves (QLP, TESS-SPOC, ...). */
export async function caomTimeseries(deps: Deps, tic: number, signal?: AbortSignal): Promise<CaomRow[]> {
  return mastInvoke<CaomRow>(
    deps,
    CAOM_SOURCE,
    {
      service: "Mast.Caom.Filtered",
      pagesize: 5000,
      page: 1,
      params: {
        columns: "obs_collection,provenance_name,target_name,sequence_number,t_exptime,dataproduct_type,obs_id",
        filters: [
          { paramName: "obs_collection", values: ["TESS", "HLSP"] },
          { paramName: "target_name", values: [String(tic)] },
          { paramName: "dataproduct_type", values: ["timeseries"] },
        ],
      },
    },
    signal,
  );
}

export type SectorFootprint = { sector: number; camera: number; ccd: number };

/** Sectors whose full-frame images cover a position (TESScut, keyless). */
export async function tesscutSectors(deps: Deps, ra: number, dec: number, signal?: AbortSignal): Promise<SectorFootprint[]> {
  const url = `${TESSCUT_URL}?ra=${ra}&dec=${dec}&radius=0m`;
  const res = await requestJson<{ results?: { sector: string; camera: string; ccd: string }[] }>(deps, url, { source: TESSCUT_SOURCE, timeoutMs: 45_000, signal });
  if (!Array.isArray(res.results)) throw new SourceError(TESSCUT_SOURCE, "answer has no results list");
  return res.results.map((r) => ({ sector: Number(r.sector), camera: Number(r.camera), ccd: Number(r.ccd) })).filter((r) => Number.isInteger(r.sector));
}
