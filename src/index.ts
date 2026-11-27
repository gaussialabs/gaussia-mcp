#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { depsFromEnv, SERVER_VERSION } from "./deps.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const deps = depsFromEnv();
  deps.log(`v${SERVER_VERSION} on stdio`);
  await createServer(deps).connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  process.stderr.write(`gaussia-mcp failed to start: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
