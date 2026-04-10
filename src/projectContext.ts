import { loadConfig } from "./config";

/**
 * Resolve project id: explicit -p/--project, else optional positional, else saved default from config.
 */
export async function resolveProjectId(
  flags: Record<string, string | undefined>,
  positionalProject?: string
): Promise<string | undefined> {
  const fromPos = positionalProject?.trim() || undefined;
  const fromFlag = flags.project || flags.p;
  if (fromPos) return fromPos;
  if (fromFlag) return fromFlag;
  const cfg = await loadConfig();
  return cfg?.projectId?.trim() || undefined;
}

export async function requireProjectId(
  flags: Record<string, string | undefined>,
  usage: string,
  positionalProject?: string
): Promise<string> {
  const id = await resolveProjectId(flags, positionalProject);
  if (!id) {
    console.error(usage);
    process.exit(1);
  }
  return id;
}
