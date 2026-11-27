import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { SERVER_VERSION, type Deps } from "./deps.js";
import { createServer } from "./server.js";
import { ToiCatalog } from "./sources/exofop.js";

export type HttpOptions = {
  host: string;
  port: number;
  /** Extra Host header values to accept (e.g. "mcp.example.org"), besides the bind address and localhost. */
  allowedHosts?: string[];
};

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

const rpcError = (message: string) => ({ jsonrpc: "2.0", error: { code: -32000, message }, id: null });

/**
 * Streamable HTTP transport, stateless: POST /mcp, one MCP server per request, all of them sharing one
 * TOI table cache. GET /healthz answers {ok, version}. Requests whose Host header is not the bind address,
 * localhost or an allowed host are refused (DNS-rebinding protection). There is no authentication: keep
 * it on 127.0.0.1 or put it behind a proxy that adds some.
 */
export async function startHttp(deps: Deps, opts: HttpOptions): Promise<Server> {
  const tois = new ToiCatalog(deps);
  let allowed = new Set<string>();

  const server = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? "/").split("?")[0];
    if (!allowed.has((req.headers.host ?? "").toLowerCase())) return json(res, 403, rpcError(`Host ${JSON.stringify(req.headers.host ?? "")} is not allowed`));
    if (path === "/healthz" && req.method === "GET") return json(res, 200, { ok: true, name: "gaussia-mcp", version: SERVER_VERSION });
    if (path !== "/mcp") return json(res, 404, rpcError("not found; the MCP endpoint is POST /mcp"));
    if (req.method !== "POST") return json(res, 405, rpcError("method not allowed: this server is stateless, use POST /mcp"));
    const mcp = createServer(deps, tois);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void mcp.close();
    });
    try {
      await mcp.connect(transport);
      await transport.handleRequest(req, res);
    } catch (e) {
      deps.log(`http request failed: ${e instanceof Error ? e.message : String(e)}`);
      if (!res.headersSent) json(res, 500, rpcError("internal error"));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  const hostPart = opts.host.includes(":") ? `[${opts.host}]` : opts.host;
  allowed = new Set([`${hostPart}:${port}`, `localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`, ...(opts.allowedHosts ?? [])].map((h) => h.toLowerCase()));
  return server;
}
