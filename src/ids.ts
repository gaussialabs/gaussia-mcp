import { InputError } from "./http.js";

/** "307210830", "TIC 307210830", "TIC-307210830", "tic307210830" or a number -> 307210830. */
export function parseTic(input: string | number): number {
  const s = String(input).trim();
  const m = /^(?:tic[\s_-]*)?0*(\d{1,11})$/i.exec(s);
  if (!m) throw new InputError(`not a TIC ID: ${JSON.stringify(s)} (expected digits, e.g. 307210830 or "TIC 307210830")`);
  const n = Number(m[1]);
  if (!Number.isSafeInteger(n) || n <= 0) throw new InputError(`not a TIC ID: ${JSON.stringify(s)}`);
  return n;
}

/** "175", "TOI-175", "TOI 175.01", 175.01 -> { star: 175, planet: "01" | null }. */
export function parseToi(input: string | number): { star: number; planet: string | null } {
  const s = String(input).trim();
  const m = /^(?:toi[\s_-]*)?(\d{1,6})(?:\.(\d{1,2}))?$/i.exec(s);
  if (!m) throw new InputError(`not a TOI number: ${JSON.stringify(s)} (expected e.g. 175, 175.01 or "TOI-700")`);
  return { star: Number(m[1]), planet: m[2] ? m[2].padEnd(2, "0") : null };
}
