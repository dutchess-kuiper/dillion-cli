import { api } from "../api";
import { parseFlags } from "../flags";
import { requireProjectId } from "../projectContext";

const SHARE_LINKS_HELP = `
Usage: dillion share-links <command> [options]

Commands:
  create -p <pid> --title <t> --reports <id1,id2,...>
                                Create a multi-artifact share link
    [--slug <slug>]             Custom slug (defaults to slugified title)
    [--description <text>]      One-line context shown above the tabs
    [--labels "Q3 FDD|Cap Table|"]
                                Tab labels (| separated, aligned with --reports;
                                empty entry = use report title)
    [--versions "1||3"]         Pinned versions per report (| separated; empty
                                entry = always latest)
    [--password <pw>]           Set password (8+ chars)
    [--expires-days <N>]        Expire N days from now (1-365)
    [--no-citations]            Disable source-document preview (default: on)
    [--domains a.com,b.co]      Restrict to allowed email domains
    [--emails a@x.com,b@y.com]  Restrict to specific allowed emails
    [--json]                    Raw JSON output

  list -p <pid>                 List share links for a project
  get <link-id>                 Show a share link and its items
  update <link-id> [options]    Change slug, password, allowlist, expiry, etc.
    [--title <t>]               Rename
    [--description <text>]      Update description
    [--slug <slug>]             Change URL slug
    [--password <pw>]           New password (8+ chars)
    [--remove-password]         Remove password
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
      const n = parseInt(version, 10);
      if (Number.isNaN(n)) {
        console.error(`--versions entry ${idx + 1} (${version}) is not a number`);
        process.exit(1);
      }
      item.pinned_version = n;
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
    "Usage: dillion share-links create --project <id> --title <t> --reports <id1,id2,...>",
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
  if (flags.password) body.password = String(flags.password);
  if (flags["expires-days"]) {
    body.expires_in_days = parseInt(String(flags["expires-days"]), 10);
  }
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
  if (flags.json !== undefined) {
    console.log(JSON.stringify(res, null, 2));
    return;
  }
  const link = res.link;
  console.log("✓ Share link created");
  console.log(`  id:        ${link.id}`);
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
    const pw = l.has_password ? "password" : "open";
    const email = l.requires_email ? "email-allowlist" : "no-allowlist";
    const exp = l.expires_at ? `expires ${l.expires_at.slice(0, 10)}` : "no expiry";
    console.log(
      `${l.id}  /share/${l.slug}  (${l.item_count} reports)  ${status}  ${pw}  ${email}  ${exp}`,
    );
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
  console.log(`${data.id}  /share/${data.slug}`);
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
  console.log(`  url:        ${shareLinkPublicUrl(data.slug)}`);
}

// ─── update ──────────────────────────────────────────────────────────────

async function shareLinksUpdate(args: string[]) {
  const { flags, positional } = parseFlags(args);
  const linkId = positional[0];
  if (!linkId) {
    console.error(
      "Usage: dillion share-links update <link-id> [options]\n" +
        "  Options: --title, --description, --slug, --password, --remove-password, --expires-days,\n" +
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
  const removePassword = flags["remove-password"] !== undefined;
  if (removePassword && flags.password) {
    console.error("Cannot combine --password and --remove-password");
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

  const body: Record<string, unknown> = {};
  if (flags.title) body.title = String(flags.title);
  if (flags.description) body.description = String(flags.description);
  if (flags.slug) body.slug = String(flags.slug);
  if (flags.password) body.password = String(flags.password);
  if (removePassword) body.remove_password = true;
  if (flags["expires-days"]) {
    body.expires_in_days = parseInt(String(flags["expires-days"]), 10);
  }
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
