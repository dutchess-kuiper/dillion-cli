import { api } from "../api";
import { resolveProjectId } from "../projectContext";
import { parseFlags } from "../flags";

export async function filtersCommand(args: string[]) {
  const { flags, positional } = parseFlags(args);
  const projectId = await resolveProjectId(flags, positional[0]);
  const json = flags.json !== undefined;

  if (!projectId) {
    console.error("Usage: dillion filters <project-id>  (or set default: dillion project use <id>)");
    process.exit(1);
  }

  const data = await api(`/filters/${projectId}`);

  if (json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  for (const [key, values] of Object.entries(data)) {
    const arr = values as string[];
    console.log(`${key} (${arr.length}):`);
    for (const v of arr) {
      console.log(`  ${v}`);
    }
    console.log();
  }
}
