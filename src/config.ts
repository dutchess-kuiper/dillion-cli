import { homedir } from "os";
import { join } from "path";

const CONFIG_DIR = join(homedir(), ".config", "dillion");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export interface Config {
  apiKey: string;
  baseUrl: string;
  /** Saved by \`dillion project use\`; used when commands omit -p/--project */
  projectId?: string;
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

export async function getConfig(): Promise<Config> {
  const config = await loadConfig();
  if (!config) {
    console.error("Not logged in. Run: dillion auth <api-key>");
    process.exit(1);
  }
  return config;
}

export { CONFIG_DIR, CONFIG_FILE };
