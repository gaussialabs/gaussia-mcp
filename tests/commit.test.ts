import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { checkReveal, commitment, matchReveals } from "../src/commit.js";
import { connect, data, testDeps, text } from "./helpers.js";

const VECTORS = JSON.parse(readFileSync(new URL("../vectors/commitment.json", import.meta.url), "utf8")).vectors as {
  name: string;
  job_id: string;
  result_hash: string;
  wallet: string;
  salt: string;
  encoded: string;
  commitment: string;
}[];

const h = (byte: string) => `0x${byte.repeat(32)}`;
const JOB = h("aa");
const reveal = (wallet: string, result: string, salt = h("01"), job = JOB) => {
  const c = commitment({ job_id: job, result_hash: result, wallet, salt });
  return { commitment: c.commitment, job_id: job, result_hash: result, wallet, salt };
};
const A = "0x1000000000000000000000000000000000000001";
const B = "0x2000000000000000000000000000000000000002";
const C = "0x3000000000000000000000000000000000000003";

describe("commitment test vectors (SPEC.md, vectors/commitment.json)", () => {
  it.each(VECTORS.map((v) => [v.name, v] as const))("%s", (_, v) => {
    const c = commitment(v);
    expect(c.encoded).toBe(v.encoded);
    expect(c.commitment).toBe(v.commitment);
  });
  it("binds every field: changing one byte changes the commitment", () => {
    const v = VECTORS[0]!;
    for (const field of ["job_id", "result_hash", "salt"] as const) {
      const changed = { ...v, [field]: `${v[field].slice(0, -1)}0` };
      expect(commitment(changed).commitment, field).not.toBe(v.commitment);
    }
    expect(commitment({ ...v, wallet: "0x3333333333333333333333333333333333333334" }).commitment).not.toBe(v.commitment);
  });
  it("rejects malformed input and bad checksums", () => {
    const v = VECTORS[1]!;
    expect(() => commitment({ ...v, job_id: "0x1234" })).toThrow(/job_id must be 32 bytes/);
    expect(() => commitment({ ...v, wallet: "0x000000000000000000000000000000000000DEad" })).toThrow(/EIP-55 checksum/);
    expect(commitment({ ...v, wallet: v.wallet.toLowerCase() }).commitment).toBe(v.commitment);
  });
});

describe("matching", () => {
  it("verified when two wallets reveal the same result", () => {
    const m = matchReveals([reveal(A, h("bb")), reveal(B, h("bb"), h("02"))].map(checkReveal));
    expect(m).toMatchObject({ status: "verified", agreed_result_hash: h("bb"), outlier_wallets: [] });
  });
  it("mismatch when two wallets disagree, and the third node settles it with an outlier", () => {
    expect(matchReveals([reveal(A, h("bb")), reveal(B, h("cc"))].map(checkReveal)).status).toBe("mismatch");
    const m = matchReveals([reveal(A, h("bb")), reveal(B, h("cc")), reveal(C, h("bb"))].map(checkReveal));
    expect(m.status).toBe("verified");
    expect(m.outlier_wallets).toEqual([B]);
  });
  it("one wallet twice does not count as two nodes", () => {
    expect(matchReveals([reveal(A, h("bb")), reveal(A, h("bb"), h("09"))].map(checkReveal)).status).toBe("incomplete");
  });
  it("ignores a reveal that does not open its commitment", () => {
    const forged = { ...reveal(B, h("cc")), result_hash: h("bb") };
    const checks = [reveal(A, h("bb")), forged].map(checkReveal);
    expect(checks[1]!.valid).toBe(false);
    expect(matchReveals(checks).status).toBe("incomplete");
  });
  it("different jobs are incomplete", () => {
    expect(matchReveals([reveal(A, h("bb")), reveal(B, h("bb"), h("01"), h("ab"))].map(checkReveal)).status).toBe("incomplete");
  });
});

describe("sealed_commit and verify_reveal tools", () => {
  it("sealed_commit reproduces the first vector", async () => {
    const v = VECTORS[0]!;
    const { call } = await connect(testDeps());
    const r = await call("sealed_commit", { job_id: v.job_id, result_hash: v.result_hash, wallet: v.wallet, salt: v.salt });
    expect(data(r).commitment).toBe(v.commitment);
    expect(data(r).salt_generated).toBe(false);
  });
  it("sealed_commit generates a fresh salt when none is given, and the result verifies", async () => {
    const { call } = await connect(testDeps());
    const a = data(await call("sealed_commit", { job_id: JOB, result_hash: h("bb"), wallet: A }));
    const b = data(await call("sealed_commit", { job_id: JOB, result_hash: h("bb"), wallet: A }));
    expect(a.salt_generated).toBe(true);
    expect(a.salt).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a.salt).not.toBe(b.salt);
    const v = await call("verify_reveal", { reveals: [{ commitment: a.commitment, job_id: JOB, result_hash: h("bb"), wallet: A, salt: a.salt }] });
    expect(data(v).all_valid).toBe(true);
    expect(data(v).match).toBeNull();
  });
  it("verify_reveal reports a two-node match", async () => {
    const { call } = await connect(testDeps());
    const r = await call("verify_reveal", { reveals: [reveal(A, h("bb")), reveal(B, h("bb"), h("03"))] });
    expect(data(r).match.status).toBe("verified");
    expect(text(r)).toMatch(/match: verified/);
  });
  it("verify_reveal says which reveal fails", async () => {
    const { call } = await connect(testDeps());
    const bad = { ...reveal(A, h("bb")), salt: h("02") };
    const r = await call("verify_reveal", { reveals: [bad] });
    expect(data(r).all_valid).toBe(false);
    expect(text(r)).toMatch(/reveal 0: does NOT open its commitment/);
  });
});
