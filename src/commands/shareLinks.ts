import { api, apiBaseUrl, apiResult } from "../api";
import {
  describePortalAccess,
  formatOrgRows,
  parseOrgIds,
  parseShareLinkRef,
  portalBaseUrl,
  portalBundleUrl,
  portalOnlyFlagConflicts,
  type ClientOrgSummary,
} from "../portal";
import { parseFlags } from "../flags";
import { requireProjectId } from "../projectContext";

export const SHARE_LINKS_HELP = `
Usage: dillion share-links <command> [options]

Commands:
  create -p <pid> --title <t> --reports <id1,id2,...> --password <pw>
                                Create a multi-artifact share link
    [--slug <slug>]             Custom slug (defaults to slugified title)
    [--description <text>]      One-line context shown above the tabs
    [--labels "Q3 FDD|Cap Table|"]
                                Tab labels (| separated, aligned with --reports;
                                empty entry = use report title)
    [--versions "1||3"]         Pinned versions per report (| separated; empty
                                entry = always latest)
    --password <pw>             Password (required, 8+ chars)
    [--expires-days <N>]        Expire N days from now (1-365)
    [--no-citations]            Disable source-document preview (default: on)
    [--domains a.com,b.co]      Restrict to allowed email domains
    [--emails a@x.com,b@y.com]  Restrict to specific allowed emails
    [--json]                    Raw JSON output

  create -p <pid> --title <t> --reports <ids> --portal --clients <emails> --orgs <org-ids>
                                Create a PORTAL link (portal.dillion.ai): no password; the
                                listed people/orgs open it after signing in to the portal
    --portal                    Portal-only: no public /share URL, no password
    [--clients a@x.com,b@y.com] Existing portal clients to give access (exact emails)
    [--orgs org_…,org_…]        Existing client org ids (find them with portal-orgs);
                                every member gets access
    [--no-notify]               Don't email the clients or org members
                                At least one of --clients / --orgs is required. Only EXISTING
                                clients and orgs are accepted — invite new people from the
                                VDR web app. --clients/--orgs also work without --portal
                                (link keeps its password-protected /share URL too).
                                Portal viewers always see source previews, so --no-citations
                                and --versions pins can't be combined with portal access.

  portal-add <link> [--clients <emails>] [--orgs <org-ids>] [--no-notify]
                                Give existing portal clients / orgs access to a link
    [--with-previews]           Needed when the link has source previews off: portal
                                viewers always see them
  portal-list <link>            Show who can open a link on the portal, plus its portal URL
  portal-orgs <name> [--limit N] [--json]
                                Look up existing client orgs by name; prints the org ids
                                to pass to --orgs

  list -p <pid>                 List share links for a project
  get <link>                    Show a share link and its items
  update <link-id> [options]    Change slug, password, allowlist, expiry, etc.
    [--title <t>]               Rename
    [--description <text>]      Update description
    [--slug <slug>]             Change URL slug
    [--password <pw>]           New password (8+ chars)
    [--expires-days <N>]        New expiry
    [--no-expiry]               Remove expiry
    [--no-citations / --allow-citations]
    [--domains a.com,b.co]      Replace domain allowlist
    [--clear-domains]           Clear domain allowlist
    [--emails a@x.com,b@y.com]  Replace email allowlist
    [--clear-emails]            Clear email allowlist
    [--reports id1,id2,...]     Replace the tab set wholesale
    [--labels ...] [--versions ...]
                                Match --reports order; use with --reports
  revoke <link-id>              Soft-revoke a share link

  <link> (get, portal-list, portal-add): the link id, its slug, its /share/<slug> URL,
  or its portal URL. update and revoke still take the link id.
`.trim();

export async function shareLinksCommand(args: string[]) {
  const sub = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(SHARE_LINKS_HELP);
      return;
    case "create":
      return shareLinksCreate(rest);
    case "list":
      return shareLinksList(rest);
    case "get":
      return shareLinksGet(rest);
    case "update":
      return shareLinksUpdate(rest);
    case "revoke":
    case "delete":
      return shareLinksRevoke(rest);
    case "portal-add":
      return shareLinksPortalAdd(rest);
    case "portal-list":
      return shareLinksPortalList(rest);
    case "portal-orgs":
      return shareLinksPortalOrgs(rest);
    default:
      console.error(`Unknown share-links subcommand: ${sub}`);
      console.error(SHARE_LINKS_HELP);
      process.exit(1);
  }
}

