import type { CaomRow, SectorFootprint } from "./sources/mast.js";

export type SectorCoverage = {
  sector: number;
  camera: number | null;
  ccd: number | null;
  /** In a TESScut full-frame image footprint. */
  in_ffi: boolean;
  spoc_2min: boolean;
  spoc_20s: boolean;
  /** HLSP light curves for this sector, as "PROVENANCE cadence", e.g. "QLP 200s". */
  hlsp: string[];
};

/** SPOC single-sector light curves: tess<date>-s<sector>-<16-digit TIC>-<id>-s (2-min) or -a_fast (20-s). Multi-sector DV products are left out. */
const SPOC_SINGLE = /^tess\d+-s(\d{4})-\d{16}-\d{4}-(s|a_fast)$/;

/** Merge the TESScut footprint and the CAOM product list into one row per sector. */
export function coverage(footprint: SectorFootprint[], products: CaomRow[]): { sectors: SectorCoverage[]; multi_sector_hlsp: string[] } {
  const by = new Map<number, SectorCoverage>();
  const at = (s: number) => {
    let row = by.get(s);
    if (!row) {
      row = { sector: s, camera: null, ccd: null, in_ffi: false, spoc_2min: false, spoc_20s: false, hlsp: [] };
      by.set(s, row);
    }
    return row;
  };
  for (const f of footprint) Object.assign(at(f.sector), { camera: f.camera, ccd: f.ccd, in_ffi: true });
  const multi = new Set<string>();
  for (const p of products) {
    if (p.obs_collection === "TESS" && p.provenance_name === "SPOC") {
      const m = SPOC_SINGLE.exec(p.obs_id);
      if (!m) continue;
      const row = at(Number(m[1]));
      if (m[2] === "s") row.spoc_2min = true;
      else row.spoc_20s = true;
    } else if (p.obs_collection === "HLSP") {
      const label = `${p.provenance_name ?? "HLSP"} ${p.t_exptime ?? "?"}s`;
      const s = Number(p.sequence_number);
      if (!Number.isInteger(s) || s <= 0) {
        multi.add(p.provenance_name ?? "HLSP");
        continue;
      }
      const row = at(s);
      if (!row.hlsp.includes(label)) row.hlsp.push(label);
    }
  }
  const sectors = [...by.values()].sort((a, b) => a.sector - b.sector);
  for (const s of sectors) s.hlsp.sort();
  return { sectors, multi_sector_hlsp: [...multi].sort() };
}
