/**
 * Help for the commands that don't parse their own --help, checked in
 * src/index.ts BEFORE dispatch so `--help` never runs the command
 * (e.g. `dillion update --help` must not reinstall the CLI).
 */
export const COMMAND_HELP: Record<string, string> = {
  search: `
Usage: dillion search <query> [-p <project-id>] [options]

Hybrid (keyword + semantic) search across a project's document chunks. Each hit
carries the jobId and chunkId you need for inline citations.

Options:
  -p, --project <id>    Project (optional after: dillion project use <id>)
  --limit <n>           Max results (default: 10)
  --alpha <0-1>         0 = keyword only, 1 = semantic only (default: 0.5)
  --job <job-id>        Only search one document
  --blocks              Include citable blocks per hit ([n] type p.page text)
  --json                Raw JSON (use this to extract jobId/chunkId)

Examples:
  dillion search "revenue recognition" -p 8f3a...
  dillion search "change of control" --job <job-id> --blocks --json
`,
  agent: `
Usage: dillion agent <ask|search> <query> [-p <project-id>] [options]

  ask <query>           Ask a question; returns a written answer with sources
  search <query>        Retrieval only: the passages the agent would use, no answer

Options:
  -p, --project <id>    Project (optional after: dillion project use <id>)
  --limit <n>           Max results for agent search (default: 10)
  --json                Raw JSON

For citation ids (jobId/chunkId), use dillion search --json instead.

Examples:
  dillion agent ask "What are the key covenants?" -p 8f3a...
  dillion agent search "indemnification cap" --limit 5
`,
  filters: `
Usage: dillion filters [project-id] [--json]

List the filter facets (document types, dates, parties, …) available in a
project, with every value. The project id is optional after dillion project use.
`,
  obligations: `
Usage: dillion obligations [project-id] [--out <file.csv>]

Download the project's material obligations as CSV. Prints to stdout unless
--out (-o) is given. The project id is optional after dillion project use.

Example:
  dillion obligations 8f3a... -o matobs.csv
`,
  health: `
Usage: dillion health

Check that the Dillion server you're logged in to is up. Prints its status,
URL and time.
`,
  update: `
Usage: dillion update

Download and install the latest dillion release (re-runs install.sh from
GitHub). The CLI also tells you once a day when a newer version exists.
`,
  docs: `
Usage: dillion docs

Print the full command reference: every command and flag, grouped by area.
For one command: dillion <command> --help. For the full agent guide: dillion skill.
`,
  version: `
Usage: dillion version   (or --version, -v)

Print the installed CLI version.
`,
};

/** Help for groups and subcommands whose own handlers don't parse --help. */
const GROUP_HELP: Record<string, string> = {
  auth: `
Usage: dillion auth <api-key> [--url=https://...]
       dillion auth status [--json]

  <api-key>          Save your dil_… API key (checked against the server first)
  --url=<url>        Use a different server (default: https://bastion.dillion.ai)
  status             Show the saved server, masked key, org and project, and
                     whether the key is still valid
`,
  projects: `
Usage: dillion projects <command> [options]

  list [--name <text>]       List projects you can see
  create <name> [-d <text>]  Create a project
  members                    List who has access to a project's data room
  invitations                List pending email invitations for a project
  invite <email>             Give someone data room access by email

Run dillion projects <command> --help for each command's options.
`,
  files: `
Usage: dillion files <command> [options]

  search <query> -p <pid>          Search files by name
  download <job-id...> -p <pid>    Download files (original, or extracted text)
  upload <path...> -p <pid>        Upload files for ingestion

Run dillion files <command> --help for each command's options.
`,
  "files search": `
Usage: dillion files search <query> [-p <project-id>] [options]

Search a project's files by name.

Options:
  -p, --project <id>    Project (optional after: dillion project use <id>)
  --limit <n>           Max results (default: 50)
  --json                Raw JSON
`,
  "files download": `
Usage: dillion files download <job-id...> [-p <project-id>] [options]

Download one or more files by job id.

Options:
  -p, --project <id>        Project (optional after: dillion project use <id>)
  --format <original|txt>   The original file (default) or its extracted text
  --out, -o <path>          File (one id) or directory (several ids) to save to
  --json                    Raw JSON
`,
  jobs: `
Usage: dillion jobs <command> [options]

  list -p <pid>            List ingestion jobs (one per uploaded file)
  get <job-id>             Show a job and its pipeline steps
  wait <job-id>            Wait until a job finishes (or fails)
  archive <job-id...>      Archive jobs (left out of search and agent)
  unarchive <job-id...>    Restore archived jobs

Run dillion jobs <command> --help for each command's options.
`,
  "jobs get": `
Usage: dillion jobs get <job-id> [--json]

Show one ingestion job: file, status, and the timing of each pipeline step.
`,
  "jobs unarchive": `
Usage: dillion jobs unarchive <job-id...> [--json]

Restore archived jobs so search and agent use them again.
`,
};