function parseCommaList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Pipe-separated list that preserves position for empty entries. Used for
 * `--labels` and `--versions` which align with `--reports` index-by-index. */
function parsePipeList(raw: string | undefined): string[] {
  if (raw === undefined || raw === "") return [];
  return raw.split("|").map((s) => s.trim());
}

const SHARE_LINK_PASSWORD_MIN_LEN = 8;

function parsePinnedVersion(version: string, index: number): number {
  if (!/^\d+$/.test(version)) {
    console.error(`--versions entry ${index + 1} (${version}) is not a number`);
    process.exit(1);
  }
  return parseInt(version, 10);
}

export function applyPasswordFlag(
  body: Record<string, unknown>,
  password: unknown,
): void {
  if (password === undefined) return;
  const pw = String(password);
  // parseFlags reads a value starting with "-" as a missing value.
  if (pw === "") {
    console.error("--password needs a value (if it starts with \"-\", use --password=<pw>)");
    process.exit(1);
  }
  if (pw.length < SHARE_LINK_PASSWORD_MIN_LEN) {
    console.error("--password must be at least 8 characters");
    process.exit(1);
  }
  body.password = pw;
}

export function rejectRemovePasswordFlag(flags: Record<string, unknown>): void {
  if (flags["remove-password"] === undefined) return;
  console.error("--remove-password is no longer supported: share links must keep a password (set a new one with --password)");
  process.exit(1);
}

function applyExpiresDaysFlag(
  body: Record<string, unknown>,
  expiresDays: unknown,
): void {
  if (expiresDays === undefined) return;
  const days = parseInt(String(expiresDays), 10);
  if (Number.isNaN(days)) {
    console.error("--expires-days must be a number");
    process.exit(1);
  }
  body.expires_in_days = days;
}

function buildItemsArray(
  reportIds: string[],
  labelsRaw: string | undefined,
  versionsRaw: string | undefined,
): Array<Record<string, unknown>> {
  const labels = parsePipeList(labelsRaw);
  const versions = parsePipeList(versionsRaw);
  if (labels.length > 0 && labels.length !== reportIds.length) {
    console.error(
      `--labels has ${labels.length} entries but --reports has ${reportIds.length}`,
    );
    process.exit(1);
  }
  if (versions.length > 0 && versions.length !== reportIds.length) {
    console.error(
      `--versions has ${versions.length} entries but --reports has ${reportIds.length}`,
    );
    process.exit(1);
  }
  return reportIds.map((report_id, idx) => {
    const item: Record<string, unknown> = { report_id, sort_order: idx };
    const label = labels[idx];
    if (label) item.display_label = label;
    const version = versions[idx];
    if (version) {
      item.pinned_version = parsePinnedVersion(version, idx);
    }
    return item;
  });
}

function shareLinkPublicUrl(slug: string): string {
  const fe = process.env.DILLION_FRONTEND_URL?.replace(/\/+$/, "");
  if (fe) return `${fe}/share/${slug}`;
  return `/share/${slug}`;
}

// ─── create ──────────────────────────────────────────────────────────────

