#!/usr/bin/env bun

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

  search <query> -p <pid>      Hybrid search documents
  files search <query> -p <pid>  Search files by name
  files download <jobId...>    Get presigned download URLs
  filters <pid>                Get filter facets for a project
  jobs list -p <pid>           List jobs with filters
  jobs get <job-id>            Get job details
  agent ask <query> -p <pid>   Ask agent a question
  agent search <query> -p <pid>  Agent retrieval search
  obligations <pid>            Download obligations CSV

Flags:
  --project, -p <id>   Project ID
  --json               Output raw JSON
  --limit <n>          Result limit
  --out, -o <file>     Output file (obligations)
`;

async function main() {
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP.trim());
    process.exit(0);
  }

  switch (command) {
    case "auth": {
      const { authCommand } = await import("./commands/auth");
      return authCommand(rest);
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
    case "files": {
      if (subcommand === "search") {
        const { filesSearchCommand } = await import("./commands/files");
        return filesSearchCommand(subrest);
      }
      if (subcommand === "download") {
        const { filesDownloadCommand } = await import("./commands/files");
        return filesDownloadCommand(subrest);
      }
      console.error("Usage: dillion files <search|download>");
      process.exit(1);
      break;
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
      console.error("Usage: dillion jobs <list|get>");
      process.exit(1);
      break;
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
      break;
    }
    case "filters": {
      const { filtersCommand } = await import("./commands/filters");
      return filtersCommand(rest);
    }
    case "obligations": {
      const { obligationsCommand } = await import("./commands/obligations");
      return obligationsCommand(rest);
    }
    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP.trim());
      process.exit(1);
  }
}

main();
