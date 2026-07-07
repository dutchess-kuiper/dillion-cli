import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { api } from "../../api";
import { requireProject } from "../lib/context";
import { jsonContent } from "../lib/result";
import { registerTool, type Toolset } from "../lib/register";

const FiltersGetInput = z.object({
  projectId: z.string().optional().describe("Project id. Defaults to the configured project."),
});

export function registerFiltersTools(server: McpServer, toolset: Toolset): void {
  registerTool(server, toolset, {
    name: "filters_get",
    description: "Get the available filter facets (tags, categories, people, …) for a project.",
    inputSchema: FiltersGetInput.shape,
    annotations: { readOnlyHint: true },
    handler: async (args: z.infer<typeof FiltersGetInput>) => {
      const projectId = requireProject(args.projectId);
      const data = await api(`/filters/${encodeURIComponent(projectId)}`);
      return jsonContent(data);
    },
  });
}