async function shareLinksCreate(args: string[]) {
  const { flags } = parseFlags(args);
  const projectId = await requireProjectId(
    flags,
    "Usage: dillion share-links create --project <id> --title <t> --reports <id1,id2,...> --password <pw>",
  );
  if (!flags.title) {
    console.error("--title is required");
    process.exit(1);
  }
  const reports = parseCommaList(
    typeof flags.reports === "string" ? flags.reports : undefined,
  );
  if (reports.length === 0) {
    console.error("--reports <id1,id2,...> is required (at least one report)");
    process.exit(1);
  }
  const portalOnly = flags.portal !== undefined;
  const audience = portalAudienceFlags(flags);
  if (portalOnly) {
    const conflicts = portalOnlyFlagConflicts(flags);
    if (conflicts.length > 0) {
      console.error(`--portal can't be combined with:\n  ${conflicts.join("\n  ")}`);
      process.exit(1);
    }
    if (audience.emails.length === 0 && audience.orgs.length === 0) {
      console.error("--portal needs at least one of --clients <emails> or --orgs <org-ids>");
      process.exit(1);
    }
  } else if (flags.password === undefined) {
    console.error(
      "--password <pw> is required (8+ chars): share links must be password-protected.\n" +
        "To skip the password, make a portal link instead: --portal --clients <emails> / --orgs <org-ids>",
    );
    process.exit(1);
  }
  if (audience.any && flags.versions) {
    console.error("--versions can't be used with portal access: portal links always show the latest version");
    process.exit(1);
  }
  if (audience.any && flags["no-citations"] !== undefined) {
    console.error(
      "--no-citations can't be combined with --clients/--orgs: portal viewers always see source previews",
    );
    process.exit(1);
  }
  const body: Record<string, unknown> = {
    title: String(flags.title),
    items: buildItemsArray(
      reports,
      typeof flags.labels === "string" ? flags.labels : undefined,
      typeof flags.versions === "string" ? flags.versions : undefined,
    ),
    allow_citation_excerpts: flags["no-citations"] === undefined,
  };
  if (flags.slug) body.slug = String(flags.slug);
  if (flags.description) body.description = String(flags.description);
  if (portalOnly) body.portal_only = true;
  applyPasswordFlag(body, flags.password);
  applyExpiresDaysFlag(body, flags["expires-days"]);
  const domains = parseCommaList(
    typeof flags.domains === "string" ? flags.domains : undefined,
  );
  const emails = parseCommaList(
    typeof flags.emails === "string" ? flags.emails : undefined,
  );
  if (domains.length > 0) body.allowed_email_domains = domains;
  if (emails.length > 0) body.allowed_emails = emails;

  const res = await api(
    `/projects/${encodeURIComponent(projectId)}/share-links`,
    { method: "POST", body },
  );
  const link = res.link;
  let grants: PortalGrants | undefined;
  if (audience.any) {
    const outcome = await grantPortalAccess(link.id, audience, flags["no-notify"] === undefined);
    if (!outcome.ok) {
      // Don't leave a half-built link: revoke it (a revoked link opens for
      // nobody, whatever was granted), then say exactly what happened.
      const revoke = revokeOutcome(
        await apiResult(`/share-links/${encodeURIComponent(link.id)}`, { method: "DELETE" }),
        link.id,
      );
      if (flags.json !== undefined) {
        // Callers parsing --json must be able to tell "revoked" from "still
        // live, revoke it yourself" without reading stderr.
        console.log(
          JSON.stringify(
            {
              error: outcome.message,
              granted: outcome.unconfirmed ? "unknown" : "no",
              link_id: link.id,
              revoked: revoke.revoked,
              ...(revoke.error ? { revoke_error: revoke.error } : {}),
            },
            null,
            2,
          ),
        );
      }
      console.error(
        outcome.unconfirmed
          ? `Couldn't confirm the portal grant (${outcome.message}). Access may have been granted and invites sent.`
          : `Portal access was refused: ${outcome.message}\nNothing was granted and nobody was emailed.`,
      );
      console.error(revoke.text);
      process.exit(1);
    }
    grants = outcome;
  }
  const portalUrl = audience.any ? await portalUrlFor(link.project_id, link.id) : undefined;
  if (flags.json !== undefined) {
    console.log(
      JSON.stringify(
        // link_id at the top level too, so scripts read the same key as portal-add.
        grants
          ? { link_id: link.id, ...res, portal_url: portalUrl, ...portalGrantJson(grants) }
          : { link_id: link.id, ...res },
        null,
        2,
      ),
    );
    return;
  }
  console.log(portalOnly ? "✓ Portal link created" : "✓ Share link created");
  console.log(`  id:        ${link.id}`);
  if (portalUrl) console.log(`  portal:    ${portalUrl}`);
  if (grants) printPortalGrants(grants);
  if (portalOnly) {
    console.log(`  reports:   ${link.item_count}`);
    return;
  }
  console.log(`  slug:      ${link.slug}`);
  console.log(`  url:       ${shareLinkPublicUrl(link.slug)}`);
  console.log(`  reports:   ${link.item_count}`);
  if (link.has_password) console.log("  password:  required");
  if (link.requires_email) {
    console.log(
      `  email:     allowlist (${(link.allowed_email_domains ?? []).length} domain(s), ${
        (link.allowed_emails ?? []).length
      } address(es))`,
    );
  }
  if (link.expires_at) console.log(`  expires:   ${link.expires_at}`);
}

