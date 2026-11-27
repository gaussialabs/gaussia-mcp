import { request } from "node:http";
import type { AddressInfo } from "node:net";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startHttp } from "../src/http-server.js";
import { fakeFetch, testDeps, TOI_ROUTE } from "./helpers.js";

const f = fakeFetch([TOI_ROUTE]);
let server: Awaited<ReturnType<typeof startHttp>>;
let base: string;

beforeAll(async () => {
  server = await startHttp(testDeps({ fetch: f.fetch }), { host: "127.0.0.1", port: 0 });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

async function client() {
  const c = new Client({ name: "http-test", version: "0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  return c;
}

/** A raw request with a chosen Host header (fetch does not allow setting Host). */
function raw(path: string, method: string, host: string): Promise<{ status: number; body: string }> {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const req = request({ host: u.hostname, port: u.port, path, method, headers: { host } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode!, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("Streamable HTTP transport", () => {
  it("lists the tools and answers calls over POST /mcp", async () => {
    const c = await client();
    expect((await c.listTools()).tools.length).toBe(7);
    const r = (await c.callTool({ name: "sealed_commit", arguments: { job_id: `0x${"11".repeat(32)}`, result_hash: `0x${"22".repeat(32)}`, wallet: `0x${"33".repeat(20)}`, salt: `0x${"44".repeat(32)}` } })) as CallToolResult;
    expect((r.structuredContent as { commitment: string }).commitment).toBe("0xe60df2107077d59eb706432a888b7ed8626a905471df0f245646ca6455d8b7e5");
    await c.close();
  });
  it("shares one TOI table across requests", async () => {
    const a = await client();
    const b = await client();
    await a.callTool({ name: "toi_lookup", arguments: { tic_id: 307210830 } });
    await b.callTool({ name: "toi_lookup", arguments: { toi: 700 } });
    expect(f.calls.filter((u) => /exofop/.test(u))).toHaveLength(1);
    await a.close();
    await b.close();
  });
  it("answers /healthz and refuses other paths and methods", async () => {
    const port = new URL(base).port;
    const h = await raw("/healthz", "GET", `127.0.0.1:${port}`);
    expect(h.status).toBe(200);
    expect(JSON.parse(h.body)).toMatchObject({ ok: true, name: "gaussia-mcp" });
    expect((await raw("/mcp", "GET", `localhost:${port}`)).status).toBe(405);
    expect((await raw("/other", "POST", `localhost:${port}`)).status).toBe(404);
  });
  it("refuses a foreign Host header (DNS rebinding)", async () => {
    const r = await raw("/healthz", "GET", "evil.example");
    expect(r.status).toBe(403);
    expect(r.body).toMatch(/not allowed/);
  });
});
