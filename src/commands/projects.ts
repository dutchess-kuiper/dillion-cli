import { apiProjectsCreate, apiProjectsList } from "../api";
import { parseFlags } from "../flags";

const PROJECTS_LIST_HELP = `
Usage: dillion projects list [options]

  List projects visible to your API key (same scope as create).

Options:
  --name <text>     Case-insensitive substring filter on project name
  --json            Output raw JSON
  --help, -h        Show this help
`.trim();

const PROJECTS_CREATE_HELP = `
Usage: dillion projects create <name> [options]

  Create a new project. Name can be multiple words (all positional args).

Options:
  --description, -d <text>   Optional description
  --json                     Output raw JSON
  --help, -h                 Show this help
`.trim();

export async function projectsListCommand(args: string[]) {
  const { flags } = parseFlags(args);

  if (flags.help === "" || flags.h === "") {
    console.log(PROJECTS_LIST_HELP);
    return;
  }

  const json = flags.json !== undefined;
  const name = flags.name?.trim() || undefined;

  const data = await apiProjectsList(name);

  if (json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (!Array.isArray(data)) {
    console.log(String(data));
    return;
  }

  if (data.length === 0) {
    console.log("No projects.");
    return;
  }

  console.log(`${data.length} project(s)\n`);

  for (const raw of data) {
    const p = raw as Record<string, unknown>;
    const id = p.id != null ? String(p.id) : "";
    const projectName = p.name != null ? String(p.name) : "";
    const paused = p.is_paused === true ? " (paused)" : "";
    console.log(`${projectName}${paused}`);
    console.log(`  ${id}`);
    console.log();
  }
}

export async function projectsCreateCommand(args: string[]) {
  const { flags, positional } = parseFlags(args);

  if (flags.help === "" || flags.h === "") {
    console.log(PROJECTS_CREATE_HELP);
    return;
  }

  const json = flags.json !== undefined;
  const name = positional.join(" ").trim();
  const descriptionRaw = flags.description ?? flags.d;
  const description =
    descriptionRaw !== undefined
      ? descriptionRaw === ""
        ? null
        : descriptionRaw
      : undefined;

  if (!name) {
    console.error(PROJECTS_CREATE_HELP);
    process.exit(1);
  }

  const data = await apiProjectsCreate(name, description);

  if (json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const p = data as Record<string, unknown>;
  console.log(`Created: ${p.name ?? name}`);
  console.log(`  id: ${p.id ?? ""}`);
}