// ─── list ────────────────────────────────────────────────────────────────

async function shareLinksList(args: string[]) {
  const { flags } = parseFlags(args);
  const projectId = await requireProjectId(
    flags,
    "Usage: dillion share-links list --project <id>",
  );
  const data = await api(
    `/projects/${encodeURIComponent(projectId)}/share-links`,
  );
  if (flags.json !== undefined) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (!Array.isArray(data) || data.length === 0) {
    console.log("(no share links)");
    return;
  }
  for (const l of data) {
    const status = l.revoked_at ? "revoked" : "active";
    const portal = `portal: ${l.client_count ?? 0} client(s), ${l.org_count ?? 0} org(s)`;
    if (l.portal_only) {
      console.log(`${l.id}  portal-only  (${l.item_count} reports)  ${status}  ${portal}`);
    } else {
      const pw = l.has_password ? "password" : "open";
      const email = l.requires_email ? "email-allowlist" : "no-allowlist";
      const exp = l.expires_at ? `expires ${l.expires_at.slice(0, 10)}` : "no expiry";
      console.log(
        `${l.id}  /share/${l.slug}  (${l.item_count} reports)  ${status}  ${pw}  ${email}  ${exp}  ${portal}`,
      );
    }
    console.log(`  title: ${l.title}`);
  }
}

// ─── get ─────────────────────────────────────────────────────────────────

const LINK_REF_HELP =
  "  <link> is the link id, its slug, its /share/<slug> URL, or its portal URL.";

/**
 * Load a share link from whatever identifies it (see parseShareLinkRef).
 * Exits with a usage error, or with the server's error, when it can't.
 */
async function loadShareLink(input: string | undefined, usage: string): Promise<any> {
  const parsed = input ? parseShareLinkRef(input) : null;
  if (!parsed) {
    console.error(`${usage}\n${LINK_REF_HELP}`);
    process.exit(1);
  }
  const res = await apiResult(`/share-links/${encodeURIComponent(parsed.ref)}`);
  if (res.ok) return res.data;
  if (parsed.kind === "slug" && /Invalid share link id/i.test(res.message)) {
    console.error(
      "This server can't look links up by slug yet. Use the link id instead (find it with: dillion share-links list -p <project-id>).",
    );
  } else if (parsed.kind === "slug" && /\b404\b|not found/i.test(res.message)) {
    console.error(
      `No share link "${parsed.ref}" in a project you can share from. If it's in another org, switch with: dillion org use <org>`,
    );
  } else {
    console.error(res.message);
  }
  process.exit(1);
}

