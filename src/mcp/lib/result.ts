import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ApiError } from "../../api";

/** Wrap arbitrary data as a single JSON text block — the one result shape every tool returns. */
export function jsonContent(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

/** A clean tool error: a text block with `isError: true` (never throws through to the transport). */
export function textError(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

/**
 * A tool handler. Loosely typed on purpose: `registerTool` validates args against the
 * inputSchema before calling, and each handler annotates its own `args` via `z.infer`.
 * `(args: any, extra: any) => …` is assignable to the SDK's `ToolCallback<InputArgs>` for
 * any input shape, so this keeps registration type-clean without fighting inference.
 */
export type ToolHandler = (
  args: any,
  extra: any,
) => Promise<CallToolResult> | CallToolResult;

/**
 * Turn any throw into a clean tool error. An `ApiError` (from the api.ts throw funnel)
 * surfaces its normalized message; anything else surfaces its `.message`. The process
 * survives every failure — nothing here calls `process.exit`.
 */
export function wrap(handler: ToolHandler): ToolHandler {
  return async (args, extra) => {
    try {
      return await handler(args, extra);
    } catch (err) {
      if (err instanceof ApiError) return textError(err.message);
      return textError(err instanceof Error ? err.message : String(err));
    }
  };
}
