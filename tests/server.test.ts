import { describe, expect, it } from "vitest";

import { connect, testDeps } from "./helpers.js";

const TOOLS = ["star_info", "tess_observations", "toi_lookup"];

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
