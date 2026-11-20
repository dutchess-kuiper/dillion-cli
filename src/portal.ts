/**
 * Client-portal helpers for share links. A share link is also a portal bundle:
 * attaching existing client users or client orgs lets them open it on
 * portal.dillion.ai after signing in, with no link password.
 *
 * The CLI only ever attaches people and orgs that ALREADY exist. That rule is
 * enforced by the server (POST /share-links/:id/portal-access refuses unknown
 * emails and org ids, and grants everything in one transaction).
 */

export interface ClientOrgSummary {
  org_id: string;
  name: string;
  description?: string | null;
  created_at: string;
  created_by_email?: string | null;
}

/**
 * An `org_` token with no spaces is an id (WorkOS ids are `org_` + a ULID, but
 * accept any such token so every id `portal-orgs` prints works). Anything else
 * is treated as a name.
 */
const ORG_ID = /^org_[A-Za-z0-9_]+$/;

export function looksLikeOrgId(s: string): boolean {
  return ORG_ID.test(s.trim());
}

/** One line per org: id first (what --orgs should get), then name and disambiguators. */
export function formatOrgRows(orgs: ClientOrgSummary[]): string[] {
  return orgs.map(
    (o) =>
      `${o.org_id}  ${o.name}  (created ${o.created_at.slice(0, 10)}` +
      (o.created_by_email ? ` by ${o.created_by_email}` : "") +
      ")" +
      (o.description ? `  — ${o.description}` : ""),
  );
}

/**
 * Split --orgs into org ids and anything that isn't one. Grants take ids only:
 * org names aren't unique, so a name could match the wrong org.
 */
export function parseOrgIds(raw: string | undefined): { ids: string[]; notIds: string[] } {
  // Same separators as --clients (commas and/or spaces): org ids never contain either.
  const parts = (raw ?? "").split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  const ids = [...new Set(parts.filter(looksLikeOrgId))];
  const notIds = parts.filter((p) => !looksLikeOrgId(p));
  return { ids, notIds };
}

/**
 * Human summary of who can open a link on the portal. Revoked grants are past
 * access, and a revoked LINK means nobody can open it, whatever the grants say.
 */
export function describePortalAccess(
  link: { revoked_at?: string | null },
  clients: Array<{ email: string; full_name?: string | null; has_logged_in?: boolean; revoked_at?: string | null }>,
  orgs: Array<{ org_id: string; name: string; revoked_at?: string | null }>,
): string[] {
  const lines: string[] = [];
  const liveClients = clients.filter((c) => !c.revoked_at);
  const liveOrgs = orgs.filter((o) => !o.revoked_at);
  const pastClients = clients.filter((c) => c.revoked_at);
  const pastOrgs = orgs.filter((o) => o.revoked_at);
  const who = (c: { email: string; full_name?: string | null }) =>
    c.full_name ? `${c.full_name} <${c.email}>` : c.email;
  if (link.revoked_at) {
    lines.push(`  access:    NONE — the link was revoked ${link.revoked_at.slice(0, 10)}; nobody can open it`);
    lines.push(`  granted before the revoke: ${liveClients.length} client(s), ${liveOrgs.length} org(s)`);
    for (const c of liveClients) lines.push(`    ${who(c)}`);
    for (const o of liveOrgs) lines.push(`    ${o.org_id}  ${o.name}`);
  } else {
    lines.push(`  clients (${liveClients.length}):`);
    for (const c of liveClients) {
      lines.push(`    ${who(c)}${c.has_logged_in === false ? "  (hasn't signed in yet)" : ""}`);
    }
    lines.push(`  orgs (${liveOrgs.length}):`);
    for (const o of liveOrgs) lines.push(`    ${o.org_id}  ${o.name}`);
  }
  if (pastClients.length || pastOrgs.length) {
    lines.push(`  removed earlier (no access): ${pastClients.length} client(s), ${pastOrgs.length} org(s)`);
    for (const c of pastClients) lines.push(`    ${who(c)}  (removed ${c.revoked_at!.slice(0, 10)})`);
    for (const o of pastOrgs) lines.push(`    ${o.org_id}  ${o.name}  (removed ${o.revoked_at!.slice(0, 10)})`);
  }
  return lines;
}

/**
 * Portal origin to print links for. DILLION_PORTAL_URL wins; otherwise follow
 * the bastion the CLI is pointed at (local → :3001, dev → dev portal, else prod).
 */
export function portalBaseUrl(bastionBaseUrl: string, envOverride?: string): string {
  if (envOverride && envOverride.trim()) return envOverride.trim().replace(/\/+$/, "");
  let host = "";
  try {
    host = new URL(bastionBaseUrl).hostname;
  } catch {
    // fall through to prod
  }
  // URL.hostname keeps the brackets on IPv6 literals: "[::1]".
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost")) {
    return "http://localhost:3001";
  }
  if (/(^|[.-])dev([.-]|$)/.test(host)) return "https://dev.portal.dillion.ai";
  return "https://portal.dillion.ai";
}

export function portalBundleUrl(base: string, projectId: string, linkId: string): string {
  return `${base}/projects/${encodeURIComponent(projectId)}/bundles/${encodeURIComponent(linkId)}`;
}

/**
 * Flags that only mean something on the public /share URL. A portal-only link
 * has no public URL, so the backend rejects them; fail fast with the reason.
 */
export function portalOnlyFlagConflicts(flags: Record<string, unknown>): string[] {
  const conflicts: string[] = [];
  const reasons: Record<string, string> = {
    password: "--password (portal links have no password; viewers sign in instead)",
    "expires-days": "--expires-days (expiry only applies to the public /share URL)",
    domains: "--domains (email gates only apply to the public /share URL)",
    emails: "--emails (email gates only apply to the public /share URL; use --clients for portal people)",
    "no-citations": "--no-citations (portal viewers always see source previews)",
  };
  for (const [flag, reason] of Object.entries(reasons)) {
    if (flags[flag] !== undefined) conflicts.push(reason);
  }
  return conflicts;
}
