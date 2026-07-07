import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { api } from "../../api";
import { requireProject } from "../lib/context";
import { jsonContent } from "../lib/result";
import { registerTool, type Toolset } from "../lib/register";
import { trimAgentAsk, trimAgentSearchResult } from "../lib/trim";

const AgentAskInput = z.object({
  query: z.string().min(1).describe("The question to ask the agent."),
  projectId: z.string().optional().describe("Project id. Defaults to the configured project."),
});

const AgentSearchInput = z.object({
  query: z.string().min(1).describe("The retrieval query."),
  projectId: z.string().optional().describe("Project id. Defaults to the configured project."),
  limit: z.number().int().min(1).max(100).optional().describe("Max results (default 10)."),
  maxChars: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Truncate each chunk's text to this many chars (default 800)."),
});

export function registerAgentTools(server: McpServer, toolset: Toolset): void {
  registerTool(server, toolset, {
    name: "agent_ask",
    core: true,
    description:
      "Ask the agent a question answered from the project's documents. NOTE: the returned " +
      "sources carry NO jobId — use the `search` tool to obtain jobId+chunkId citations.",
    inputSchema: AgentAskInput.shape,
    annotations: { readOnlyHint: true },
    handler: async (args: z.infer<typeof AgentAskInput>) => {
      const projectId = requireProject(args.projectId);
      const data = await api("/agent/ask", { method: "POST", body: { projectId, query: args.query } });
      return jsonContent(trimAgentAsk(data));
    },
  });

  registerTool(server, toolset, {
    name: "agent_search",
    description: "Agent retrieval search (chunks only, no generated answer).",
    inputSchema: AgentSearchInput.shape,
    annotations: { readOnlyHint: true },
    handler: async (args: z.infer<typeof AgentSearchInput>) => {
      const projectId = requireProject(args.projectId);
      const limit = args.limit ?? 10;
      const maxChars = args.maxChars ?? 800;
      const data = await api("/agent/search", {
        method: "POST",
        body: { projectId, query: args.query, limit },
      });
      return jsonContent({
        results: (data.results ?? []).map((r: any) => trimAgentSearchResult(r, maxChars)),
      });
    },
  });
}
