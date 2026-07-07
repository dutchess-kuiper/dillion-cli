import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { api } from "../../api";
import { requireProject } from "../lib/context";
import { parseObligationsBody } from "../lib/csv";
import { requireAbsolute, saveToPath } from "../lib/download";
import { jsonContent } from "../lib/result";
import { registerTool, type Toolset } from "../lib/register";

const ObligationsExportInput = z.object({
  projectId: z.string().optional().describe("Project id. Defaults to the configured project."),
  outPath: z.string().min(1).describe("Absolute path to write the CSV (must end in .csv)."),
});

export function registerObligationsTools(server: McpServer, toolset: Toolset): void {
  registerTool(server, toolset, {
    name: "obligations_export",
    core: true,
    description:
      "Export a project's material obligations as CSV to an absolute path. The CSV is written " +
      "to disk (never inlined); JSON error bodies are detected before writing.",
    inputSchema: ObligationsExportInput.shape,
    handler: async (args: z.infer<typeof ObligationsExportInput>) => {
      const projectId = requireProject(args.projectId);
      const outPath = requireAbsolute(args.outPath, "outPath");
      if (!/\.csv$/i.test(outPath)) throw new Error("outPath must end in .csv");

      const res = (await api(`/obligations/${encodeURIComponent(projectId)}`, {
        raw: true,
      })) as Response;
      const contentType = res.headers.get("content-type") ?? undefined;
      const body = await res.text();
      const parsed = parseObligationsBody(body, contentType);
      if (parsed.kind === "error") {
        throw new Error(`Obligations export failed: ${parsed.message}`);
      }
      const path = await saveToPath(outPath, body);
      return jsonContent({
        path,
        rowCount: parsed.rowCount,
        columns: parsed.columns,
        byteSize: parsed.byteSize,
      });
    },
  });
}
