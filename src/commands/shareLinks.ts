import { api, apiBaseUrl, apiResult } from "../api";
import {
  looksLikeOrgId,
  pickExistingClient,
  pickExistingOrg,
  portalBaseUrl,
  portalBundleUrl,
  portalOnlyFlagConflicts,
  type ClientOrgSummary,
  type ClientUserSuggestion,
} from "../portal";
import { parseFlags } from "../flags";
import { requireProjectId } from "../projectContext";

const SHARE_LINKS_HELP = `
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

  create -p <pid> --title <t> --reports <ids> --portal --clients <emails> --orgs <names|ids>
                                Create a PORTAL link (portal.dillion.ai): no password; the
                                listed people/orgs open it after signing in to the portal
    --portal                    Portal-only: no public /share URL, no password
    [--clients a@x.com,b@y.com] Existing portal clients to give access (exact emails)
    [--orgs "Acme Corp,org_…"]  Existing client orgs (exact name or org id; every member
                                gets access)
    [--no-notify]               Don't email org members (client invites always email)
                                At least one of --clients / --orgs is required. Only EXISTING
                                clients and orgs are accepted — invite new people from the
                                VDR web app. --clients/--orgs also work without --portal
                                (link keeps its password-protected /share URL too).

  portal-add <link-id> [--clients <emails>] [--orgs <names|ids>] [--no-notify]
                                Give existing portal clients / orgs access to a link
  portal-list <link-id>         Show who can open a link on the portal, plus its portal URL

  list -p <pid>                 List share links for a project
  get <link-id>                 Show a share link and its items
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
      console.error("--portal needs at least one of --clients <emails> or --orgs <names|ids>");
      process.exit(1);
    }
  } else if (flags.password === undefined) {
    console.error(
      "--password <pw> is required (8+ chars): share links must be password-protected.\n" +
        "To skip the password, make a portal link instead: --portal --clients <emails> / --orgs <names>",
    );
    process.exit(1);
  }
  if (audience.any && flags.versions) {
    console.error("--versions can't be used with portal access: portal links always show the latest version");
    process.exit(1);
  }
  // Resolve before creating anything, so an unknown person/org leaves no link behind.
  const resolved = await resolvePortalAudience(audience);
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
    const outcome = await attachPortalAudience(link.id, resolved, flags["no-notify"] === undefined);
    if (!outcome.ok) {
      // Don't leave a half-built link: revoke it, then report why.
      await apiResult(`/share-links/${encodeURIComponent(link.id)}`, { method: "DELETE" });
      console.error(`${outcome.message}\nThe new link was revoked; nothing was shared.`);
      process.exit(1);
    }
    grants = outcome;
  }
  const portalUrl = audience.any ? await portalUrlFor(link.project_id, link.id) : undefined;
  if (flags.json !== undefined) {
    console.log(
      JSON.stringify(
        grants ? { ...res, portal_url: portalUrl, clients: grants.clients, orgs: grants.orgs } : res,
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

async function shareLinksGet(args: string[]) {
  const { flags, positional } = parseFlags(args);
  const linkId = positional[0];
  if (!linkId) {
    console.error("Usage: dillion share-links get <link-id>");
    process.exit(1);
  }
  const data = await api(`/share-links/${encodeURIComponent(linkId)}`);
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

function portalAudienceFlags(flags: Record<string, string | undefined>): PortalAudience {
  for (const f of ["clients", "orgs"]) {
    if (flags[f] === "") {
      console.error(`--${f} needs a value`);
      process.exit(1);
    }
  }
  const emails = parseCommaList(flags.clients);
  // Org names can contain spaces, so split on commas only.
  const orgs = (flags.orgs ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return { emails, orgs, any: emails.length > 0 || orgs.length > 0 };
}

interface ResolvedAudience {
  clients: ClientUserSuggestion[];
  orgIds: string[];
}

/** Map every --clients email / --orgs entry to an EXISTING record, or exit. */
async function resolvePortalAudience(audience: PortalAudience): Promise<ResolvedAudience> {
  const errors: string[] = [];
  const clients: ClientUserSuggestion[] = [];
  for (const email of audience.emails) {
    const results: ClientUserSuggestion[] = await api(
      `/client-users?q=${encodeURIComponent(email)}&limit=25`,
    );
    const r = pickExistingClient(email, results);
    if (r.ok) clients.push(r.value);
    else errors.push(r.message);
  }
  const orgIds: string[] = [];
  for (const org of audience.orgs) {
    // An org id can't be looked up by search; the attach route 404s an unknown
    // one, and create revokes the link if that happens.
    if (looksLikeOrgId(org)) {
      orgIds.push(org);
      continue;
    }
    const results: ClientOrgSummary[] = await api(
      `/client-orgs?q=${encodeURIComponent(org)}&limit=50`,
    );
    const r = pickExistingOrg(org, results);
    if (r.ok) orgIds.push(r.value.org_id);
    else errors.push(r.message);
  }
  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  return { clients, orgIds: [...new Set(orgIds)] };
}

interface PortalGrants {
  ok: true;
  clients: any[];
  orgs: any[];
  invitedEmails: string[];
  notifiedOrgMembers: number;
  notifyOrgErrors: string[];
}

type PortalGrantOutcome = PortalGrants | { ok: false; message: string };

async function attachPortalAudience(
  linkId: string,
  resolved: ResolvedAudience,
  notifyOrgs: boolean,
): Promise<PortalGrantOutcome> {
  const id = encodeURIComponent(linkId);
  let clients: any[] = [];
  let orgs: any[] = [];
  let invitedEmails: string[] = [];
  let notifiedOrgMembers = 0;
  let notifyOrgErrors: string[] = [];
  // Orgs first: an org passed by id is only checked here (404 if unknown), and a
  // failed attach writes nothing and emails nobody. Clients are already known to
  // exist, so attaching them second means a bad org id never leaves invite
  // emails pointing at a link that create then revokes.
  if (resolved.orgIds.length > 0) {
    const r = await apiResult(`/share-links/${id}/orgs`, {
      method: "POST",
      body: { org_ids: resolved.orgIds, notify: notifyOrgs },
    });
    if (!r.ok) return { ok: false, message: `Adding orgs failed: ${r.message}` };
    orgs = r.data.orgs ?? [];
    notifiedOrgMembers = r.data.notified_count ?? 0;
    notifyOrgErrors = r.data.notify_org_errors ?? [];
  }
  if (resolved.clients.length > 0) {
    const r = await apiResult(`/share-links/${id}/clients`, {
      method: "POST",
      body: { emails: resolved.clients.map((c) => c.email) },
    });
    if (!r.ok) return { ok: false, message: `Adding clients failed: ${r.message}` };
    clients = r.data.clients ?? [];
    invitedEmails = (r.data.email_results ?? [])
      .filter((e: any) => e.email_sent)
      .map((e: any) => e.email);
  }
  return { ok: true, clients, orgs, invitedEmails, notifiedOrgMembers, notifyOrgErrors };
}

function printPortalGrants(g: PortalGrants) {
  const liveClients = g.clients.filter((c) => !c.revoked_at);
  const liveOrgs = g.orgs.filter((o) => !o.revoked_at);
  if (liveClients.length > 0) {
    console.log(`  clients:   ${liveClients.map((c) => c.email).join(", ")}`);
  }
  if (liveOrgs.length > 0) {
    console.log(`  orgs:      ${liveOrgs.map((o) => o.name).join(", ")}`);
  }
  if (g.invitedEmails.length > 0) {
    console.log(`  emailed:   ${g.invitedEmails.join(", ")}`);
  }
  if (g.notifiedOrgMembers > 0) {
    console.log(`  emailed:   ${g.notifiedOrgMembers} org member(s)`);
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
  if (!linkId || !audience.any) {
    console.error(
      "Usage: dillion share-links portal-add <link-id> [--clients a@x.com,b@y.com] [--orgs \"Acme Corp,org_…\"] [--no-notify]\n" +
        "  At least one of --clients / --orgs. Only existing portal clients and orgs are accepted.",
    );
    process.exit(1);
  }
  const link = await api(`/share-links/${encodeURIComponent(linkId)}`);
  const resolved = await resolvePortalAudience(audience);
  const grants = await attachPortalAudience(link.id, resolved, flags["no-notify"] === undefined);
  if (!grants.ok) {
    console.error(grants.message);
    process.exit(1);
  }
  const portalUrl = await portalUrlFor(link.project_id, link.id);
  if (flags.json !== undefined) {
    console.log(JSON.stringify({ link_id: link.id, portal_url: portalUrl, clients: grants.clients, orgs: grants.orgs }, null, 2));
    return;
  }
  console.log("✓ Portal access updated");
  console.log(`  link:      ${link.id}  ${link.title}`);
  console.log(`  portal:    ${portalUrl}`);
  printPortalGrants(grants);
}

async function shareLinksPortalList(args: string[]) {
  const { flags, positional } = parseFlags(args);
  const linkId = positional[0];
  if (!linkId) {
    console.error("Usage: dillion share-links portal-list <link-id>");
    process.exit(1);
  }
  const id = encodeURIComponent(linkId);
  const [link, clients, orgs] = await Promise.all([
    api(`/share-links/${id}`),
    api(`/share-links/${id}/clients`),
    api(`/share-links/${id}/orgs`),
  ]);
  const portalUrl = await portalUrlFor(link.project_id, link.id);
  if (flags.json !== undefined) {
    console.log(JSON.stringify({ link_id: link.id, portal_url: portalUrl, clients: clients.clients, orgs: orgs.orgs }, null, 2));
    return;
  }
  console.log(`${link.id}  ${link.title}${link.portal_only ? "  (portal-only)" : ""}`);
  console.log(`  portal:    ${portalUrl}`);
  const liveClients = (clients.clients ?? []).filter((c: any) => !c.revoked_at);
  const liveOrgs = (orgs.orgs ?? []).filter((o: any) => !o.revoked_at);
  console.log(`  clients (${liveClients.length}):`);
  for (const c of liveClients) {
    const name = c.full_name ? `${c.full_name} <${c.email}>` : c.email;
    console.log(`    ${name}${c.has_logged_in ? "" : "  (hasn't signed in yet)"}`);
  }
  console.log(`  orgs (${liveOrgs.length}):`);
  for (const o of liveOrgs) console.log(`    ${o.name}  ${o.org_id}`);
}
