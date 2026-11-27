import { describe, expect, it } from "vitest";

import { connect, testDeps } from "./helpers.js";

const TOOLS = ["crossmatch_signal", "sealed_commit", "star_info", "tess_observations", "toi_lookup", "verify_reveal", "vet_signal"];

describe("server surface", () => {
  it("lists the tools, each read-only with a description and described parameters", async () => {
    const { client } = await connect(testDeps());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS);
    for (const t of tools) {
      expect(t.description!.length).toBeGreaterThan(80);
      expect(t.annotations?.readOnlyHint).toBe(true);
      const props = (t.inputSchema.properties ?? {}) as Record<string, { description?: string }>;
      for (const [name, p] of Object.entries(props)) expect(p.description, `${t.name}.${name}`).toBeTruthy();
    }
  });
  it("tells the model never to substitute data", async () => {
    const { client } = await connect(testDeps());
    expect(client.getInstructions()).toMatch(/never substitute data/);
  });
});

describe("resources and prompts", () => {
  it("serves the spec, the vectors, the cross-match rules and the sources", async () => {
    const { client } = await connect(testDeps());
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual(["gaussia://rules/crossmatch", "gaussia://sources", "gaussia://spec/commitment", "gaussia://vectors/commitment"]);
    const read = async (uri: string) => ((await client.readResource({ uri })).contents[0] as { text: string }).text;
    expect(await read("gaussia://spec/commitment")).toMatch(/keccak256\(abi\.encode\(bytes32 jobId, bytes32 resultHash, address wallet, bytes32 salt\)\)/);
    expect(JSON.parse(await read("gaussia://vectors/commitment")).vectors).toHaveLength(2);
    const rules = await read("gaussia://rules/crossmatch");
    expect(rules).toMatch(/Ratios: 1, 1\/2, 2, 1\/3, 3, 2\/3, 3\/2\. Default tol = 0\.002/);
    expect(rules).toMatch(/no_match is not a discovery/);
    expect(await read("gaussia://sources")).toMatch(/exoplanetarchive\.ipac\.caltech\.edu\/TAP\/sync/);
  });
  it("offers the filter_signal prompt with the signal filled in", async () => {
    const { client } = await connect(testDeps());
    expect((await client.listPrompts()).prompts.map((p) => p.name)).toEqual(["filter_signal"]);
    const p = await client.getPrompt({ name: "filter_signal", arguments: { tic_id: "307210830", period_days: "5.4321", epoch: "2459500.123", duration_hours: "1.5", depth_ppm: "800" } });
    const body = (p.messages[0]!.content as { text: string }).text;
    expect(body).toMatch(/TIC 307210830, period 5\.4321 d/);
    expect(body).toMatch(/Call crossmatch_signal/);
    expect(body).toMatch(/never a planet/);
  });
});
