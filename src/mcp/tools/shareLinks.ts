import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { api } from "../../api";
import { requireProject } from "../lib/context";
import { jsonContent } from "../lib/result";
import { registerTool, type Toolset } from "../lib/register";

/** Public share-link URL, honoring DILLION_FRONTEND_URL (mirrors the CLI's shareLinkPublicUrl). */
function shareLinkPublicUrl(slug: string): string {
  const fe = process.env.DILLION_FRONTEND_URL?.replace(/\/+$/, "");
  return fe ? `${fe}/share/${slug}` : `/share/${slug}`;
}

const ReportItem = z.object({
  reportId: z.string().min(1),
  displayLabel: z.string().optional(),
  pinnedVersion: z.number().int().min(1).optional(),
});

/** Build the ordered items[] payload from the structured reports array. */
export function buildShareLinkItems(
  reports: { reportId: string; displayLabel?: string; pinnedVersion?: number }[],
): Record<string, unknown>[] {
  return reports.map((r, idx) => {
    const item: Record<string, unknown> = { report_id: r.reportId, sort_order: idx };
    if (r.displayLabel) item.display_label = r.displayLabel;
    if (r.pinnedVersion !== undefined) item.pinned_version = r.pinnedVersion;
    return item;
  });
}

export interface ShareLinkUpdateArgs {
  title?: string;
  description?: string;
  slug?: string;
  password?: string;
  removePassword?: boolean;
  expiresInDays?: number;
  clearExpiry?: boolean;
  allowCitationExcerpts?: boolean;
  allowedEmailDomains?: string[];
  clearDomains?: boolean;
  allowedEmails?: string[];
  clearEmails?: boolean;
  reports?: { reportId: string; displayLabel?: string; pinnedVersion?: number }[];
}

/**
 * Build the PATCH body for a share-link update, enforcing the mutual-exclusion pairs and
 * requiring at least one change. Pure + exported for unit tests.
 */
export function buildShareLinkUpdateBody(args: ShareLinkUpdateArgs): Record<string, unknown> {
  if (args.password !== undefined && args.removePassword) {
    throw new Error("Pass password OR removePassword, not both.");
  }
  if (args.expiresInDays !== undefined && args.clearExpiry) {
    throw new Error("Pass expiresInDays OR clearExpiry, not both.");
  }
  if (args.allowedEmailDomains !== undefined && args.clearDomains) {
    throw new Error("Pass allowedEmailDomains OR clearDomains, not both.");
  }
  if (args.allowedEmails !== undefined && args.clearEmails) {
    throw new Error("Pass allowedEmails OR clearEmails, not both.");
  }
  const body: Record<string, unknown> = {};
  if (args.title !== undefined) body.title = args.title;
  if (args.description !== undefined) body.description = args.description;
  if (args.slug !== undefined) body.slug = args.slug;
  if (args.password !== undefined) body.password = args.password;
  if (args.removePassword) body.remove_password = true;
  if (args.expiresInDays !== undefined) body.expires_in_days = args.expiresInDays;
  if (args.clearExpiry) body.clear_expiry = true;
  if (args.allowCitationExcerpts !== undefined) {
    body.allow_citation_excerpts = args.allowCitationExcerpts;
  }
  if (args.clearDomains) body.clear_allowed_email_domains = true;
  else if (args.allowedEmailDomains !== undefined) body.allowed_email_domains = args.allowedEmailDomains;
  if (args.clearEmails) body.clear_allowed_emails = true;
  else if (args.allowedEmails !== undefined) body.allowed_emails = args.allowedEmails;
  if (args.reports !== undefined) {
    if (args.reports.length === 0) throw new Error("reports must contain at least one item.");
    body.items = buildShareLinkItems(args.reports);
  }
  if (Object.keys(body).length === 0) {
    throw new Error("No changes: provide at least one field to update.");
  }
  return body;
}

function trimShareLink(l: any) {
  return {
    id: l?.id,
    slug: l?.slug,
    title: l?.title,
    url: l?.slug ? shareLinkPublicUrl(l.slug) : undefined,
    itemCount: l?.item_count,
    hasPassword: l?.has_password,
    requiresEmail: l?.requires_email,
    expiresAt: l?.expires_at ?? null,
    revokedAt: l?.revoked_at ?? null,
  };
}

const ShareLinksCreateInput = z.object({
  projectId: z.string().optional().describe("Project id. Defaults to the configured project."),
  title: z.string().min(1).describe("Link title."),
  reports: z.array(ReportItem).min(1).describe("Reports (tabs) in display order."),
  slug: z.string().optional().describe("Custom URL slug (defaults to slugified title)."),
  description: z.string().optional(),
  password: z.string().min(8).optional().describe("Password (min 8 chars)."),
  expiresInDays: z.number().int().min(1).max(365).optional(),
  allowCitationExcerpts: z.boolean().optional().describe("Source preview (default on)."),
  allowedEmailDomains: z.array(z.string()).optional().describe("Restrict to these email domains."),
  allowedEmails: z.array(z.string()).optional().describe("Restrict to these email addresses."),
});

