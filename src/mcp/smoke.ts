/**
 * Stdio smoke test: spawn the REAL server as a child process over stdio, run the MCP
 * handshake + tools/list, call `health` against an unroutable base URL, and prove the
 * process survives and its stdout is clean JSON-RPC.
 *
 * Run: `bun run mcp:smoke`. Exits 0 on success, 1 on any failure. No live API key needed.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join } from "path";

function log(msg: string): void {
  // stderr only — never pollute the harness's own stdout.
  process.stderr.write(`[smoke] ${msg}\n`);
}

async function main(): Promise<void> {
  const serverEntry = join(import.meta.dir, "index.ts");
  const transport = new StdioClientTransport({
    command: "bun",
    args: [serverEntry],
    env: {
      ...getDefaultEnvironment(),
      DILLION_API_KEY: "dil_dummy",
      DILLION_BASE_URL: "http://127.0.0.1:9",
    },
    stderr: "inherit",
  });

  let transportError: Error | undefined;
  transport.onerror = (err) => {
    // Fires if the server ever writes a stdout line that isn't valid JSON-RPC.
    transportError = err;
  };

  const client = new Client({ name: "dillion-mcp-smoke", version: "0.0.0" });

  try {
    await client.connect(transport); // performs initialize
    log("initialize OK");

    const listed = await client.listTools();
    log(`tools/list OK — ${listed.tools.length} tools`);
    if (listed.tools.length === 0) throw new Error("expected at least one tool");

    const health = await client.callTool({ name: "health", arguments: {} });
    if (health.isError !== true) {
      throw new Error("expected health to return a clean isError against an unroutable base URL");
    }
    log("health returned a clean isError (connection refused) — process survived");

    // Process still alive → another request must succeed.
    const listedAgain = await client.listTools();
    if (listedAgain.tools.length !== listed.tools.length) {
      throw new Error("tool count changed after error-path call");
    }
    log("second tools/list OK — process stayed alive");

    const stdoutError: Error | undefined = transportError;
    if (stdoutError) {
      throw new Error(`stdout contained a non-JSON-RPC line: ${stdoutError.message}`);
    }
  } finally {
    await client.close().catch(() => {});
  }

  log("SMOKE OK");
  process.exit(0);
}

main().catch((err) => {
  log(`FAIL: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
