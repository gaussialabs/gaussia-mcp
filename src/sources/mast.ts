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
