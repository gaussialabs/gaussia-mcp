import type { Deps } from "../deps.js";
import { requestJson, SourceError } from "../http.js";

export const ARCHIVE_SOURCE = "NASA Exoplanet Archive (pscomppars)";
export const ARCHIVE_TAP = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync";

/** One row of the Planetary Systems Composite Parameters table. Units: days, BJD, hours, Earth radii, percent. */
export type ArchivePlanet = {
  pl_name: string;
  hostname: string | null;
  tic_id: string | null;
  pl_orbper: number | null;
  pl_orbpererr1: number | null;
  pl_tranmid: number | null;
  pl_tranmiderr1: number | null;
  pl_trandur: number | null;
  pl_rade: number | null;
  pl_trandep: number | null;
  tran_flag: number | null;
  disc_facility: string | null;
  disc_year: number | null;
};

const COLUMNS = "pl_name,hostname,tic_id,pl_orbper,pl_orbpererr1,pl_tranmid,pl_tranmiderr1,pl_trandur,pl_rade,pl_trandep,tran_flag,disc_facility,disc_year";

export function planetsQuery(tic: number): string {
  // tic is a validated integer, so the ADQL string is safe to build.
  return `select ${COLUMNS} from pscomppars where tic_id='TIC ${tic}'`;
}

/** Confirmed planets on a TIC from the archive's TAP service (keyless). */
export async function planetsByTic(deps: Deps, tic: number, signal?: AbortSignal): Promise<ArchivePlanet[]> {
  const url = `${ARCHIVE_TAP}?query=${encodeURIComponent(planetsQuery(tic))}&format=json`;
  const rows = await requestJson<unknown>(deps, url, { source: ARCHIVE_SOURCE, timeoutMs: 60_000, signal });
  if (!Array.isArray(rows)) throw new SourceError(ARCHIVE_SOURCE, "answer is not a list of rows");
  return rows as ArchivePlanet[];
}