async function shareLinksGet(args: string[]) {
  const { flags, positional } = parseFlags(args);
  const data = await loadShareLink(positional[0], "Usage: dillion share-links get <link>");
  if (flags.json !== undefined) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  console.log(data.portal_only ? `${data.id}  (portal-only)` : `${data.id}  /share/${data.slug}`);
  console.log(`  title:      ${data.title}`);
  if (data.description) console.log(`  description: ${data.description}`);
  console.log(`  project:    ${data.project_id}`);
  console.log(`  has_pw:     ${data.has_password}`);
  console.log(`  citations:  ${data.allow_citation_excerpts}`);
  console.log(`  email gate: ${data.requires_email ? "yes" : "no"}`);
  if (data.allowed_email_domains?.length) {
    console.log(`  domains:    ${data.allowed_email_domains.join(", ")}`);
  }
  if (data.allowed_emails?.length) {
    console.log(`  emails:     ${data.allowed_emails.join(", ")}`);
  }
  console.log(`  expires:    ${data.expires_at ?? "(never)"}`);
  console.log(`  revoked:    ${data.revoked_at ?? "no"}`);
  console.log(`  items:`);
  for (const item of data.items ?? []) {
    const pin = item.pinned_version ? `v${item.pinned_version}` : "latest";
    const label = item.display_label ? ` [${item.display_label}]` : "";
    console.log(`    ${item.report_id}  ${pin}  ${item.report_title}${label}`);
  }
  if (!data.portal_only) console.log(`  url:        ${shareLinkPublicUrl(data.slug)}`);
  if (data.portal_only || data.client_count || data.org_count) {
    console.log(`  portal:     ${await portalUrlFor(data.project_id, data.id)}`);
    console.log(`              ${data.client_count ?? 0} client(s), ${data.org_count ?? 0} org(s) — see share-links portal-list`);
  }
}

// ─── update ──────────────────────────────────────────────────────────────

async function shareLinksUpdate(args: string[]) {
  const { flags, positional } = parseFlags(args);
  const linkId = positional[0];
  if (!linkId) {
    console.error(
      "Usage: dillion share-links update <link-id> [options]\n" +
        "  Options: --title, --description, --slug, --password, --expires-days,\n" +
        "           --no-expiry, --no-citations, --allow-citations, --domains, --clear-domains,\n" +
        "           --emails, --clear-emails, --reports",
    );
    process.exit(1);
  }

  const noCitations = flags["no-citations"] !== undefined;
  const allowCitations = flags["allow-citations"] !== undefined;
  if (noCitations && allowCitations) {
    console.error("Cannot combine --no-citations and --allow-citations");
    process.exit(1);
  }
  const noExpiry = flags["no-expiry"] !== undefined;
  if (noExpiry && flags["expires-days"]) {
    console.error("Cannot combine --no-expiry and --expires-days");
    process.exit(1);
  }
  const clearDomains = flags["clear-domains"] !== undefined;
  if (clearDomains && flags.domains) {
    console.error("Cannot combine --clear-domains and --domains");
    process.exit(1);
  }
  const clearEmails = flags["clear-emails"] !== undefined;
  if (clearEmails && flags.emails) {
    console.error("Cannot combine --clear-emails and --emails");
    process.exit(1);
  }
  rejectRemovePasswordFlag(flags);

  const body: Record<string, unknown> = {};
  if (flags.title) body.title = String(flags.title);
  if (flags.description) body.description = String(flags.description);
  if (flags.slug) body.slug = String(flags.slug);
  applyPasswordFlag(body, flags.password);
  applyExpiresDaysFlag(body, flags["expires-days"]);
  if (noExpiry) body.clear_expiry = true;
  if (noCitations) body.allow_citation_excerpts = false;
  else if (allowCitations) body.allow_citation_excerpts = true;

  if (clearDomains) body.clear_allowed_email_domains = true;
  else if (flags.domains)
    body.allowed_email_domains = parseCommaList(String(flags.domains));
  if (clearEmails) body.clear_allowed_emails = true;
  else if (flags.emails)
    body.allowed_emails = parseCommaList(String(flags.emails));

  if (flags.reports) {
    const ids = parseCommaList(String(flags.reports));
    if (ids.length === 0) {
      console.error("--reports requires at least one id");
      process.exit(1);
    }
    body.items = buildItemsArray(
      ids,
      typeof flags.labels === "string" ? flags.labels : undefined,
      typeof flags.versions === "string" ? flags.versions : undefined,
    );
  } else if (flags.labels || flags.versions) {
    console.error("--labels and --versions require --reports");
    process.exit(1);
  }

  if (Object.keys(body).length === 0) {
    console.error("No changes specified");
    process.exit(1);
  }

  const data = await api(`/share-links/${encodeURIComponent(linkId)}`, {
    method: "PATCH",
    body,
  });
  if (flags.json !== undefined) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  console.log("✓ Share link updated");
  console.log(`  slug:      ${data.slug}`);
  console.log(`  url:       ${shareLinkPublicUrl(data.slug)}`);
  console.log(`  has_pw:    ${data.has_password}`);
  console.log(`  citations: ${data.allow_citation_excerpts}`);
  console.log(`  expires:   ${data.expires_at ?? "(never)"}`);
}

