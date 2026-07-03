import { api } from "../api";
import { loadConfig, saveConfig } from "../config";
import { parseFlags } from "../flags";

const ORG_HELP = `
Usage: dillion org <command>

  list               List organizations you belong to (marks the active one)
  use <id-or-name>   Set the active organization (saved for later commands)
  show               Print the active organization, if any
  clear              Remove the saved active organization

The active org is sent as X-Dillion-Org-Id on every request. Override it for a
single command with the global --org-id <org_...> flag.
`.trim();

export interface OrgEntry {
  id: string;
  name: string;
  role: string;
}

/**
 * Resolve a user-supplied org selector (id or name) against the membership list.
 * Exact id wins; then case-insensitive exact name; then case-insensitive substring.
 * More than one match at whichever tier is ambiguous.
 */
export function resolveOrgSelector(
  orgs: OrgEntry[],
  selector: string
): { org?: OrgEntry; ambiguous?: OrgEntry[]; notFound?: boolean } {
  const sel = selector.trim();
  const byId = orgs.find((o) => o.id === sel);
  if (byId) return { org: byId };

  const lower = sel.toLowerCase();
  const exact = orgs.filter((o) => o.name.toLowerCase() === lower);
  const matches =
    exact.length > 0 ? exact : orgs.filter((o) => o.name.toLowerCase().includes(lower));

  if (matches.length === 1) return { org: matches[0] };
  if (matches.length > 1) return { ambiguous: matches };
  return { notFound: true };
}

async function fetchOrgs(): Promise<OrgEntry[]> {
  const data = (await api("/orgs")) as { orgs?: OrgEntry[] } | null;
  return data?.orgs ?? [];
}

export async function orgListCommand(args: string[]) {
  const { flags } = parseFlags(args);
  if (flags.help === "" || flags.h === "") {
    console.log(ORG_HELP);
    return;
  }

  const json = flags.json !== undefined;
  const cfg = await loadConfig();
  const orgs = await fetchOrgs();

  if (json) {
    console.log(JSON.stringify({ orgs }, null, 2));
    return;
  }

  if (orgs.length === 0) {
    console.log("You don't belong to any organization yet.");
    return;
  }

  const selected = cfg?.orgId;
  console.log(`${orgs.length} organization(s)\n`);
  for (const o of orgs) {
    const marker = o.id === selected ? "* " : "  ";
    console.log(`${marker}${o.name}  (${o.role})`);
    console.log(`    ${o.id}`);
    console.log();
  }
}

export async function orgUseCommand(args: string[]) {
  const { flags, positional } = parseFlags(args);
  if (flags.help === "" || flags.h === "") {
    console.log(ORG_HELP);
    return;
  }

  // Join all positionals so an unquoted multi-word name (e.g. `dillion org use Beta LLC`)
  // resolves against the exact-name tier instead of truncating to the first word.
  const selector = positional.join(" ").trim();
  if (!selector || selector.startsWith("--")) {
    console.error("Usage: dillion org use <org-id-or-name>");
    process.exit(1);
  }

  const cfg = await loadConfig();
  if (!cfg) {
    console.error("Not logged in. Run: dillion auth <api-key>");
    process.exit(1);
  }

  const orgs = await fetchOrgs();
  const result = resolveOrgSelector(orgs, selector);

  if (result.ambiguous) {
    console.error(`"${selector}" matches multiple organizations:`);
    for (const o of result.ambiguous) console.error(`  ${o.name}  (${o.id})`);
    console.error("Re-run with the exact org id.");
    process.exit(1);
  }
  if (!result.org) {
    console.error(`No organization matches "${selector}". Run: dillion org list`);
    process.exit(1);
  }

  await saveConfig({ ...cfg, orgId: result.org.id });
  console.log(`Active organization set to ${result.org.name} (${result.org.id})`);
}

export async function orgShowCommand() {
  const cfg = await loadConfig();
  if (!cfg) {
    console.error("Not logged in. Run: dillion auth <api-key>");
    process.exit(1);
  }
  if (cfg.orgId) {
    console.log(cfg.orgId);
  } else {
    console.log("No active organization. Run: dillion org use <org-id-or-name>");
  }
}

export async function orgClearCommand() {
  const cfg = await loadConfig();
  if (!cfg) {
    console.error("Not logged in. Run: dillion auth <api-key>");
    process.exit(1);
  }
  const { orgId, ...rest } = cfg;
  await saveConfig(rest);
  console.log("Active organization cleared.");
}
