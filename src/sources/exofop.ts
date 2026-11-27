import { parseCsv } from "../csv.js";
import type { Deps } from "../deps.js";
import { requestText, SourceError } from "../http.js";

export const TOI_SOURCE = "ExoFOP TOI table";
export const TOI_URL = "https://exofop.ipac.caltech.edu/tess/download_toi.php?sort=toi&output=csv";

/** One row of the ExoFOP TOI table, values as ExoFOP gives them (units in the names). Empty cells are null. */
export type Toi = {
  toi: string;
  tic_id: number;
  tess_disposition: string | null;
  tfopwg_disposition: string | null;
  planet_name: string | null;
  period_days: number | null;
  period_err_days: number | null;
  epoch_bjd: number | null;
  epoch_err_days: number | null;
  duration_hours: number | null;
  duration_err_hours: number | null;
  depth_ppm: number | null;
  depth_err_ppm: number | null;
  planet_radius_earth: number | null;
  planet_radius_err_earth: number | null;
  planet_snr: number | null;
  tess_mag: number | null;
  ra: string | null;
  dec: string | null;
  ra_deg: number | null;
  dec_deg: number | null;
  detection: string | null;
  sectors: number[];
  date_alerted: string | null;
  date_updated: string | null;
  comments: string | null;
};

export type ToiTable = {
  rows: Toi[];
  fetchedAt: number;
  /** Set when a refresh failed and the previous download is served instead; says why. */
  stale: string | null;
};

const COLUMNS = {
  tic: "TIC ID",
  toi: "TOI",
  tessDisp: "TESS Disposition",
  tfopwg: "TFOPWG Disposition",
  name: "Planet Name",
  period: "Period (days)",
  periodErr: "Period (days) err",
  epoch: "Epoch (BJD)",
  epochErr: "Epoch (BJD) err",
  duration: "Duration (hours)",
  durationErr: "Duration (hours) err",
  depth: "Depth (ppm)",
  depthErr: "Depth (ppm) err",
  radius: "Planet Radius (R_Earth)",
  radiusErr: "Planet Radius (R_Earth) err",
  snr: "Planet SNR",
  tmag: "TESS Mag",
  ra: "RA",
  dec: "Dec",
  detection: "Detection",
  sectors: "Sectors",
  alerted: "Date TOI Alerted (UTC)",
  updated: "Date TOI Updated (UTC)",
  comments: "Comments",
} as const;

const num = (s: string | undefined): number | null => {
  if (s === undefined) return null;
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const str = (s: string | undefined): string | null => (s === undefined || s.trim() === "" ? null : s.trim());

/** "08:18:07.89" (hours) or "-68:18:52.08" (degrees) to decimal degrees. */
export function sexagesimal(s: string | null, hours: boolean): number | null {
  if (!s) return null;
  const m = /^([+-]?)(\d+):(\d+):(\d+(?:\.\d*)?)$/.exec(s.trim());
  if (!m) return null;
  const v = Number(m[2]) + Number(m[3]) / 60 + Number(m[4]) / 3600;
  return (m[1] === "-" ? -v : v) * (hours ? 15 : 1);
}

/** Parse the CSV ExoFOP serves. Throws a SourceError if the columns this server reads are missing. */
export function parseToiCsv(text: string): Toi[] {
  const table = parseCsv(text);
  const header = table[0];
  if (!header) throw new SourceError(TOI_SOURCE, "empty response");
  const idx = {} as Record<keyof typeof COLUMNS, number>;
  for (const [key, name] of Object.entries(COLUMNS) as [keyof typeof COLUMNS, string][]) {
    const i = header.indexOf(name);
    if (i < 0) throw new SourceError(TOI_SOURCE, `the table no longer has a "${name}" column; this server needs an update`);
    idx[key] = i;
  }
  const rows: Toi[] = [];
  for (const r of table.slice(1)) {
    const tic = num(r[idx.tic]);
    const toi = str(r[idx.toi]);
    if (tic === null || toi === null) continue;
    const ra = str(r[idx.ra]);
    const dec = str(r[idx.dec]);
    rows.push({
      toi,
      tic_id: tic,
      tess_disposition: str(r[idx.tessDisp]),
      tfopwg_disposition: str(r[idx.tfopwg]),
      planet_name: str(r[idx.name]),
      period_days: num(r[idx.period]),
      period_err_days: num(r[idx.periodErr]),
      epoch_bjd: num(r[idx.epoch]),
      epoch_err_days: num(r[idx.epochErr]),
      duration_hours: num(r[idx.duration]),
      duration_err_hours: num(r[idx.durationErr]),
      depth_ppm: num(r[idx.depth]),
      depth_err_ppm: num(r[idx.depthErr]),
      planet_radius_earth: num(r[idx.radius]),
      planet_radius_err_earth: num(r[idx.radiusErr]),
      planet_snr: num(r[idx.snr]),
      tess_mag: num(r[idx.tmag]),
      ra,
      dec,
      ra_deg: sexagesimal(ra, true),
      dec_deg: sexagesimal(dec, false),
      detection: str(r[idx.detection]),
      sectors: (str(r[idx.sectors]) ?? "")
        .split(",")
        .map((x) => Number(x.trim()))
        .filter((x) => Number.isInteger(x) && x > 0),
      date_alerted: str(r[idx.alerted]),
      date_updated: str(r[idx.updated]),
      comments: str(r[idx.comments]),
    });
  }
  if (rows.length === 0) throw new SourceError(TOI_SOURCE, "the table came back with no TOI rows");
  return rows;
}

/** A previous download older than this is never served, even when a refresh fails. */
export const MAX_STALE_MS = 7 * 24 * 3_600_000;

/**
 * The TOI table (~4 MB, ~8,000 rows; ExoFOP takes 10-30 s to serve it), kept in memory and fetched
 * again once it is older than `deps.toiTtlMs`. Concurrent calls share one download. If a refresh
 * fails, the previous download (up to 7 days old) is served with `stale` saying so; otherwise the
 * error is thrown.
 */
export class ToiCatalog {
  private table: ToiTable | null = null;
  private inflight: Promise<ToiTable> | null = null;

  constructor(private readonly deps: Deps) {}

  async get(signal?: AbortSignal): Promise<ToiTable> {
    const now = this.deps.now();
    if (this.table && now - this.table.fetchedAt < this.deps.toiTtlMs) return this.table;
    this.inflight ??= this.refresh(signal).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async refresh(signal?: AbortSignal): Promise<ToiTable> {
    try {
      const text = await requestText(this.deps, TOI_URL, { source: TOI_SOURCE, timeoutMs: 90_000, signal });
      const table = { rows: parseToiCsv(text), fetchedAt: this.deps.now(), stale: null };
      this.deps.log(`${TOI_SOURCE}: ${table.rows.length} rows loaded`);
      this.table = table;
      return table;
    } catch (e) {
      const prev = this.table;
      if (prev && this.deps.now() - prev.fetchedAt < MAX_STALE_MS) {
        const why = `refresh failed (${e instanceof Error ? e.message : String(e)}); serving the copy downloaded ${new Date(prev.fetchedAt).toISOString()}`;
        this.deps.log(`${TOI_SOURCE}: ${why}`);
        return { ...prev, stale: why };
      }
      throw e;
    }
  }
}
