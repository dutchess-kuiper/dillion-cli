import { loadConfig, saveConfig, type Config } from "../config";
import { parseFlags } from "../flags";

const PROJECT_HELP = `
Usage: dillion project <command>

  use <project-id>   Save a default project (used when -p is omitted)
  show               Print the current default project, if any
  clear              Remove the saved default project

Run "dillion projects list" to see project ids.
`.trim();

export async function projectUseCommand(args: string[]) {
  const { flags, positional } = parseFlags(args);

  if (flags.help === "" || flags.h === "") {
    console.log(PROJECT_HELP);
    return;
  }

  const id = positional[0]?.trim();
  if (!id || id.startsWith("--")) {
    console.error("Usage: dillion project use <project-id>");
    process.exit(1);
  }

  const cfg = await loadConfig();
  if (!cfg) {
    console.error("Not logged in. Run: dillion auth <api-key>");
    process.exit(1);
  }

  await saveConfig(mergeProject(cfg, id));
  console.log(`Default project set to ${id}`);
}

export async function projectShowCommand() {
  const cfg = await loadConfig();
  if (!cfg) {
    console.error("Not logged in. Run: dillion auth <api-key>");
    process.exit(1);
  }
  if (cfg.projectId) {
    console.log(cfg.projectId);
  } else {
    console.log("No default project. Run: dillion project use <project-id>");
  }
}

export async function projectClearCommand() {
  const cfg = await loadConfig();
  if (!cfg) {
    console.error("Not logged in. Run: dillion auth <api-key>");
    process.exit(1);
  }
  await saveConfig({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl });
  console.log("Default project cleared.");
}

function mergeProject(cfg: Config, projectId: string): Config {
  return { ...cfg, projectId };
}
