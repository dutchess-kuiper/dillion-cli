import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { api } from "../../api";
import { jsonContent } from "../lib/result";
import { registerTool, type Toolset } from "../lib/register";

/** Trim a report share record to the model-facing fields. */
export function trimShare(s: any) {
  return {
    id: s?.id,
    token: s?.token,
    hasPassword: s?.has_password,
    pinnedVersion: s?.pinned_version ?? null,
    allowCitationExcerpts: s?.allow_citation_excerpts,
    expiresAt: s?.expires_at ?? null,
    revokedAt: s?.revoked_at ?? null,
    createdAt: s?.created_at,
  };
}

export interface ShareUpdateArgs {
  password?: string;
  removePassword?: boolean;
  expiresInDays?: number;
  clearExpiry?: boolean;
  pinnedVersion?: number;
  pinToLatest?: boolean;
  allowCitationExcerpts?: boolean;
}

/**
 * Build the PATCH body for a report share update, enforcing the mutual-exclusion pairs and
 * requiring at least one change. Pure + exported so the guards are unit-testable.
 */
export function buildShareUpdateBody(args: ShareUpdateArgs): Record<string, unknown> {
  if (args.password !== undefined && args.removePassword) {
    throw new Error("Pass password OR removePassword, not both.");
  }
  if (args.expiresInDays !== undefined && args.clearExpiry) {
    throw new Error("Pass expiresInDays OR clearExpiry, not both.");
  }
  if (args.pinnedVersion !== undefined && args.pinToLatest) {
    throw new Error("Pass pinnedVersion OR pinToLatest, not both.");
  }
  const body: Record<string, unknown> = {};
  if (args.password !== undefined) body.password = args.password;
  if (args.removePassword) body.remove_password = true;
  if (args.expiresInDays !== undefined) body.expires_in_days = args.expiresInDays;
  if (args.clearExpiry) body.clear_expiry = true;
  if (args.pinnedVersion !== undefined) body.pinned_version = args.pinnedVersion;
  if (args.pinToLatest) body.pin_to_latest = true;
  if (args.allowCitationExcerpts !== undefined) {
    body.allow_citation_excerpts = args.allowCitationExcerpts;
  }
  if (Object.keys(body).length === 0) {
    throw new Error("No changes: provide at least one field to update.");
  }
  return body;
}

const ShareCreateInput = z.object({
  reportId: z.string().min(1).describe("Research report id."),
  password: z.string().min(8).optional().describe("Password (min 8 chars)."),
  expiresInDays: z.number().int().min(1).max(365).optional().describe("Expire N days from now."),
  pinnedVersion: z.number().int().min(1).optional().describe("Pin to a specific version (else latest)."),
  allowCitationExcerpts: z.boolean().optional().describe("Source-document preview for viewers."),
});

const SharesListInput = z.object({
  reportId: z.string().min(1).describe("Research report id."),
});

const ShareUpdateInput = z.object({
  reportId: z.string().min(1).describe("Research report id."),
  shareId: z.string().min(1).describe("Share id to update."),
  password: z.string().min(8).optional(),
  removePassword: z.boolean().optional(),
  expiresInDays: z.number().int().min(1).max(365).optional(),
  clearExpiry: z.boolean().optional(),
  pinnedVersion: z.number().int().min(1).optional(),
  pinToLatest: z.boolean().optional(),
  allowCitationExcerpts: z.boolean().optional(),
});

export function registerSharesTools(server: McpServer, toolset: Toolset): void {
  registerTool(server, toolset, {
    name: "artifacts_share_create",
    core: true,
    description: "Create a password-protected share link for a single research report.",
    inputSchema: ShareCreateInput.shape,
    handler: async (args: z.infer<typeof ShareCreateInput>) => {
      const body: Record<string, unknown> = {};
      if (args.password !== undefined) body.password = args.password;
      if (args.expiresInDays !== undefined) body.expires_in_days = args.expiresInDays;
      if (args.pinnedVersion !== undefined) body.pinned_version = args.pinnedVersion;
      if (args.allowCitationExcerpts !== undefined) {
        body.allow_citation_excerpts = args.allowCitationExcerpts;
      }
      const res = await api(`/research-reports/${encodeURIComponent(args.reportId)}/share`, {
        method: "POST",
        body,
      });
      const share = res.share ?? {};
      return jsonContent({
        token: share.token,
        urlPath: res.url_path,
        hasPassword: share.has_password,
        ...(share.expires_at ? { expiresAt: share.expires_at } : {}),
      });
    },
  });

  registerTool(server, toolset, {
    name: "artifacts_shares_list",
    description: "List share links (active + revoked) for a research report.",
    inputSchema: SharesListInput.shape,
    annotations: { readOnlyHint: true },
    handler: async (args: z.infer<typeof SharesListInput>) => {
      const data = await api(`/research-reports/${encodeURIComponent(args.reportId)}/shares`);
      return jsonContent(Array.isArray(data) ? data.map(trimShare) : data);
    },
  });

  registerTool(server, toolset, {
    name: "artifacts_share_update",
    description:
      "Update a report share link (password, expiry, version pin, citation preview). " +
      "Provide at least one change.",
    inputSchema: ShareUpdateInput.shape,
    handler: async (args: z.infer<typeof ShareUpdateInput>) => {
      const body = buildShareUpdateBody(args);
      const s = await api(
        `/research-reports/${encodeURIComponent(args.reportId)}/shares/${encodeURIComponent(args.shareId)}`,
        { method: "PATCH", body },
      );
      return jsonContent(trimShare(s));
    },
  });
}
