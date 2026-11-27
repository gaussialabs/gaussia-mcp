/**
 * Cross-matching a transit signal against known objects on the same star: period aliases up to
 * n/m with n, m <= 3 and an epoch (transit time) check. Pure functions, no I/O.
 */

export const BTJD_OFFSET = 2_457_000;

/** A transit signal to check. Epoch in BJD_TDB. */
export type Signal = { period_days: number; epoch_bjd: number; duration_hours: number };

/** A known object: a TOI from ExoFOP or a planet from the NASA Exoplanet Archive. */
export type Known = {
  kind: "toi" | "planet";
  /** "TOI-175.01" or "L 98-59 c". */
  id: string;
  tic_id: number;
  period_days: number | null;
  period_err_days: number | null;
  epoch_bjd: number | null;
  epoch_err_days: number | null;
  duration_hours: number | null;
  /** TFOPWG/TESS disposition for TOIs, "confirmed" for archive planets. */
  disposition: string | null;
  /** Free text such as ExoFOP comments ("L 98-59 c; TOI 175.01"). */
  note: string | null;
};

export type Ratio = { n: number; m: number };

/** Candidate period = known period * n/m, for n, m in 1..3 with gcd 1: 1, 1/2, 2, 1/3, 3, 2/3, 3/2. */
export const RATIOS: Ratio[] = [
  { n: 1, m: 1 },
  { n: 1, m: 2 },
  { n: 2, m: 1 },
  { n: 1, m: 3 },
  { n: 3, m: 1 },
  { n: 2, m: 3 },
  { n: 3, m: 2 },
];

export type PeriodMatch = { ratio: Ratio; expected_days: number; diff_days: number; rel_diff: number; allowed_days: number };

/**
 * Does the signal's period sit at known * n/m? Allowed difference: the larger of `relTol` times the
 * expected period and three times the known period's error scaled by n/m. Returns the closest ratio.
 */
export function periodMatch(period: number, known: number, knownErr: number | null, relTol: number): PeriodMatch | null {
  let best: PeriodMatch | null = null;
  for (const ratio of RATIOS) {
    const expected = (known * ratio.n) / ratio.m;
    const allowed = Math.max(relTol * expected, 3 * Math.abs(knownErr ?? 0) * (ratio.n / ratio.m));
    const diff = period - expected;
    if (Math.abs(diff) > allowed) continue;
    const rel = Math.abs(diff) / expected;
    if (!best || rel < best.rel_diff) best = { ratio, expected_days: expected, diff_days: diff, rel_diff: rel, allowed_days: allowed };
  }
  return best;
}

export type EpochCheck = {
  /** Signed time from the signal's epoch to the nearest predicted coincident transit, in hours. */
  offset_hours: number;
  /** Allowed offset: half the longer transit duration, or 3 sigma of the propagated known ephemeris if larger. */
  window_hours: number;
  /** Orbits of the known object between its epoch and the signal's epoch. */
  cycles: number;
  /** Propagated 1-sigma uncertainty of the known ephemeris at the signal's epoch, in hours (0 when errors are not given). */
  sigma_hours: number;
  /** Phase of the signal's epoch on the known orbit, 0..1 (0 = at transit). */
  phase: number;
  aligned: boolean;
};

/**
 * With candidate period = known * n/m, the two sets of transit times coincide only if
 * (T0 - Tk) is a multiple of known/m (gcd(n, m) = 1). The offset is measured to the nearest such time.
 */
export function epochCheck(signal: Signal, known: Known, ratio: Ratio): EpochCheck | null {
  if (known.epoch_bjd === null || known.period_days === null) return null;
  const pk = known.period_days;
  const grid = pk / ratio.m;
  const delta = signal.epoch_bjd - known.epoch_bjd;
  const offset = delta - Math.round(delta / grid) * grid;
  const cycles = Math.abs(delta) / pk;
  const sigma = Math.hypot(known.epoch_err_days ?? 0, cycles * (known.period_err_days ?? 0));
  const halfDur = Math.max(signal.duration_hours, known.duration_hours ?? 0) / 2 / 24;
  const window = Math.max(halfDur, 3 * sigma);
  const phase = (((delta % pk) + pk) % pk) / pk;
  return { offset_hours: offset * 24, window_hours: window * 24, cycles, sigma_hours: sigma * 24, phase, aligned: Math.abs(offset) <= window };
}

/** Is the signal at phase 0.5 of the known orbit (same period)? A secondary eclipse would be. */
export function atHalfPhase(signal: Signal, known: Known, window_hours: number): boolean {
  if (known.epoch_bjd === null || known.period_days === null) return false;
  const pk = known.period_days;
  const delta = signal.epoch_bjd - known.epoch_bjd - pk / 2;
  const off = delta - Math.round(delta / pk) * pk;
  return Math.abs(off) * 24 <= window_hours;
}

export type MatchKind = "period_and_epoch" | "period_no_epoch" | "secondary_eclipse";

