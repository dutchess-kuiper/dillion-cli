/**
 * Client-portal helpers for share links. A share link is also a portal bundle:
 * attaching existing client users or client orgs lets them open it on
 * portal.dillion.ai after signing in, with no link password.
 *
 * The CLI only ever attaches people and orgs that ALREADY exist. The backend's
 * attach route would create a brand-new client user for an unknown email, so
 * the existence check lives here, before any write.
 */

export interface ClientUserSuggestion {
  client_user_id: string;
  email: string;
  full_name?: string | null;
  has_logged_in: boolean;
}

export interface ClientOrgSummary {
  org_id: string;
  name: string;
  description?: string | null;
  created_at: string;
  created_by_email?: string | null;
}

export type Resolution<T> = { ok: true; value: T } | { ok: false; message: string };

/** WorkOS org ids: `org_` + a 26-char ULID. Anything else is treated as a name. */
const WORKOS_ORG_ID = /^org_[0-9A-HJKMNP-TV-Z]{26}$/i;

export function looksLikeOrgId(s: string): boolean {
  return WORKOS_ORG_ID.test(s.trim());
}

/** Pick the existing client whose email is exactly `email` from a search result. */
export function pickExistingClient(
  email: string,
  results: ClientUserSuggestion[],
): Resolution<ClientUserSuggestion> {
  const want = email.trim().toLowerCase();
  const hit = results.find((r) => r.email.toLowerCase() === want);
  if (hit) return { ok: true, value: hit };
  return {
    ok: false,
    message:
      `${email} is not an existing portal client. The CLI only adds people who already ` +
      `have portal access; invite new people from the share link's settings in the VDR web app.`,
  };
}

/** Pick the one existing client org whose name is exactly `name` (case-insensitive). */
export function pickExistingOrg(
  name: string,
  results: ClientOrgSummary[],
): Resolution<ClientOrgSummary> {
  const want = name.trim().toLowerCase();
  const hits = results.filter((r) => r.name.trim().toLowerCase() === want);
  if (hits.length === 1) return { ok: true, value: hits[0]! };
  if (hits.length > 1) {
    const rows = hits
      .map(
        (o) =>
          `  ${o.org_id}  created ${o.created_at.slice(0, 10)}` +
          (o.created_by_email ? ` by ${o.created_by_email}` : "") +
          (o.description ? `  — ${o.description}` : ""),
      )
      .join("\n");
    return {
      ok: false,
      message: `${hits.length} client orgs are named "${name}". Pass the org id instead:\n${rows}`,
    };
  }
  const near = results.slice(0, 5).map((o) => `  ${o.org_id}  ${o.name}`).join("\n");
  return {
    ok: false,
    message:
      `No existing client org named "${name}". The CLI only adds existing orgs; create ` +
      `new ones from the VDR web app.` +
      (near ? `\nDid you mean:\n${near}` : ""),
  };
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
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost")) {
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
  };
  for (const [flag, reason] of Object.entries(reasons)) {
    if (flags[flag] !== undefined) conflicts.push(reason);
  }
  return conflicts;
}