/**
 * Subcommands that parse --help themselves (exit 0, specific usage). Anything
 * else asking for help is answered by resolveHelp before it is dispatched, so
 * --help never runs a command (e.g. `org clear --help` must not clear the org).
 */
const SELF_HELP = new Set([
  "auth status",
  "org list",
  "org use",
  "project use",
  "projects list",
  "projects create",
  "projects members",
  "projects invitations",
  "projects invite",
  "files upload",
  "jobs list",
  "jobs wait",
  "jobs archive",
  "artifacts",
  "artifacts init",
  "artifacts publish",
  "artifacts attach-pdf",
  "artifacts attach-workbook",
  "artifacts memo-chat",
  "artifacts download-raw",
  "share-links",
  "skill",
]);

/**
 * The help text to print for `<command> [sub] --help`, or null to let the
 * command's own handler print it. Falls back to the group's help for any
 * subcommand without its own, and to null for unknown commands (dispatch then
 * reports them).
 */
export async function resolveHelp(command: string, sub: string | undefined): Promise<string | null> {
  const s = sub && !sub.startsWith("-") ? sub : undefined;
  const key = s ? `${command} ${s}` : command;
  if (SELF_HELP.has(key)) return null;
  if (Object.hasOwn(COMMAND_HELP, command)) return COMMAND_HELP[command]!.trim();
  if (Object.hasOwn(GROUP_HELP, key)) return GROUP_HELP[key]!.trim();
  if (Object.hasOwn(GROUP_HELP, command)) return GROUP_HELP[command]!.trim();
  switch (command) {
    case "org":
      return (await import("./org")).ORG_HELP;
    case "project":
      return (await import("./project")).PROJECT_HELP;
    case "artifacts":
      return (await import("./artifacts")).ARTIFACTS_HELP;
    case "share-links":
      return (await import("./shareLinks")).SHARE_LINKS_HELP.trim();
  }
  return null;
}

/** True when the args ask for help: --help / -h (or --help=…) anywhere before `--`. */
export function wantsHelp(args: string[]): boolean {
  const end = args.indexOf("--");
  const head = end === -1 ? args : args.slice(0, end);
  return head.some((a) => a === "--help" || a === "-h" || a.startsWith("--help="));
}

/**
 * When help is asked for, reduce the args to `<command> [sub] --help`, nothing
 * else. Handlers parse `--help <next>` as a flag WITH a value and would then
 * run (e.g. `artifacts init --help mydir` created mydir); with only a bare
 * `--help` left, every handler prints its help.
 */
export function normalizeHelpArgs(args: string[]): string[] {
  if (!wantsHelp(args) || args.length === 0) return args;
  const [command, sub] = args;
  const keepSub = sub !== undefined && sub !== "--" && !sub.startsWith("-");
  return keepSub ? [command!, sub!, "--help"] : [command!, "--help"];
}

/**
 * `dillion help <command> [sub…]` → `dillion <command> [sub…] --help`, so every
 * command's own help is reachable both ways. `help skill` is left alone: it
 * prints the skill itself, not the skill command's usage.
 */
export function rewriteHelpArgs(args: string[]): string[] {
  if (args[0] !== "help" || args.length < 2 || args[1] === "skill") return args;
  return [...args.slice(1), "--help"];
}