const ShareLinksListInput = z.object({
  projectId: z.string().optional().describe("Project id. Defaults to the configured project."),
});

const ShareLinksGetInput = z.object({
  linkId: z.string().min(1).describe("Share link id."),
});

const ShareLinksUpdateInput = z.object({
  linkId: z.string().min(1).describe("Share link id."),
  title: z.string().optional(),
  description: z.string().optional(),
  slug: z.string().optional(),
  password: z.string().min(8).optional(),
  removePassword: z.boolean().optional(),
  expiresInDays: z.number().int().min(1).max(365).optional(),
  clearExpiry: z.boolean().optional(),
  allowCitationExcerpts: z.boolean().optional(),
  allowedEmailDomains: z.array(z.string()).optional(),
  clearDomains: z.boolean().optional(),
  allowedEmails: z.array(z.string()).optional(),
  clearEmails: z.boolean().optional(),
  reports: z.array(ReportItem).optional().describe("Replace the tab set wholesale."),
});

const ShareLinksRevokeInput = z.object({
  linkId: z.string().min(1).describe("Share link id to revoke."),
});

export function registerShareLinksTools(server: McpServer, toolset: Toolset): void {
  registerTool(server, toolset, {
    name: "share_links_create",
    description: "Create a multi-report share link (each report becomes a tab).",
    inputSchema: ShareLinksCreateInput.shape,
    handler: async (args: z.infer<typeof ShareLinksCreateInput>) => {
      const projectId = requireProject(args.projectId);
      const body: Record<string, unknown> = {
        title: args.title,
        items: buildShareLinkItems(args.reports),
        allow_citation_excerpts: args.allowCitationExcerpts ?? true,
      };
      if (args.slug) body.slug = args.slug;
      if (args.description) body.description = args.description;
      if (args.password !== undefined) body.password = args.password;
      if (args.expiresInDays !== undefined) body.expires_in_days = args.expiresInDays;
      if (args.allowedEmailDomains?.length) body.allowed_email_domains = args.allowedEmailDomains;
      if (args.allowedEmails?.length) body.allowed_emails = args.allowedEmails;
      const res = await api(`/projects/${encodeURIComponent(projectId)}/share-links`, {
        method: "POST",
        body,
      });
      const link = res.link ?? {};
      return jsonContent({
        id: link.id,
        slug: link.slug,
        url: link.slug ? shareLinkPublicUrl(link.slug) : undefined,
        itemCount: link.item_count,
        hasPassword: link.has_password,
        requiresEmail: link.requires_email,
      });
    },
  });

  registerTool(server, toolset, {
    name: "share_links_list",
    description: "List multi-report share links for a project.",
    inputSchema: ShareLinksListInput.shape,
    annotations: { readOnlyHint: true },
    handler: async (args: z.infer<typeof ShareLinksListInput>) => {
      const projectId = requireProject(args.projectId);
      const data = await api(`/projects/${encodeURIComponent(projectId)}/share-links`);
      return jsonContent(Array.isArray(data) ? data.map(trimShareLink) : data);
    },
  });

  registerTool(server, toolset, {
    name: "share_links_get",
    description: "Get a multi-report share link and its items.",
    inputSchema: ShareLinksGetInput.shape,
    annotations: { readOnlyHint: true },
    handler: async (args: z.infer<typeof ShareLinksGetInput>) => {
      const data = await api(`/share-links/${encodeURIComponent(args.linkId)}`);
      return jsonContent({
        ...trimShareLink(data),
        description: data?.description ?? null,
        projectId: data?.project_id,
        allowCitationExcerpts: data?.allow_citation_excerpts,
        allowedEmailDomains: data?.allowed_email_domains ?? [],
        allowedEmails: data?.allowed_emails ?? [],
        items: (data?.items ?? []).map((it: any) => ({
          reportId: it.report_id,
          reportTitle: it.report_title,
          displayLabel: it.display_label ?? null,
          pinnedVersion: it.pinned_version ?? null,
        })),
      });
    },
  });

  registerTool(server, toolset, {
    name: "share_links_update",
    description:
      "Update a multi-report share link (title, slug, password, expiry, email allowlist, tabs). " +
      "Provide at least one change.",
    inputSchema: ShareLinksUpdateInput.shape,
    handler: async (args: z.infer<typeof ShareLinksUpdateInput>) => {
      const body = buildShareLinkUpdateBody(args);
      const data = await api(`/share-links/${encodeURIComponent(args.linkId)}`, {
        method: "PATCH",
        body,
      });
      return jsonContent(trimShareLink(data));
    },
  });

  registerTool(server, toolset, {
    name: "share_links_revoke",
    description: "Soft-revoke a multi-report share link.",
    inputSchema: ShareLinksRevokeInput.shape,
    annotations: { destructiveHint: true },
    handler: async (args: z.infer<typeof ShareLinksRevokeInput>) => {
      await api(`/share-links/${encodeURIComponent(args.linkId)}`, { method: "DELETE" });
      return jsonContent({ id: args.linkId, revoked: true });
    },
  });
}
