#!/usr/bin/env bun

export const VERSION = "0.1.15";

const SKIP_UPDATE_CHECK = new Set(["auth", "update", "version", "--version", "-v", "help", "--help", "-h"]);

import { homedir } from "os";
import { join } from "path";

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

const args = process.argv.slice(2);
const command = args[0];
const subcommand = args[1];
const rest = args.slice(1);
const subrest = args.slice(2);

const HELP = `
dillion - CLI for Dillion Bastion API

Usage: dillion <command> [options]

Commands:
  auth <api-key> [--url=...]   Save API credentials
  update                       Update to latest version
  health                       Check server status

  projects list [--name <text>] List projects (optional name filter)
  projects create <name>       Create a project
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
  agent ask <query> -p <pid>   Ask agent a question
  agent search <query> -p <pid>  Agent retrieval search
  obligations <pid>            Download obligations CSV

  artifacts init [dir]         Scaffold a Vite + React research report
  artifacts dev | build [dir]  Run vite dev / build for the report
  artifacts publish [dir]      Publish report (--title <t> -p <pid> | --report <id>)
  artifacts list -p <pid>      List research reports for a project
  artifacts get <report-id>    Show report + versions
  artifacts share <report-id>  Create link (or: share list / share update, see artifacts help)

Flags:
  --project, -p <id>   Project ID (optional after: dillion project use <id>)
  --json               Output raw JSON
  --limit <n>          Result limit
  --out, -o <path>     Output file or directory
`;

async function main() {
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP.trim());
    process.exit(0);
  }

  if (command === "--version" || command === "-v" || command === "version") {
    console.log(VERSION);
    process.exit(0);
  }

  switch (command) {
    case "auth": {
      const { authCommand } = await import("./commands/auth");
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
      console.error("Usage: dillion projects <list|create>");
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
      console.error("Usage: dillion jobs <list|get|wait>");
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
    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP.trim());
      process.exit(1);
  }
}

main().then(() => checkForUpdate(command));
