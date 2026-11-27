// Starts the built server over stdio like an MCP client would and calls every tool against the live
// public sources. The README's example outputs come from this script. Read-only, no keys.
// Usage: pnpm build && pnpm demo
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "gaussia-mcp-demo", version: "0.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], stderr: "inherit" }));

let failed = 0;
async function call(name, args) {
  const t0 = Date.now();
  const r = await client.callTool({ name, arguments: args });
  console.log(`\n$ ${name} ${JSON.stringify(args)}   [${((Date.now() - t0) / 1000).toFixed(1)} s${r.isError ? ", tool error" : ""}]`);
  console.log(r.content[0].text);
  if (r.isError) failed++;
  return r;
}

console.log(`gaussia-mcp demo, ${new Date().toISOString()}`);
// L 98-59 c, ephemeris from ExoFOP TOI-175.01.
await call("crossmatch_signal", { tic_id: 307210830, period_days: 3.6906758578, epoch: 2460688.70837, duration_hours: 1.107 });
// TOI-700 d, ephemeris from ExoFOP TOI-700.02, given in BTJD.
await call("crossmatch_signal", { tic_id: "TIC 150428135", period_days: 37.4236838, epoch: 1330.486155, duration_hours: 3.365 });
// Twice L 98-59 b's period.
await call("crossmatch_signal", { tic_id: 307210830, period_days: 4.5062123, epoch: 2458354.907237, duration_hours: 1.0 });
// A made-up period on L 98-59: nothing known there.
await call("crossmatch_signal", { tic_id: 307210830, period_days: 5.4321, epoch: 2459500.123, duration_hours: 1.5 });
await call("toi_lookup", { toi: "TOI-700" });
await call("star_info", { tic_id: 307210830 });
await call("tess_observations", { tic_id: 307210830 });
await call("vet_signal", { tic_id: 307210830, period_days: 3.6906758578, duration_hours: 1.107, depth_ppm: 1657 });
await call("vet_signal", { tic_id: 307210830, period_days: 3.69, duration_hours: 6, depth_ppm: 300000 });
await call("sealed_commit", { job_id: `0x${"11".repeat(32)}`, result_hash: `0x${"22".repeat(32)}`, wallet: `0x${"33".repeat(20)}`, salt: `0x${"44".repeat(32)}` });

await client.close();
if (failed) {
  console.error(`\n${failed} call(s) failed`);
  process.exitCode = 1;
}
