/**
 * Two quick physical sanity checks on a transit signal, from the host star's TIC radius and mass.
 * They are rough screens, not a vetting pipeline: no light curve is read, so odd/even depths,
 * secondary eclipses and transit shape are not tested here.
 */

const GM_SUN = 1.32712440018e20; // m^3 s^-2 (IAU)
const R_SUN = 6.957e8; // m (IAU nominal)
const R_EARTH = 6.3781e6; // m (equatorial, IAU nominal)
const R_JUP = 7.1492e7; // m (equatorial, IAU nominal)
const DAY = 86_400;

export type VetInput = { period_days: number; duration_hours: number; depth_ppm: number };
export type Star = { radius_rsun: number | null; mass_msun: number | null; contamination_ratio: number | null };

export type Flag = { code: string; message: string };

export type VetResult = {
  radius_ratio: number;
  planet_radius_earth: number | null;
  planet_radius_jupiter: number | null;
  /** With the TIC contamination ratio removed from the depth: depth * (1 + contratio). */
  planet_radius_earth_decontaminated: number | null;
  a_over_rstar: number | null;
  /** Longest transit for a circular orbit at impact parameter 0, in hours. */
  max_duration_hours: number | null;
  duration_ratio: number | null;
  flags: Flag[];
  assumptions: string[];
};

/** Rp/R* = sqrt(depth): no limb darkening, no dilution beyond the TIC contamination ratio. */
export function radiusRatio(depthPpm: number): number {
  return Math.sqrt(depthPpm / 1e6);
}

/** Kepler's third law: a/R* for a star of mass M (solar) and radius R (solar) at period P (days). */
export function aOverRstar(periodDays: number, massMsun: number, radiusRsun: number): number {
  const p = periodDays * DAY;
  const a = Math.cbrt((GM_SUN * massMsun * p * p) / (4 * Math.PI * Math.PI));
  return a / (radiusRsun * R_SUN);
}

/** T14 for b = 0, circular orbit: (P / pi) * asin((1 + k) / (a/R*)), in hours. */
export function maxDurationHours(periodDays: number, aR: number, k: number): number {
  const x = Math.min(1, (1 + k) / aR);
  return ((periodDays * 24) / Math.PI) * Math.asin(x);
}

export function vet(input: VetInput, star: Star): VetResult {
  const flags: Flag[] = [];
  const k = radiusRatio(input.depth_ppm);
  const r = star.radius_rsun;
  const m = star.mass_msun;
  const toEarth = (ratio: number) => (r === null ? null : (ratio * r * R_SUN) / R_EARTH);
  const rpEarth = toEarth(k);
  const rpJup = r === null ? null : (k * r * R_SUN) / R_JUP;
  const c = star.contamination_ratio;
  const rpDecont = c !== null && c > 0 ? toEarth(radiusRatio(input.depth_ppm * (1 + c))) : rpEarth;

  if (k >= 0.5) flags.push({ code: "deep_eclipse", message: `depth ${input.depth_ppm} ppm means Rp/R* = ${k.toFixed(2)}: an object half the star's size or more is almost always a stellar companion (eclipsing binary)` });
  if (rpJup !== null && rpJup > 2) flags.push({ code: "too_large_for_planet", message: `implied radius ${rpJup.toFixed(2)} R_Jup is larger than any known planet (about 2 R_Jup): likely an eclipsing binary, or the signal comes from another star` });
  if (c !== null && c > 0.5) flags.push({ code: "crowded", message: `TIC contamination ratio ${c.toFixed(2)}: much of the flux in the aperture is from other stars, so the dip may come from a neighbour` });

  let aR: number | null = null;
  let tMax: number | null = null;
  let ratio: number | null = null;
  if (r !== null && m !== null && r > 0 && m > 0) {
    aR = aOverRstar(input.period_days, m, r);
    tMax = maxDurationHours(input.period_days, aR, k);
    ratio = input.duration_hours / tMax;
    if (aR <= 1 + k) flags.push({ code: "inside_star", message: `a/R* = ${aR.toFixed(2)}: an orbit this short would be inside the star; the period or the stellar parameters are wrong` });
    else if (ratio > 1.5) flags.push({ code: "too_long", message: `duration ${input.duration_hours} h is ${ratio.toFixed(2)}x the longest central transit (${tMax.toFixed(2)} h) for this star: possible blend on a larger star, wrong stellar parameters, a wrong period, or an eccentric orbit` });
    else if (ratio < 0.15) flags.push({ code: "very_short", message: `duration ${input.duration_hours} h is ${ratio.toFixed(2)}x the longest central transit (${tMax.toFixed(2)} h): only a very grazing transit is this short; check the period (an alias?) and the shape` });
  }
  const assumptions = [
    "Rp/R* = sqrt(depth): no limb darkening, so the radius is a rough estimate.",
    "Maximum duration assumes a circular orbit, impact parameter 0 and a massless planet.",
    "Star radius and mass are the TIC v8.2 catalog values, not a fit.",
    "Not tested here (they need the light curve): odd/even depths, secondary eclipse, transit shape, centroid shifts.",
  ];
  return {
    radius_ratio: k,
    planet_radius_earth: rpEarth,
    planet_radius_jupiter: rpJup,
    planet_radius_earth_decontaminated: rpDecont,
    a_over_rstar: aR,
    max_duration_hours: tMax,
    duration_ratio: ratio,
    flags,
    assumptions,
  };
}
