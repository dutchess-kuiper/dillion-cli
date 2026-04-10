import { api } from "../api";
import { requireProjectId } from "../projectContext";
import { parseFlags } from "../flags";

export async function searchCommand(args: string[]) {
  const { flags, positional } = parseFlags(args);
  const query = positional.join(" ");
  const projectId = await requireProjectId(
    flags,
    "Usage: dillion search <query> --project <id>  (or: dillion project use <id>)"
  );
  const limit = flags.limit ? parseInt(flags.limit) : 10;
  const alpha = flags.alpha ? parseFloat(flags.alpha) : undefined;
  const jobId = flags.job;
  const json = flags.json !== undefined;
  if (!query) {
    console.error("Usage: dillion search <query> --project <id>");
    process.exit(1);
  }

  const data = await api("/search", {
    method: "POST",
    body: {
      projectId,
      query,
      limit,
      ...(alpha !== undefined && { alpha }),
      ...(jobId && { jobId }),
    },
  });

  if (json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log(
    `${data.totalResults} results (${data.searchMode} search)\n`
  );

  for (const r of data.results) {
    console.log(`--- ${r.fileName} (chunk ${r.chunkIndex}) ---`);
    if (r.pages.length) console.log(`Pages: ${r.pages.join(", ")}`);
    console.log(r.content.slice(0, 300));
    console.log();
  }
}
