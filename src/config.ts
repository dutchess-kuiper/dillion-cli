import { homedir } from "os";
import { join } from "path";

const CONFIG_DIR = join(homedir(), ".config", "dillion");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export interface Config {
  apiKey: string;
  baseUrl: string;
  /** Saved by \`dillion project use\`; used when commands omit -p/--project */
  projectId?: string;
  /** Saved by \`dillion org use\`; overridden per-invocation by --org-id */
  orgId?: string;
}

export async function loadConfig(): Promise<Config | null> {
  try {
    const file = Bun.file(CONFIG_FILE);
    if (!(await file.exists())) return null;
    return await file.json();
  } catch {
    return null;
  }
}

export async function saveConfig(config: Config): Promise<void> {
  await Bun.write(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * File config overlaid with environment variables (env wins). Reads
 * `DILLION_API_KEY`, `DILLION_BASE_URL` (trailing slashes stripped), `DILLION_PROJECT_ID`,
 * and `DILLION_ORG_ID`. Returns null when neither env nor file supplies BOTH an apiKey
 * and a baseUrl — there is no compiled-in default server URL.
 *
 * This never persists env values: it does not write the file, and the read-modify-write
 * flows (`auth`, `org use`, `project use`) all go through `loadConfig`, not this.
 */
export async function resolveRuntimeConfig(): Promise<Config | null> {
  const file = await loadConfig();

  const envApiKey = process.env.DILLION_API_KEY?.trim();
  const envBaseUrl = process.env.DILLION_BASE_URL?.trim().replace(/\/+$/, "");
  const envProjectId = process.env.DILLION_PROJECT_ID?.trim();
  const envOrgId = process.env.DILLION_ORG_ID?.trim();

  const apiKey = envApiKey || file?.apiKey;
  const baseUrl = envBaseUrl || file?.baseUrl;
  if (!apiKey || !baseUrl) return null;

  const config: Config = { apiKey, baseUrl };
  const projectId = envProjectId || file?.projectId;
  const orgId = envOrgId || file?.orgId;
  if (projectId) config.projectId = projectId;
  if (orgId) config.orgId = orgId;
  return config;
}

export async function getConfig(): Promise<Config> {
  const config = await resolveRuntimeConfig();
  if (!config) {
    console.error("Not logged in. Run: dillion auth <api-key>");
    process.exit(1);
  }
  return config;
}

export { CONFIG_DIR, CONFIG_FILE };
