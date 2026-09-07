#!/usr/bin/env bun

export const VERSION = "0.1.24";

const SKIP_UPDATE_CHECK = new Set(["auth", "update", "version", "--version", "-v", "help", "--help", "-h"]);

import { homedir } from "os";
import { join } from "path";
import { loadConfig } from "./config";
import { classifyOrgIdFlag, looksLikeOrgId, resolveOrgOverride, setOrgOverride } from "./orgContext";

const UPDATE_CHECK_FILE = join(homedir(), ".config", "dillion", "last_update_check");
const CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

async function checkForUpdate(command: string | undefined) {
  if (command && SKIP_UPDATE_CHECK.has(command)) return;

  // Only check once per day
  try {
    const file = Bun.file(UPDATE_CHECK_FILE);
    if (await file.exists()) {
      const lastCheck = parseInt(await file.text());
      if (Date.now() - lastCheck < CHECK_INTERVAL) return;
    }
  } catch { }

  try {
    const res = await fetch("https://api.github.com/repos/dutchess-kuiper/dillion-cli/releases/latest", {
      headers: { Accept: "application/vnd.github.v3+json" },
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return;
    const data = await res.json() as { tag_name?: string };
    const latest = data.tag_name?.replace(/^v/, "");

    await Bun.write(UPDATE_CHECK_FILE, String(Date.now()));

    if (latest && latest !== VERSION) {
      console.error(`\nUpdate available: ${VERSION} → ${latest}  (run 'dillion update')`);
    }
  } catch {
    // silently ignore
  }
}

/**
 * Pull the global --org-id flag out of the arg list before dispatch so it works in any
 * position and no per-command parser has to know about it. Supports "--org-id <v>" and
 * "--org-id=<v>". Returns undefined when the flag is absent, and "" when it is present with
 * no value (a trailing "--org-id", "--org-id=", or "--org-id" followed by another flag).
 * That distinction matters: applyOrgOverride rejects the present-but-empty case as a usage
 * error rather than silently falling back to the saved org.
 */
function stripOrgIdFlag(argv: string[]): { orgIdFlag: string | undefined; args: string[] } {
  const out: string[] = [];
  let orgIdFlag: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--org-id") {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        orgIdFlag = next;
        i++;
      } else {
        orgIdFlag = "";
      }
      continue;
    }
    if (a.startsWith("--org-id=")) {
      orgIdFlag = a.slice("--org-id=".length);
      continue;
    }
    out.push(a);
  }
  return { orgIdFlag, args: out };
}

const { orgIdFlag, args } = stripOrgIdFlag(process.argv.slice(2));
const command = args[0];
const subcommand = args[1];
const rest = args.slice(1);
const subrest = args.slice(2);

const HELP = `
dillion - CLI for Dillion Bastion API

Usage: dillion <command> [options]

Commands:
  auth <api-key> [--url=...]   Save API credentials
  auth status [--json]         Show stored credentials and validate the key
  update                       Update to latest version
  health                       Check server status

  org list                     List organizations you belong to
  org use <id-or-name>         Set the active organization (sent on every request)
  org show | org clear         Show or clear the active organization

  projects list [--name <text>] List projects (optional name filter)
  projects create <name>       Create a project
  projects members -p <pid>    List VDR data room members
  projects invitations -p <pid> List pending email invitations
  projects invite <email> -p <pid>  Invite user to the data room
  project use <pid>            Save default project (optional -p for other commands)
  project show | project clear Show or clear default project

  search <query> -p <pid>      Hybrid search documents
  files search <query> -p <pid>  Search files by name
  files download <jobId...>    Download files locally
  files upload <file...> -p <pid>  Upload files ([--wait] waits for ingestion)
  filters <pid>                Get filter facets for a project
  jobs list -p <pid>           List jobs (use --help for all filters)
  jobs list -p <pid> --filters Show available filter values
  jobs list -p <pid> --all     Fetch all pages
  jobs get <job-id>            Get job details
  jobs wait <job-id>          Wait until ingestion completes (or fails)
  jobs archive <job-id...>     Archive jobs (hidden from search/agent)
  jobs unarchive <job-id...>   Restore archived jobs
  agent ask <query> -p <pid>   Ask agent a question
  agent search <query> -p <pid>  Agent retrieval search
  obligations <pid>            Download obligations CSV

  artifacts init [dir]         Scaffold a Vite + React research report
  artifacts dev | build [dir]  Run vite dev / build for the report
  artifacts publish [dir]      Publish report (--title <t> -p <pid> | --report <id>); includes source zip unless --no-raw
  artifacts memo-chat enable|disable <report-id>  Toggle Ask memo on the VDR viewer
  artifacts download-raw <id>  Download source zip (--out path, optional --version)
  artifacts list -p <pid>      List research reports for a project
  artifacts get <report-id>    Show report + versions
  artifacts share <report-id>  Create link (or: share list / share update, see artifacts help)

  share-links create -p <pid>  Create multi-artifact share link (see share-links --help)
  share-links list -p <pid>    List share links for a project
  share-links get <link-id>    Show a share link with items
  share-links update <link-id> Change slug, password, expiry, email allowlist, items
  share-links revoke <link-id> Soft-revoke a share link

Flags:
  --project, -p <id>   Project ID (optional after: dillion project use <id>)
  --org-id <org_...>   Act in this organization for one command (overrides org use)
  --json               Output raw JSON
  --limit <n>          Result limit
  --out, -o <path>     Output file or directory
`;

/**
 * Resolve the acting org ONCE at startup (flag ?? config.orgId) and stash it for buildHeaders.
 * A raw --org-id must be an org id, not a name; names resolve only in "dillion org use".
 */
