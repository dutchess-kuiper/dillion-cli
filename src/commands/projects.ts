import {
  apiProjectInvite,
  apiProjectInvitations,
  apiProjectMembers,
  apiProjectsCreate,
  apiProjectsList,
} from "../api";
import { parseFlags } from "../flags";
import { requireProjectId } from "../projectContext";

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

const PROJECTS_MEMBERS_HELP = `
Usage: dillion projects members [options]

  List members with access to the VDR data room (not artifact share links).

Options:
  --project, -p <id>   Project ID (or set via: dillion project use <id>)
  --json               Output raw JSON
  --help, -h           Show this help
`.trim();

const PROJECTS_INVITATIONS_HELP = `
Usage: dillion projects invitations [options]

  List pending email invitations for a project.

Options:
  --project, -p <id>   Project ID (or set via: dillion project use <id>)
  --json               Output raw JSON
  --help, -h           Show this help
`.trim();

const PROJECTS_INVITE_HELP = `
Usage: dillion projects invite <email> [options]

  Grant VDR data room access by email. Existing Dillion users are added
  immediately; new users get a pending invitation until they sign up.

Options:
  --project, -p <id>   Project ID (or set via: dillion project use <id>)
  --json               Output raw JSON
  --help, -h           Show this help
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

export async function projectsMembersCommand(args: string[]) {
  const { flags } = parseFlags(args);

  if (flags.help === "" || flags.h === "") {
    console.log(PROJECTS_MEMBERS_HELP);
    return;
  }

  const projectId = await requireProjectId(
    flags,
    "Usage: dillion projects members -p <project-id>",
  );
  const json = flags.json !== undefined;
  const data = await apiProjectMembers(projectId);

  if (json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (!Array.isArray(data) || data.length === 0) {
    console.log("No members.");
    return;
  }

  console.log(`${data.length} member(s)\n`);
  for (const raw of data) {
    const m = raw as Record<string, unknown>;
    const email = m.email != null ? String(m.email) : "";
    const role = m.role != null ? String(m.role) : "member";
    const name = m.full_name != null ? String(m.full_name) : "";
    const label = name ? `${name} <${email}>` : email;
    console.log(`${label}  (${role})`);
  }
}

export async function projectsInvitationsCommand(args: string[]) {
  const { flags } = parseFlags(args);

  if (flags.help === "" || flags.h === "") {
    console.log(PROJECTS_INVITATIONS_HELP);
    return;
  }

  const projectId = await requireProjectId(
    flags,
    "Usage: dillion projects invitations -p <project-id>",
  );
  const json = flags.json !== undefined;
  const data = await apiProjectInvitations(projectId);

  if (json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (!Array.isArray(data) || data.length === 0) {
    console.log("No pending invitations.");
    return;
  }

  console.log(`${data.length} pending invitation(s)\n`);
  for (const raw of data) {
    const inv = raw as Record<string, unknown>;
    const email = inv.email != null ? String(inv.email) : "";
    const id = inv.id != null ? String(inv.id) : "";
    const created = inv.created_at != null ? String(inv.created_at) : "";
    console.log(`${email}`);
    if (id) console.log(`  id: ${id}`);
    if (created) console.log(`  invited: ${created}`);
    console.log();
  }
}

export async function projectsInviteCommand(args: string[]) {
  const { flags, positional } = parseFlags(args);

  if (flags.help === "" || flags.h === "") {
    console.log(PROJECTS_INVITE_HELP);
    return;
  }

  const email = positional[0]?.trim();
  if (!email) {
    console.error(PROJECTS_INVITE_HELP);
    process.exit(1);
  }

  const projectId = await requireProjectId(
    flags,
    "Usage: dillion projects invite <email> -p <project-id>",
  );
  const json = flags.json !== undefined;
  const data = await apiProjectInvite(projectId, email);

  if (json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (data.status === "member_added") {
    console.log(`✓ ${data.email} now has access to the project`);
    return;
  }

  console.log(`✓ Invitation recorded for ${data.email}`);
  if (data.message) {
    console.log(`  ${data.message}`);
  }
}
