import { encodeAbiParameters, getAddress, isAddress, keccak256, type Hex } from "viem";

import { InputError } from "./http.js";

/** commitment = keccak256(abi.encode(bytes32 jobId, bytes32 resultHash, address wallet, bytes32 salt)). See SPEC.md. */
const PARAMS = [
  { name: "jobId", type: "bytes32" },
  { name: "resultHash", type: "bytes32" },
  { name: "wallet", type: "address" },
  { name: "salt", type: "bytes32" },
] as const;

export function bytes32(value: string, field: string): Hex {
  const v = value.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(v)) throw new InputError(`${field} must be 32 bytes as 0x followed by 64 hex characters`);
  return v.toLowerCase() as Hex;
}

export function wallet(value: string): Hex {
  const v = value.trim();
  // Strict: a mixed-case address must carry a valid EIP-55 checksum, so a typo is caught.
  if (!isAddress(v, { strict: true })) throw new InputError(`wallet ${JSON.stringify(v)} is not a valid address (or its EIP-55 checksum is wrong)`);
  return getAddress(v);
}

export type CommitInput = { job_id: string; result_hash: string; wallet: string; salt: string };

export function commitment(input: CommitInput): { commitment: Hex; encoded: Hex; job_id: Hex; result_hash: Hex; wallet: Hex; salt: Hex } {
  const job_id = bytes32(input.job_id, "job_id");
  const result_hash = bytes32(input.result_hash, "result_hash");
  const w = wallet(input.wallet);
  const salt = bytes32(input.salt, "salt");
  const encoded = encodeAbiParameters(PARAMS, [job_id, result_hash, w, salt]);
  return { commitment: keccak256(encoded), encoded, job_id, result_hash, wallet: w, salt };
}

export function randomSalt(): Hex {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Buffer.from(b).toString("hex")}` as Hex;
}

export type Reveal = CommitInput & { commitment: string };

export type RevealCheck = { index: number; valid: boolean; expected: Hex; recomputed: Hex | null; wallet: Hex | null; job_id: Hex | null; result_hash: Hex | null; error: string | null };

export function checkReveal(r: Reveal, index: number): RevealCheck {
  const expected = bytes32(r.commitment, `reveals[${index}].commitment`);
  try {
    const c = commitment(r);
    return { index, valid: c.commitment === expected, expected, recomputed: c.commitment, wallet: c.wallet, job_id: c.job_id, result_hash: c.result_hash, error: null };
  } catch (e) {
    return { index, valid: false, expected, recomputed: null, wallet: null, job_id: null, result_hash: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export type MatchOutcome = {
  /** "verified" (two or more distinct wallets revealed the same result for one job), "mismatch", or "incomplete". */
  status: "verified" | "mismatch" | "incomplete";
  agreed_result_hash: Hex | null;
  agreeing_wallets: Hex[];
  outlier_wallets: Hex[];
  notes: string[];
};

/** Two-node blind matching (third node on a tie): the result two or more distinct wallets agree on, and who is out. */
export function matchReveals(checks: RevealCheck[]): MatchOutcome {
  const notes: string[] = [];
  const valid = checks.filter((c) => c.valid);
  for (const c of checks) if (!c.valid) notes.push(`reveal ${c.index}: ${c.error ?? "does not open its commitment"}; ignored`);
  const jobs = new Set(valid.map((c) => c.job_id));
  if (jobs.size > 1) return { status: "incomplete", agreed_result_hash: null, agreeing_wallets: [], outlier_wallets: [], notes: [...notes, "the valid reveals are for different job IDs"] };
  const wallets = new Set(valid.map((c) => c.wallet));
  if (wallets.size < valid.length) notes.push("the same wallet revealed more than once; it counts once");
  const byResult = new Map<Hex, Set<Hex>>();
  for (const c of valid) {
    const set = byResult.get(c.result_hash!) ?? new Set<Hex>();
    set.add(c.wallet!);
    byResult.set(c.result_hash!, set);
  }
  if (wallets.size < 2) return { status: "incomplete", agreed_result_hash: null, agreeing_wallets: [], outlier_wallets: [], notes: [...notes, "fewer than two distinct wallets with valid reveals"] };
  const ranked = [...byResult.entries()].sort((a, b) => b[1].size - a[1].size);
  const [topHash, topWallets] = ranked[0]!;
  if (topWallets.size >= 2 && (ranked.length === 1 || ranked[1]![1].size < topWallets.size)) {
    const outliers = ranked.slice(1).flatMap(([, w]) => [...w]).filter((w) => !topWallets.has(w));
    if (outliers.length) notes.push(`${outliers.length} wallet(s) revealed a different result: flag as outlier`);
    return { status: "verified", agreed_result_hash: topHash, agreeing_wallets: [...topWallets], outlier_wallets: outliers, notes };
  }
  return { status: "mismatch", agreed_result_hash: null, agreeing_wallets: [], outlier_wallets: [], notes: [...notes, "no result is shared by more wallets than any other: send the job to a third node"] };
}
