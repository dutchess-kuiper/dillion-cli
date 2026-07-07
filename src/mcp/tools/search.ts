import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { api } from "../../api";
import { requireProject } from "../lib/context";
import { jsonContent } from "../lib/result";
import { registerTool, type Toolset } from "../lib/register";
import { trimSearchResult } from "../lib/trim";

const SearchInput = z.object({
  query: z.string().min(1).describe("The search query."),
  projectId: z
    .string()
    .optional()
    .describe("Project id. Defaults to the server's configured project."),
  limit: z.number().int().min(1).max(100).optional().describe("Max results (default 10)."),
  alpha: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Hybrid weight: 1 = pure vector, 0 = pure keyword."),
  jobId: z.string().optional().describe("Restrict the search to a single document's job id."),
  maxChars: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Truncate each chunk's text to this many chars (default 800)."),
});

export function registerSearchTools(server: McpServer, toolset: Toolset): void {
  registerTool(server, toolset, {
    name: "search",
    core: true,
    description:
      "Hybrid search over a project's ingested documents. The CANONICAL citation source: " +
      "each result carries both jobId and chunkId for memo citations.",
    inputSchema: SearchInput.shape,
    annotations: { readOnlyHint: true },
    handler: async (args: z.infer<typeof SearchInput>) => {
      const projectId = requireProject(args.projectId);
      const limit = args.limit ?? 10;
      const maxChars = args.maxChars ?? 800;
      const data = await api("/search", {
        method: "POST",
        body: {
          projectId,
          query: args.query,
          limit,
          ...(args.alpha !== undefined && { alpha: args.alpha }),
          ...(args.jobId && { jobId: args.jobId }),
        },
      });
      return jsonContent({
        totalResults: data.totalResults,
        searchMode: data.searchMode,
        results: (data.results ?? []).map((r: any) => trimSearchResult(r, maxChars)),
      });
    },
  });
}
