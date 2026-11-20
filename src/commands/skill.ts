import { dirname } from "path";
import { mkdir } from "fs/promises";
import { apiBaseUrl, buildHeaders, describeNetworkError } from "../api";
import { getConfig } from "../config";
import { parseFlags } from "../flags";

const SKILL_HELP = `
Usage: dillion skill [--out <path>]

Print the dillion-cli agent skill: the full command reference and workflow
rules (publish, share, portal links) that Claude Code uses for this CLI.
Fetched from your Dillion server, so you need to be logged in (dillion auth).

  dillion skill                 Print it (Markdown, with its YAML frontmatter)
  dillion skill --out <path>    Save it to a file instead, e.g.
                                ~/.claude/skills/dillion-cli/SKILL.md
  dillion help skill            Same as dillion skill
`.trim();

export async function skillCommand(args: string[]) {
  const { flags } = parseFlags(args);
  if (flags.help !== undefined || flags.h !== undefined) {
    console.log(SKILL_HELP);
    return;
  }
  const out = flags.out ?? flags.o;
  if (out === "") {
    console.error("--out needs a path");
    process.exit(1);
  }
  const skill = await fetchSkill();
  if (out !== undefined) {
    await mkdir(dirname(out), { recursive: true });
    await Bun.write(out, skill);
    console.error(`✓ Wrote the dillion-cli skill to ${out}`);
    return;
  }
  process.stdout.write(skill.endsWith("\n") ? skill : `${skill}\n`);
}

const SKILL_ERRORS: Record<string, string> = {
  skill_not_configured: "This Dillion server isn't set up to serve the skill yet (SKILL_GITHUB_TOKEN unset on bastion).",
  skill_unavailable: "The server couldn't load the skill right now. Try again in a minute.",
};

async function fetchSkill(): Promise<string> {
  const { apiKey } = await getConfig();
  const baseUrl = await apiBaseUrl();
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/skills/dillion-cli`, {
      headers: buildHeaders(apiKey),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    console.error(describeNetworkError(err, baseUrl));
    process.exit(1);
  }
  const text = await res.text();
  if (res.ok) return text;
  let slug = "";
  try {
    slug = JSON.parse(text).error ?? "";
  } catch {
    // not JSON
  }
  if (res.status === 404) {
    console.error("This Dillion server doesn't serve the skill (needs a newer bastion).");
  } else {
    console.error(SKILL_ERRORS[slug] ?? `Error ${res.status}: ${slug || text}`);
  }
  process.exit(1);
}