// ─── revoke ──────────────────────────────────────────────────────────────

async function shareLinksRevoke(args: string[]) {
  const { flags, positional } = parseFlags(args);
  const linkId = positional[0];
  if (!linkId) {
    console.error("Usage: dillion share-links revoke <link-id>");
    process.exit(1);
  }
  const data = await api(`/share-links/${encodeURIComponent(linkId)}`, {
    method: "DELETE",
  });
  if (flags.json !== undefined) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  console.log(`✓ Revoked ${linkId}`);
}

// ─── portal access ───────────────────────────────────────────────────────

interface PortalAudience {
  emails: string[];
  orgs: string[];
  any: boolean;
}

/** --clients (emails) and --orgs (org ids only); exits on a missing value or an org name. */
function portalAudienceFlags(flags: Record<string, string | undefined>): PortalAudience {
  for (const f of ["clients", "orgs"]) {
    if (flags[f] === "") {
      console.error(`--${f} needs a value`);
      process.exit(1);
    }
  }
  const emails = parseCommaList(flags.clients).map((e) => e.toLowerCase());
  const { ids, notIds } = parseOrgIds(flags.orgs);
  if (notIds.length > 0) {
    console.error(
      `--orgs takes org ids (org_…), not names: ${notIds.join(", ")}\n` +
        "Org names aren't unique. Find the id with: dillion share-links portal-orgs <name>",
    );
    process.exit(1);
  }
  return { emails: [...new Set(emails)], orgs: ids, any: emails.length > 0 || ids.length > 0 };
}

interface PortalGrants {
  ok: true;
  clients: any[];
  orgs: any[];
  invitedEmails: string[];
  /** Invites the server couldn't send (the grant itself still stands). */
  failedEmails: string[];
  emailResults: any[];
  notifiedOrgMembers: number;
  notifyOrgErrors: string[];
}

/** The email/notify fields of a grant, as they appear in --json output. */
/**
 * What the clean-up revoke after a failed portal grant achieved. A DELETE that
 * got a 5xx or no reply may still have gone through, so it's "unknown", not false.
 */
export function revokeOutcome(
  r: { ok: true } | { ok: false; message: string; unconfirmed: boolean },
  linkId: string,
): { revoked: true | false | "unknown"; error?: string; text: string } {
  if (r.ok) {
    return { revoked: true, text: `The new link ${linkId} was revoked, so nobody can open it.` };
  }
  if (r.unconfirmed) {
    return {
      revoked: "unknown",
      error: r.message,
      text: `Couldn't confirm the new link was revoked (${r.message}). Check with: dillion share-links get ${linkId}, and revoke it if it's still active: dillion share-links revoke ${linkId}`,
    };
  }
  return {
    revoked: false,
    error: r.message,
    text: `Revoking the new link failed too (${r.message}). Revoke it yourself: dillion share-links revoke ${linkId}`,
  };
}

function portalGrantJson(g: PortalGrants) {
  return {
    clients: g.clients,
    orgs: g.orgs,
    email_results: g.emailResults,
    notified_count: g.notifiedOrgMembers,
    notify_org_errors: g.notifyOrgErrors,
  };
}

type PortalGrantOutcome = PortalGrants | { ok: false; message: string; unconfirmed: boolean };

/**
 * One server call. The server accepts EXISTING clients and orgs only, checks
 * everything before writing, grants all of it in one transaction and emails
 * only after that commit, so an HTTP error means nothing was granted or sent.
 */
