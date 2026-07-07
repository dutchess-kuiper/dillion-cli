import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { ZodRawShape } from "zod";
import { wrap, type ToolHandler } from "./result";

/** Which tools to expose. `core` = the 8 pipeline-critical tools; `full` = all 30. */
export type Toolset = "full" | "core";

export interface ToolDef {
  name: string;
  description: string;
  /** Raw zod shape (object of zod types). Omit for zero-arg tools. */
  inputSchema?: ZodRawShape;
  annotations?: ToolAnnotations;
  /** Registered even in the `core` toolset. */
  core?: boolean;
  handler: ToolHandler;
}

/**
 * Register a tool, honoring the toolset switch. In `core` mode only tools marked
 * `core: true` are registered. Every handler is wrapped so throws become clean tool errors.
 */
export function registerTool(server: McpServer, toolset: Toolset, def: ToolDef): void {
  if (toolset === "core" && !def.core) return;
  const config: {
    description: string;
    inputSchema?: ZodRawShape;
    annotations?: ToolAnnotations;
  } = { description: def.description };
  if (def.inputSchema) config.inputSchema = def.inputSchema;
  if (def.annotations) config.annotations = def.annotations;
  server.registerTool(def.name, config, wrap(def.handler));
}
