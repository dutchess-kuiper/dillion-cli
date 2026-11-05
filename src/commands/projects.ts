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
  --access <level>           General access for everyone in the workspace:
                               none  only people added to the project
                               view  everyone can open and read it
                               edit  everyone can upload, run Auto DD and share
                             Default: edit (same as the web app)
  --json                     Output raw JSON
  --help, -h                 Show this help
`.trim();

export type OrgAccessLevel = "none" | "viewer" | "editor";

const ACCESS_FLAG_VALUES: Record<string, OrgAccessLevel> = {
  none: "none",
  view: "viewer",
  viewer: "viewer",
  edit: "editor",
  editor: "editor",
};

const ACCESS_LABELS: Record<string, string> = {
  none: "No access",
  viewer: "Can view",
  editor: "Can edit",
};

/**
 * Parse `--access`. undefined means the flag was not given (the backend
 * default applies). Returns an error for an empty or unknown value.
 */
export function parseAccessFlag(
  raw: string | undefined,
): { level?: OrgAccessLevel } | { error: string } {
  if (raw === undefined) return {};
  const level = ACCESS_FLAG_VALUES[raw.trim().toLowerCase()];
  if (!level) {
    return { error: "--access must be one of: none, view, edit" };
  }
  return { level };
}

/**
 * Warning text when --access was given but the created project came back
 * with different General access (an older server that ignores the field).
 * Returns undefined when nothing was requested or the values match.
 */
export function accessMismatchWarning(
  requested: OrgAccessLevel | undefined,
  returned: unknown,
): string | undefined {
  if (!requested || returned === requested) return undefined;
  const got = accessLabel(returned) ?? "unknown";
  return `Warning: asked for general access "${accessLabel(requested)}" but the project was created with "${got}". The server may not support --access yet; change it in the web app.`;
}

/** Human label for a project's org_access, e.g. "Can edit". */
export function accessLabel(orgAccess: unknown): string | undefined {
  return typeof orgAccess === "string" ? ACCESS_LABELS[orgAccess] : undefined;
}

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

  const access = parseAccessFlag(flags.access);
  if ("error" in access) {
    console.error(access.error);
    process.exit(1);
  }

  const data = await apiProjectsCreate(name, description, access.level);
  const p = data as Record<string, unknown>;

  const mismatch = accessMismatchWarning(access.level, p.org_access);
  if (mismatch) console.error(mismatch);

  if (json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log(`Created: ${p.name ?? name}`);
  console.log(`  id: ${p.id ?? ""}`);
  const label = accessLabel(p.org_access);
  if (label) console.log(`  general access: ${label}`);
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
