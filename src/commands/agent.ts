import { api } from "../api";
import { requireProjectId } from "../projectContext";
import { parseFlags } from "../flags";

export async function agentAskCommand(args: string[]) {
  const { flags, positional } = parseFlags(args);
  const query = positional.join(" ");
  const projectId = await requireProjectId(
    flags,
    "Usage: dillion agent ask <query> --project <id>  (or: dillion project use <id>)"
  );
  const json = flags.json !== undefined;

  if (!query) {
    console.error("Usage: dillion agent ask <query> --project <id>");
    process.exit(1);
  }

  const data = await api("/agent/ask", {
    method: "POST",
    body: { projectId, query },
  });

  if (json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log(data.answer);

  if (data.isPartialAnswer && data.missingInformation.length) {
    console.log(`\nMissing information:`);
    for (const m of data.missingInformation) {
      console.log(`  - ${m}`);
    }
  }

  if (data.sources.length) {
    console.log(`\nSources:`);
    for (const s of data.sources) {
      console.log(`  - ${s.collection} ${s.objectId}`);
    }
  }
  console.log(`\nTime: ${Math.round(data.totalTime)}ms | ${data.usage.totalTokens} tokens`);
}

export async function agentSearchCommand(args: string[]) {
  const { flags, positional } = parseFlags(args);
  const query = positional.join(" ");
  const projectId = await requireProjectId(
    flags,
    "Usage: dillion agent search <query> --project <id>  (or: dillion project use <id>)"
  );
  const limit = flags.limit ? parseInt(flags.limit) : 10;
  const json = flags.json !== undefined;

  if (!query) {
    console.error("Usage: dillion agent search <query> --project <id>");
    process.exit(1);
  }

  const data = await api("/agent/search", {
    method: "POST",
    body: { projectId, query, limit },
  });

  if (json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log(`${data.totalResults} results (${data.totalTime}ms)\n`);

  for (const r of data.results) {
    console.log(`[${r.collection}] ${r.uuid}`);
    if (r.properties.file_name) console.log(`  File: ${r.properties.file_name}`);
    if (r.properties.content) {
      console.log(`  ${r.properties.content.slice(0, 200)}`);
    }
    console.log();
  }
}
