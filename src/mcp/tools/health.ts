import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getBaseUrl } from "../lib/context";
import { jsonContent, textError } from "../lib/result";
import { registerTool, type Toolset } from "../lib/register";

/**
 * `/health` bypasses the api.ts funnel (direct fetch, no auth), so this handler adds its own
 * `res.ok` + JSON-parse guards — the upstream CLI command checks neither. A down or non-JSON
 * server returns a clean tool error, never a throw that reaches the transport.
 */
export function registerHealthTools(server: McpServer, toolset: Toolset): void {
  registerTool(server, toolset, {
    name: "health",
    description: "Check the Dillion server's health. No auth or project required.",
    annotations: { readOnlyHint: true, openWorldHint: true },
    handler: async () => {
      const baseUrl = getBaseUrl();
      let res: Response;
      try {
        res = await fetch(`${baseUrl}/health`);
      } catch (err) {
        return textError(
          `Cannot reach ${baseUrl}/health: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (!res.ok) {
        return textError(`Health check failed: HTTP ${res.status} from ${baseUrl}/health`);
      }
      let data: any;
      try {
        data = await res.json();
      } catch {
        return textError(`Health endpoint at ${baseUrl} did not return JSON.`);
      }
      return jsonContent({ status: data?.status, timestamp: data?.timestamp, baseUrl });
    },
  });
}
