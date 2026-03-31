import { api } from "../api";
import { parseFlags } from "../flags";

export async function filesSearchCommand(args: string[]) {
  const { flags, positional } = parseFlags(args);
  const query = positional.join(" ");
  const projectId = flags.project || flags.p;
  const limit = flags.limit ? parseInt(flags.limit) : 50;
  const json = flags.json !== undefined;

  if (!projectId || !query) {
    console.error("Usage: dillion files search <query> --project <id>");
    process.exit(1);
  }

  const data = await api("/files/search", {
    method: "POST",
    body: { projectId, query, limit },
  });

  if (json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log(`${data.total} files found\n`);
  for (const j of data.jobs) {
    console.log(`${j.status.padEnd(10)} ${j.fileName}`);
  }
  if (data.hasMore) {
    console.log(`\n... more results available`);
  }
}

export async function filesDownloadCommand(args: string[]) {
  const { flags, positional } = parseFlags(args);
  const projectId = flags.project || flags.p;
  const json = flags.json !== undefined;

  if (positional.length === 0) {
    console.error("Usage: dillion files download <jobId...> [--project <id>]");
    process.exit(1);
  }

  const data = await api("/files/download", {
    method: "POST",
    body: { jobIds: positional, ...(projectId && { projectId }) },
  });

  if (json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  for (const u of data.urls) {
    if (u.error) {
      console.error(`FAIL  ${u.fileName}: ${u.error}`);
    } else {
      console.log(`${u.fileName}`);
      console.log(`  ${u.url}\n`);
    }
  }
}
