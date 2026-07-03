import { loadConfig, saveConfig, CONFIG_DIR, type Config } from "../config";
import { mkdirSync } from "fs";

interface OrgEntry {
  id: string;
  name: string;
  role: string;
}

export interface AuthOutcome {
  /** Config to persist. */
  config: Config;
  /** stdout lines to print in order. */
  lines: string[];
}

/**
 * Decide what to save and print after a successful `GET /orgs` validation. Pure so the
 * three membership cases are unit-testable without network/fs/process.exit.
 *
 * - one org  -> auto-select it.
 * - many     -> do not auto-select, but keep a still-valid prior selection across re-auth;
 *               otherwise print the list and the `org use` hint.
 * - zero     -> save creds anyway and warn.
 */
export function buildAuthOutcome(
  apiKey: string,
  server: string,
  orgs: OrgEntry[],
  previous: Config | null,
  serverExplicit: boolean
): AuthOutcome {
  const config: Config = {
    apiKey,
    baseUrl: server,
    ...(previous?.projectId ? { projectId: previous.projectId } : {}),
  };
  const lines: string[] = ["Authenticated successfully."];
  if (serverExplicit) lines.push(`Server: ${server}`);

  if (orgs.length === 1) {
    config.orgId = orgs[0]!.id;
    lines.push(`Organization: ${orgs[0]!.name}`);
  } else if (orgs.length > 1) {
    if (previous?.orgId && orgs.some((o) => o.id === previous.orgId)) {
      config.orgId = previous.orgId;
    }
    lines.push(`You belong to ${orgs.length} organizations:`);
    for (const o of orgs) {
      const marker = o.id === config.orgId ? "* " : "  ";
      lines.push(`${marker}${o.name}  (${o.id})`);
    }
    lines.push(
      config.orgId
        ? `Active: ${config.orgId}. Change it with: dillion org use <org-id-or-name>`
        : "Select one with: dillion org use <org-id-or-name>  (or pass --org-id per command)"
    );
  } else {
    lines.push("Key is valid but you belong to no organization; contact your admin.");
  }

  return { config, lines };
}

export async function authCommand(args: string[]) {
  const apiKey = args[0];
  const baseUrl = args.find((a) => a.startsWith("--url="))?.split("=")[1];

  if (!apiKey || apiKey.startsWith("--")) {
    console.error("Usage: dillion auth <api-key> [--url=https://...]");
    process.exit(1);
  }

  const server = baseUrl || "https://bastion.dillion.ai";

  // Validate the key against a direct (pre-org-selection) route and learn the memberships.
  const res = await fetch(`${server}/orgs`, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  }).catch(() => null);

  if (!res) {
    console.error("Server unreachable.");
    process.exit(1);
  }
  if (res.status === 401 || res.status === 403) {
    console.error("Invalid API key.");
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`Server error (${res.status}). Try again.`);
    process.exit(1);
  }

  const data = (await res.json().catch(() => null)) as { orgs?: OrgEntry[] } | null;
  const orgs = data?.orgs ?? [];

  mkdirSync(CONFIG_DIR, { recursive: true });

  const previous = await loadConfig();
  const { config, lines } = buildAuthOutcome(apiKey, server, orgs, previous, !!baseUrl);
  await saveConfig(config);

  for (const line of lines) console.log(line);
}