async function grantPortalAccess(
  linkId: string,
  audience: PortalAudience,
  notify: boolean,
): Promise<PortalGrantOutcome> {
  const r = await apiResult(`/share-links/${encodeURIComponent(linkId)}/portal-access`, {
    method: "POST",
    body: { emails: audience.emails, org_ids: audience.orgs, notify },
  });
  if (!r.ok) return r;
  if (typeof r.data !== "object" || !Array.isArray(r.data.clients) || !Array.isArray(r.data.orgs)) {
    return { ok: false, unconfirmed: true, message: "unexpected response" };
  }
  const emailResults: any[] = Array.isArray(r.data.email_results) ? r.data.email_results : [];
  return {
    ok: true,
    clients: r.data.clients,
    orgs: r.data.orgs,
    invitedEmails: emailResults.filter((e) => e.email_sent).map((e) => e.email),
    failedEmails: emailResults.filter((e) => !e.email_sent).map((e) => e.email),
    emailResults,
    notifiedOrgMembers: r.data.notified_count ?? 0,
    notifyOrgErrors: r.data.notify_org_errors ?? [],
  };
}

function printPortalGrants(g: PortalGrants) {
  const liveClients = g.clients.filter((c) => !c.revoked_at);
  const liveOrgs = g.orgs.filter((o) => !o.revoked_at);
  if (liveClients.length > 0) {
    console.log(`  clients:   ${liveClients.map((c) => c.email).join(", ")}`);
  }
  if (liveOrgs.length > 0) {
    console.log(`  orgs:      ${liveOrgs.map((o) => `${o.name} (${o.org_id})`).join(", ")}`);
  }
  if (g.invitedEmails.length > 0) {
    console.log(`  emailed:   ${g.invitedEmails.join(", ")}`);
  }
  if (g.notifiedOrgMembers > 0) {
    console.log(`  emailed:   ${g.notifiedOrgMembers} org member(s)`);
  }
  if (g.failedEmails.length > 0) {
    console.log(
      `  warning:   couldn't email ${g.failedEmails.join(", ")}. Their access is granted; ` +
        "send them the portal link yourself.",
    );
  }
  if (g.notifyOrgErrors.length > 0) {
    console.log(`  warning:   couldn't email members of ${g.notifyOrgErrors.join(", ")}`);
  }
}

async function portalUrlFor(projectId: string, linkId: string): Promise<string> {
  const base = portalBaseUrl(await apiBaseUrl(), process.env.DILLION_PORTAL_URL);
  return portalBundleUrl(base, projectId, linkId);
}

async function shareLinksPortalAdd(args: string[]) {
  const { flags, positional } = parseFlags(args);
  const linkId = positional[0];
  const audience = portalAudienceFlags(flags);
  const portalAddUsage =
    "Usage: dillion share-links portal-add <link> [--clients a@x.com,b@y.com] [--orgs org_…,org_…] [--no-notify]\n" +
    "  At least one of --clients / --orgs. Only existing portal clients and orgs are accepted.";
  if (!linkId || !audience.any) {
    console.error(`${portalAddUsage}\n${LINK_REF_HELP}`);
    process.exit(1);
  }
  if (flags["no-citations"] !== undefined) {
    console.error(
      "--no-citations can't be combined with portal access: portal viewers always see source previews.\n" +
        "Nothing was granted.",
    );
    process.exit(1);
  }
  const link = await loadShareLink(linkId, portalAddUsage);
  if (link.revoked_at) {
    console.error(`Link ${link.id} is revoked; nobody can open it. Create a new link instead.`);
    process.exit(1);
  }
  // Portal viewers always get each report's latest version, so a link with
  // pinned versions can't take portal access (the server refuses it too).
  const pinned = (link.items ?? []).filter((i: any) => i.pinned_version != null);
  if (pinned.length > 0) {
    console.error(
      `This link pins ${pinned.length} report(s) to a version, but portal viewers always see the latest.\n` +
        `Nothing was granted. Unpin them first: dillion share-links update ${link.id} --reports <ids> (without --versions)`,
    );
    process.exit(1);
  }
  // Checked BEFORE granting: portal viewers always see source previews, so on
  // a link that has them off, granting would show what the analyst hid.
  const warnings: string[] = [];
  if (link.allow_citation_excerpts === false) {
    const msg =
      "This link has source previews turned off, but portal viewers always see them.";
    if (flags["with-previews"] === undefined) {
      console.error(
        `${msg}\nNothing was granted. To grant anyway, re-run with --with-previews; or turn previews ` +
          `on for everyone with: dillion share-links update ${link.id} --allow-citations`,
      );
      process.exit(1);
    }
    warnings.push(`${msg} Granted anyway (--with-previews).`);
  }
  const grants = await grantPortalAccess(link.id, audience, flags["no-notify"] === undefined);
  if (!grants.ok) {
    if (flags.json !== undefined) {
      console.log(
        JSON.stringify(
          { error: grants.message, granted: grants.unconfirmed ? "unknown" : "no", link_id: link.id },
          null,
          2,
        ),
      );
    }
    console.error(
      grants.unconfirmed
        ? `Couldn't confirm the portal grant (${grants.message}). Check with: dillion share-links portal-list ${link.id}`
        : `Portal access was refused: ${grants.message}\nNothing was granted and nobody was emailed.`,
    );
    process.exit(1);
  }
  const portalUrl = await portalUrlFor(link.project_id, link.id);
  if (flags.json !== undefined) {
    console.log(
      JSON.stringify(
        { link_id: link.id, portal_url: portalUrl, ...portalGrantJson(grants), warnings },
        null,
        2,
      ),
    );
    return;
  }
  console.log("✓ Portal access updated");
  console.log(`  link:      ${link.id}  ${link.title}`);
  console.log(`  portal:    ${portalUrl}`);
  printPortalGrants(grants);
  for (const w of warnings) console.log(`  warning:   ${w}`);
}