export type Match = {
  known: Known;
  kind: MatchKind;
  ratio: string;
  alias: boolean;
  period: PeriodMatch;
  epoch: EpochCheck | null;
  reason: string;
};

export type NearMiss = { known: Known; ratio: string; period: PeriodMatch; epoch: EpochCheck; reason: string };

export type Verdict = "known_toi" | "known_planet" | "alias_of_known" | "no_match";

export type CrossmatchResult = { verdict: Verdict; reasons: string[]; matches: Match[]; near_misses: NearMiss[] };

const ratioLabel = (r: Ratio) => (r.m === 1 ? `${r.n}x` : `${r.n}/${r.m}x`);
const f = (x: number, d = 3) => Number(x.toFixed(d)).toString();
const name = (k: Known) => `${k.id}${k.disposition ? ` (${k.disposition})` : ""}`;

/**
 * Match one signal against known objects. A match needs the period at known * n/m and, when the known
 * object has an epoch, transit times that line up. Verdict, strongest first:
 *  known_planet   - same period (1x) and aligned epoch as an archive planet
 *  known_toi      - same period (1x) and aligned epoch as a TOI
 *  alias_of_known - an n/m alias with aligned epoch, a same-period signal at phase 0.5 (secondary eclipse),
 *                   or a period match to an object without a published epoch
 *  no_match       - none of the above. Not proof of a new planet: it only means these catalogs have nothing there.
 */
export function crossmatch(signal: Signal, known: Known[], relTol: number): CrossmatchResult {
  const matches: Match[] = [];
  const near: NearMiss[] = [];
  for (const k of known) {
    if (k.period_days === null || !(k.period_days > 0)) continue;
    const pm = periodMatch(signal.period_days, k.period_days, k.period_err_days, relTol);
    if (!pm) continue;
    const label = ratioLabel(pm.ratio);
    const alias = !(pm.ratio.n === 1 && pm.ratio.m === 1);
    const ep = epochCheck(signal, k, pm.ratio);
    const per = `period ${f(signal.period_days, 6)} d = ${label} ${name(k)}'s ${f(k.period_days, 6)} d (diff ${Number((pm.rel_diff * 100).toPrecision(2))}%)`;
    if (!ep) {
      matches.push({ known: k, kind: "period_no_epoch", ratio: label, alias: true, period: pm, epoch: null, reason: `${per}; ${k.id} has no published transit epoch, so transit times could not be compared` });
    } else if (ep.aligned) {
      matches.push({ known: k, kind: "period_and_epoch", ratio: label, alias, period: pm, epoch: ep, reason: `${per}, and transit times line up (offset ${f(ep.offset_hours, 2)} h, window ±${f(ep.window_hours, 2)} h over ${f(ep.cycles, 1)} orbits)` });
    } else if (!alias && atHalfPhase(signal, k, ep.window_hours)) {
      matches.push({ known: k, kind: "secondary_eclipse", ratio: label, alias: true, period: pm, epoch: ep, reason: `${per}, at phase 0.5 of ${k.id}: likely its secondary eclipse, so the system is probably an eclipsing binary or the signal is the same object` });
    } else {
      near.push({ known: k, ratio: label, period: pm, epoch: ep, reason: `${per}, but transit times do not line up (offset ${f(ep.offset_hours, 2)} h, window ±${f(ep.window_hours, 2)} h, phase ${f(ep.phase, 3)})` });
    }
  }
  const direct = matches.filter((m) => m.kind === "period_and_epoch" && !m.alias);
  let verdict: Verdict;
  if (direct.some((m) => m.known.kind === "planet")) verdict = "known_planet";
  else if (direct.some((m) => m.known.kind === "toi")) verdict = "known_toi";
  else if (matches.length) verdict = "alias_of_known";
  else verdict = "no_match";
  const order = (m: Match) => (m.kind === "period_and_epoch" && !m.alias ? 0 : 1) + (m.known.kind === "planet" ? 0 : 0.5);
  matches.sort((a, b) => order(a) - order(b) || a.period.rel_diff - b.period.rel_diff);
  const reasons = matches.map((m) => m.reason);
  if (verdict === "no_match") {
    reasons.push(`No period within the tolerance of ${known.filter((k) => k.period_days).length} known objects at ratios 1, 1/2, 2, 1/3, 3, 2/3, 3/2${near.length ? ` with aligned transit times (${near.length} period-only near miss${near.length > 1 ? "es" : ""} listed)` : ""}.`);
  }
  return { verdict, reasons, matches, near_misses: near };
}

/** Accept BJD_TDB or BTJD (BJD - 2457000). "auto" decides by size; null when it cannot. */
export function toBjd(epoch: number, format: "auto" | "bjd" | "btjd"): number | null {
  if (format === "bjd") return epoch;
  if (format === "btjd") return epoch + BTJD_OFFSET;
  if (epoch > 2_400_000) return epoch;
  if (epoch > 0 && epoch < 100_000) return epoch + BTJD_OFFSET;
  return null;
}
