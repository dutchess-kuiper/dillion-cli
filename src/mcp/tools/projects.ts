import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiProjectsCreate, apiProjectsList } from "../../api";
import { jsonContent } from "../lib/result";
import { registerTool, type Toolset } from "../lib/register";

const ProjectsListInput = z.object({
  name: z.string().optional().describe("Case-insensitive substring filter on project name."),
});

const ProjectsCreateInput = z.object({
  name: z.string().min(1).describe("Project name (required)."),
  description: z.string().optional().describe("Optional project description."),
});

export function registerProjectsTools(server: McpServer, toolset: Toolset): void {
  registerTool(server, toolset, {
    name: "projects_list",
    description: "List projects visible to the API key (optional name substring filter).",
    inputSchema: ProjectsListInput.shape,
    annotations: { readOnlyHint: true },
    handler: async (args: z.infer<typeof ProjectsListInput>) => {
      const data = await apiProjectsList(args.name);
      const list = Array.isArray(data)
        ? data.map((p: any) => ({
            id: p.id,
            name: p.name,
            ...(p.description != null ? { description: p.description } : {}),
          }))
        : data;
      return jsonContent(list);
    },
  });

  registerTool(server, toolset, {
    name: "projects_create",
    description: "Create a new project.",
    inputSchema: ProjectsCreateInput.shape,
    handler: async (args: z.infer<typeof ProjectsCreateInput>) => {
      const data = (await apiProjectsCreate(args.name, args.description)) as any;
      return jsonContent({ id: data?.id, name: data?.name });
    },
  });
}
