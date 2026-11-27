#!/usr/bin/env node
import { parseArgs } from "node:util";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { depsFromEnv, SERVER_VERSION } from "./deps.js";
import { startHttp } from "./http-server.js";
import { createServer } from "./server.js";

const USAGE = `gaussia-mcp ${SERVER_VERSION}
Usage:
  gaussia-mcp                     MCP over stdio (what MCP clients start)
  gaussia-mcp --http [--port 3333] [--host 127.0.0.1] [--allow-host name]
                                  MCP over Streamable HTTP at POST /mcp (stateless, no auth)
Environment: GAUSSIA_TOI_TTL_HOURS, GAUSSIA_RETRIES`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      http: { type: "boolean" },
      port: { type: "string" },
      host: { type: "string" },
      "allow-host": { type: "string", multiple: true },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  if (values.help) return void process.stdout.write(`${USAGE}\n`);
  if (values.version) return void process.stdout.write(`${SERVER_VERSION}\n`);
  const deps = depsFromEnv();
  if (values.http) {
    const host = values.host ?? "127.0.0.1";
    const port = Number(values.port ?? 3333);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`--port must be 0-65535, got ${values.port}`);
    const server = await startHttp(deps, { host, port, allowedHosts: values["allow-host"] });
    const addr = server.address();
    const bound = typeof addr === "object" && addr ? addr.port : port;
    deps.log(`v${SERVER_VERSION} on http://${host.includes(":") ? `[${host}]` : host}:${bound}/mcp${host === "127.0.0.1" || host === "::1" || host === "localhost" ? "" : " (not loopback: there is no authentication)"}`);
    return;
  }
  deps.log(`v${SERVER_VERSION} on stdio`);
  await createServer(deps).connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  process.stderr.write(`gaussia-mcp failed to start: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
