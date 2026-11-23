import { homedir } from "os";
import { join } from "path";

const CONFIG_DIR = join(homedir(), ".config", "dillion");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export const DEFAULT_BASE_URL = "https://bastion.dillion.ai";
/** When set, used as the API key instead of the one stored by `dillion auth`. */
export const ENV_API_KEY = "DILLION_API_KEY";
/** Server for the env key; only read when DILLION_API_KEY is set. */
export const ENV_API_URL = "DILLION_API_URL";

export interface Config {
  apiKey: string;
  baseUrl: string;
  /** Saved by \`dillion project use\`; used when commands omit -p/--project */
  projectId?: string;
  /** Saved by \`dillion org use\`; overridden per-invocation by --org-id */
  orgId?: string;
}

/** Where the effective API key came from. */
export type KeySource = "env" | "file";

/**
 * The stored config file only, with no env overrides. Use this for read-modify-write
 * (`org use`, `project use`, `auth`) so an env key is never persisted to disk.
 */
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

/** The API key from the environment, trimmed; undefined when unset or blank. */
export function envApiKey(env: Record<string, string | undefined> = process.env): string | undefined {
  return env[ENV_API_KEY]?.trim() || undefined;
}

const trimSlash = (u: string) => u.replace(/\/+$/, "");

/**
 * Overlay env credentials on the stored config. Pure so precedence is unit-testable.
 *
 * - DILLION_API_KEY set -> it replaces the stored key. The server is DILLION_API_URL, else the
 *   stored server, else the default. The saved org/project defaults carry over only when that
 *   server is the saved one: they belong to the saved login, and another server would get ids it
 *   doesn't know (pass --org-id / -p there instead).
 * - DILLION_API_KEY unset -> the stored config as is (DILLION_API_URL is ignored, so a stray
 *   URL never redirects a stored key to another server).
 */
export function resolveConfig(
  file: Config | null,
  env: Record<string, string | undefined>
): { config: Config; source: KeySource } | null {
  const apiKey = envApiKey(env);
  if (!apiKey) return file ? { config: file, source: "file" } : null;
  const baseUrl = trimSlash(env[ENV_API_URL]?.trim() || file?.baseUrl || DEFAULT_BASE_URL);
  const sameServer = !!file && trimSlash(file.baseUrl) === baseUrl;
  return {
    config: {
      apiKey,
      baseUrl,
      ...(sameServer && file.orgId ? { orgId: file.orgId } : {}),
      ...(sameServer && file.projectId ? { projectId: file.projectId } : {}),
    },
    source: "env",
  };
}

/** Stored config with env credentials applied, plus where the key came from. */
export async function loadEffectiveConfig(): Promise<{ config: Config; source: KeySource } | null> {
  return resolveConfig(await loadConfig(), process.env);
}

export async function getConfig(): Promise<Config> {
  const resolved = await loadEffectiveConfig();
  if (!resolved) {
    console.error(`Not logged in. Run: dillion auth <api-key>  (or set ${ENV_API_KEY})`);
    process.exit(1);
  }
  return resolved.config;
}

/**
 * Exit for `org` / `project` subcommands that read or write the saved defaults when there is no
 * config file. With only DILLION_API_KEY set there is nothing to save to, so point at the
 * per-command flag instead of claiming the user is logged out.
 */
export function exitNoConfigFile(perCommandFlag: string): never {
  console.error(
    envApiKey()
      ? `${ENV_API_KEY} is set but there is no saved config to change. Pass ${perCommandFlag} per command, or run: dillion auth <api-key>`
      : "Not logged in. Run: dillion auth <api-key>"
  );
  process.exit(1);
}

export { CONFIG_DIR, CONFIG_FILE };
