import { api } from "../api";
import { parseFlags } from "../flags";

export async function jobsListCommand(args: string[]) {
  const { flags } = parseFlags(args);
  const projectId = flags.project || flags.p;
  const status = flags.status;
  const search = flags.search;
  const limit = flags.limit ? parseInt(flags.limit) : 50;
  const offset = flags.offset ? parseInt(flags.offset) : 0;
  const json = flags.json !== undefined;

  if (!projectId) {
    console.error("Usage: dillion jobs list --project <id>");
    process.exit(1);
  }

  const data = await api("/jobs/list", {
    method: "POST",
    body: {
      projectId,
      ...(status && { status }),
      ...(search && { search }),
      limit,
      offset,
    },
  });

  if (json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log(`${data.total} jobs (showing ${data.jobs.length})\n`);

  for (const j of data.jobs) {
    const meta = j.metadata;
    const cat = meta.document_category || "";
    console.log(
      `${j.status.padEnd(10)} ${j.fileName}${cat ? ` [${cat}]` : ""}`
    );
  }

  if (data.hasMore) {
    console.log(`\n... ${data.total - data.jobs.length} more (use --offset)`);
  }
}

export async function jobsGetCommand(args: string[]) {
  const jobId = args[0];
  const json = args.includes("--json");

  if (!jobId || jobId.startsWith("--")) {
    console.error("Usage: dillion jobs get <job-id>");
    process.exit(1);
  }

  const data = await api(`/jobs/${jobId}`);

  if (json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log(`File:    ${data.fileName}`);
  console.log(`Status:  ${data.status}`);
  console.log(`Project: ${data.projectId}`);
  console.log(`Created: ${data.createdAt}`);
  if (data.errorMessage) console.log(`Error:   ${data.errorMessage}`);

  if (data.steps.length) {
    console.log(`\nSteps:`);
    for (const s of data.steps) {
      const cost = s.cost ? ` ($${s.cost.toFixed(4)})` : "";
      console.log(`  ${s.status.padEnd(10)} ${s.stepName}${cost}`);
      if (s.error) console.log(`           Error: ${s.error}`);
    }
  }
}