async function applyOrgOverride(flag: string | undefined) {
  const parsed = classifyOrgIdFlag(flag);
  if (parsed.kind === "empty") {
    console.error(
      "--org-id needs an org id, e.g. --org-id org_123. Omit the flag to use your saved org (see `dillion org show`).",
    );
    process.exit(1);
  }
  const flagVal = parsed.kind === "value" ? parsed.value : undefined;
  if (flagVal && !looksLikeOrgId(flagVal)) {
    console.error(
      `"${flagVal}" looks like a name; run \`dillion org use ${flagVal}\` to select it, or pass the org_... id with --org-id.`,
    );
    process.exit(1);
  }
  const cfg = await loadConfig();
  setOrgOverride(resolveOrgOverride(flagVal, cfg?.orgId));
}

async function main() {
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP.trim());
    process.exit(0);
  }

  if (command === "--version" || command === "-v" || command === "version") {
    console.log(VERSION);
    process.exit(0);
  }

  await applyOrgOverride(orgIdFlag);

  switch (command) {
    case "auth": {
      const { authCommand, authStatusCommand } = await import("./commands/auth");
      if (subcommand === "status") return authStatusCommand(subrest);
      return authCommand(rest);
    }
    case "docs": {
      const { docsCommand } = await import("./commands/docs");
      return docsCommand();
    }
    case "update": {
      const { updateCommand } = await import("./commands/update");
      return updateCommand();
    }
    case "health": {
      const { healthCommand } = await import("./commands/health");
      return healthCommand();
    }
    case "search": {
      const { searchCommand } = await import("./commands/search");
      return searchCommand(rest);
    }
    case "projects": {
      if (subcommand === "list") {
        const { projectsListCommand } = await import("./commands/projects");
        return projectsListCommand(subrest);
      }
      if (subcommand === "create") {
        const { projectsCreateCommand } = await import("./commands/projects");
        return projectsCreateCommand(subrest);
      }
      if (subcommand === "members") {
        const { projectsMembersCommand } = await import("./commands/projects");
        return projectsMembersCommand(subrest);
      }
      if (subcommand === "invitations") {
        const { projectsInvitationsCommand } = await import("./commands/projects");
        return projectsInvitationsCommand(subrest);
      }
      if (subcommand === "invite") {
        const { projectsInviteCommand } = await import("./commands/projects");
        return projectsInviteCommand(subrest);
      }
      console.error("Usage: dillion projects <list|create|members|invitations|invite>");
      process.exit(1);
    }
    case "org": {
      if (subcommand === "list") {
        const { orgListCommand } = await import("./commands/org");
        return orgListCommand(subrest);
      }
      if (subcommand === "use") {
        const { orgUseCommand } = await import("./commands/org");
        return orgUseCommand(subrest);
      }
      if (subcommand === "show") {
        const { orgShowCommand } = await import("./commands/org");
        return orgShowCommand();
      }
      if (subcommand === "clear") {
        const { orgClearCommand } = await import("./commands/org");
        return orgClearCommand();
      }
      console.error("Usage: dillion org <list|use|show|clear>");
      process.exit(1);
    }
    case "project": {
      if (subcommand === "use") {
        const { projectUseCommand } = await import("./commands/project");
        return projectUseCommand(subrest);
      }
      if (subcommand === "show") {
        const { projectShowCommand } = await import("./commands/project");
        return projectShowCommand();
      }
      if (subcommand === "clear") {
        const { projectClearCommand } = await import("./commands/project");
        return projectClearCommand();
      }
      console.error("Usage: dillion project <use|show|clear>");
      process.exit(1);
    }
    case "files": {
      if (subcommand === "search") {
        const { filesSearchCommand } = await import("./commands/files");
        return filesSearchCommand(subrest);
      }
      if (subcommand === "download") {
        const { filesDownloadCommand } = await import("./commands/files");
        return filesDownloadCommand(subrest);
      }
      if (subcommand === "upload") {
        const { filesUploadCommand } = await import("./commands/files");
        return filesUploadCommand(subrest);
      }
      console.error("Usage: dillion files <search|download|upload>");
      process.exit(1);
    }
    case "jobs": {
      if (subcommand === "list") {
        const { jobsListCommand } = await import("./commands/jobs");
        return jobsListCommand(subrest);
      }
      if (subcommand === "get") {
        const { jobsGetCommand } = await import("./commands/jobs");
        return jobsGetCommand(subrest);
      }
      if (subcommand === "wait") {
        const { jobsWaitCommand } = await import("./commands/jobs");
        return jobsWaitCommand(subrest);
      }
      if (subcommand === "archive" || subcommand === "unarchive") {
        const { jobsArchiveCommand } = await import("./commands/jobs");
        return jobsArchiveCommand(subrest, subcommand === "archive");
      }
      console.error("Usage: dillion jobs <list|get|wait|archive|unarchive>");
      process.exit(1);
    }
    case "agent": {
      if (subcommand === "ask") {
        const { agentAskCommand } = await import("./commands/agent");
        return agentAskCommand(subrest);
      }
      if (subcommand === "search") {
        const { agentSearchCommand } = await import("./commands/agent");
        return agentSearchCommand(subrest);
      }
      console.error("Usage: dillion agent <ask|search>");
      process.exit(1);
    }
    case "filters": {
      const { filtersCommand } = await import("./commands/filters");
      return filtersCommand(rest);
    }
    case "obligations": {
      const { obligationsCommand } = await import("./commands/obligations");
      return obligationsCommand(rest);
    }
    case "artifacts": {
      const { artifactsCommand } = await import("./commands/artifacts");
      return artifactsCommand(rest);
    }
    case "share-links": {
      const { shareLinksCommand } = await import("./commands/shareLinks");
      return shareLinksCommand(rest);
    }
    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP.trim());
      process.exit(1);
  }
}

main().then(() => checkForUpdate(command));