async function shareLinksPortalList(args: string[]) {
  const { flags, positional } = parseFlags(args);
  // The roster routes need the id, so resolve a slug or URL first.
  const link = await loadShareLink(positional[0], "Usage: dillion share-links portal-list <link>");
  const id = encodeURIComponent(link.id);
  const [clients, orgs] = await Promise.all([
    api(`/share-links/${id}/clients`),
    api(`/share-links/${id}/orgs`),
  ]);
  const portalUrl = await portalUrlFor(link.project_id, link.id);
  if (flags.json !== undefined) {
    console.log(
      JSON.stringify(
        {
          link_id: link.id,
          revoked_at: link.revoked_at ?? null,
          portal_url: portalUrl,
          clients: clients.clients,
          orgs: orgs.orgs,
        },
        null,
        2,
      ),
    );
    return;
  }
  console.log(
    `${link.id}  ${link.title}${link.portal_only ? "  (portal-only)" : ""}${link.revoked_at ? "  REVOKED" : ""}`,
  );
  console.log(`  portal:    ${portalUrl}${link.revoked_at ? "  (doesn't open: link revoked)" : ""}`);
  for (const line of describePortalAccess(link, clients.clients ?? [], orgs.orgs ?? [])) console.log(line);
}

async function shareLinksPortalOrgs(args: string[]) {
  const { flags, positional } = parseFlags(args);
  const query = positional.join(" ").trim();
  if (!query) {
    console.error(
      "Usage: dillion share-links portal-orgs <name> [--limit N] [--json]\n" +
        "  Case-insensitive name search over existing client orgs; prints the org ids for --orgs.",
    );
    process.exit(1);
  }
  let limit = 20;
  if (flags.limit !== undefined) {
    limit = parseInt(String(flags.limit), 10);
    if (Number.isNaN(limit) || limit < 1 || limit > 200) {
      console.error("--limit must be a number from 1 to 200");
      process.exit(1);
    }
  }
  const orgs: ClientOrgSummary[] = await api(
    `/client-orgs?q=${encodeURIComponent(query)}&limit=${limit}`,
  );
  if (flags.json !== undefined) {
    console.log(JSON.stringify(orgs, null, 2));
    return;
  }
  if (orgs.length === 0) {
    console.log(`(no client orgs match "${query}")`);
    return;
  }
  for (const row of formatOrgRows(orgs)) console.log(row);
  if (orgs.length === limit) console.log(`(showing the first ${limit}; narrow the name or raise --limit)`);
}
