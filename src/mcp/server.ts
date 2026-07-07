import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { VERSION } from "../version";
import type { Toolset } from "./lib/register";
import { registerAgentTools } from "./tools/agent";
import { registerArtifactsTools } from "./tools/artifacts";
import { registerFilesTools } from "./tools/files";
import { registerFiltersTools } from "./tools/filters";
import { registerHealthTools } from "./tools/health";
import { registerJobsTools } from "./tools/jobs";
import { registerObligationsTools } from "./tools/obligations";
import { registerProjectsTools } from "./tools/projects";
import { registerSearchTools } from "./tools/search";
import { registerSharesTools } from "./tools/shares";
import { registerShareLinksTools } from "./tools/shareLinks";

export type { Toolset };

/**
 * Build the Dillion MCP server and register every tool for the chosen toolset. Registers NO
 * transport — the caller connects one (stdio in production, InMemoryTransport in tests).
 * Never imports src/index.ts (which self-executes main() + an update check).
 */
export function createDillionMcpServer(toolset: Toolset): McpServer {
  const server = new McpServer({ name: "dillion", version: VERSION });

  registerHealthTools(server, toolset);
  registerProjectsTools(server, toolset);
  registerFiltersTools(server, toolset);
  registerJobsTools(server, toolset);
  registerFilesTools(server, toolset);
  registerSearchTools(server, toolset);
  registerAgentTools(server, toolset);
  registerObligationsTools(server, toolset);
  registerArtifactsTools(server, toolset);
  registerSharesTools(server, toolset);
  registerShareLinksTools(server, toolset);

  return server;
}
