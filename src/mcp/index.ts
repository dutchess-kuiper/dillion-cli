#!/usr/bin/env bun
// IMPORTANT: this MUST be the first import — it redirects console.log → stderr before any
// other module (including reused CLI code) can print to stdout and corrupt the JSON-RPC stream.
import "./lib/stdioGuard";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { setApiFailureMode } from "../api";
import { resolveRuntimeConfig } from "../config";
import { setOrgOverride } from "../orgContext";
import { setApiKey, setBaseUrl, setDefaultProjectId } from "./lib/context";
import type { Toolset } from "./lib/register";
import { createDillionMcpServer } from "./server";

async function main(): Promise<void> {
  // Reused CLI HTTP fns must throw (caught → clean tool errors) instead of process.exit(1).
  setApiFailureMode("throw");

  const config = await resolveRuntimeConfig();
  if (!config) {
    console.error(
      "Dillion MCP: not configured. Run `dillion auth <key>` to save credentials, " +
        "OR set DILLION_API_KEY + DILLION_BASE_URL (both required — there is no default server URL). " +
        "Optional: DILLION_PROJECT_ID, DILLION_ORG_ID.",
    );
    process.exit(1);
  }

  // Resolve org + defaults ONCE at startup (process-global; a different org = a second server).
  setOrgOverride(config.orgId);
  setDefaultProjectId(config.projectId);
  setBaseUrl(config.baseUrl);
  setApiKey(config.apiKey);

  const toolset: Toolset = process.env.DILLION_MCP_TOOLS === "core" ? "core" : "full";

  const server = createDillionMcpServer(toolset);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Stays alive on the stdio transport until the client disconnects.
}

main().catch((err) => {
  console.error(`Dillion MCP failed to start: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
