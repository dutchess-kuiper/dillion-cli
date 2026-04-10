import { api } from "../api";
import { waitForJobCompletion } from "../jobWait";
import { resolveProjectId } from "../projectContext";
import { parseFlags } from "../flags";

const JOBS_LIST_HELP = `
Usage: dillion jobs list --project <id> [options]

  Default project: set with "dillion project use <id>" to omit --project.

Filters:
  --status <s>              Filter by status (pending, processing, completed, failed)
  --search <text>           Search file names and descriptions
  --archived                Show only archived jobs
  --tag <value>             Filter by tag (repeatable)
  --category <value>        Filter by diligence category (repeatable)
  --doc-type <value>        Filter by document type (repeatable)
  --doc-category <value>    Filter by document category (repeatable)
  --person <value>          Filter by person (repeatable)
  --org <value>             Filter by organization (repeatable)
  --location <value>        Filter by location (repeatable)
  --flag <value>            Filter by inconsistency flag (repeatable)
  --det-tag <value>         Filter by deterministic tag (repeatable)
  --from <date>             Jobs created on or after date (YYYY-MM-DD)
  --to <date>               Jobs created on or before date (YYYY-MM-DD)

Pagination & sorting:
  --limit <n>               Results per page (default: 50)
  --offset <n>              Skip first n results
  --all                     Fetch all pages
  --sort <field>            Sort by: created_at, updated_at, file_name, status
  --dir <asc|desc>          Sort direction (default: desc)

Output:
  --json                    Output raw JSON
  --filters                 Show available filter values for the project
`.trim();

export async function jobsListCommand(args: string[]) {
  const { flags, arrayFlags } = parseFlags(args);

  if (flags.help === "" || flags.h === "") {
    console.log(JOBS_LIST_HELP);
    return;
  }

  const projectId = await resolveProjectId(flags);
  const json = flags.json !== undefined;

  if (!projectId) {
    console.error(JOBS_LIST_HELP);
    process.exit(1);
  }

  // Show available filters for the project
  if (flags.filters !== undefined) {
    const facets = await api(`/filters/${projectId}`);
    if (json) {
      console.log(JSON.stringify(facets, null, 2));
      return;
    }
    for (const [key, values] of Object.entries(facets)) {
      const arr = values as string[];
      if (arr.length === 0) continue;
      console.log(`${key} (${arr.length}):`);
      for (const v of arr) {
        console.log(`  ${v}`);
      }
      console.log();
    }
    return;
  }

  const pageSize = flags.limit ? parseInt(flags.limit) : 50;
  const offset = flags.offset ? parseInt(flags.offset) : 0;
  const all = flags.all !== undefined;

  // Helper to get array flag values (empty array if not set)
  const arr = (key: string) => {
    const vals = arrayFlags[key];
    return vals && vals.length > 0 && vals[0] !== "" ? vals : undefined;
  };

  const body: Record<string, any> = {
    projectId,
    ...(flags.status && { status: flags.status }),
    ...(flags.search && { search: flags.search }),
    ...(flags.archived !== undefined && { archived: flags.archived !== "false" }),
    ...(arr("tag") && { tags: arr("tag") }),
    ...(arr("category") && { diligenceCategories: arr("category") }),
    ...(arr("doc-type") && { documentTypes: arr("doc-type") }),
    ...(arr("doc-category") && { documentCategories: arr("doc-category") }),
    ...(arr("person") && { people: arr("person") }),
    ...(arr("org") && { organizations: arr("org") }),
    ...(arr("location") && { locations: arr("location") }),
    ...(arr("flag") && { inconsistencyFlags: arr("flag") }),
    ...(arr("det-tag") && { deterministicTags: arr("det-tag") }),
    ...(flags.from && { dateFrom: flags.from }),
    ...(flags.to && { dateTo: flags.to }),
    ...(flags.sort && { sortBy: flags.sort }),
    ...(flags.dir && { sortDir: flags.dir }),
  };

  const fetchPage = async (pageOffset: number) =>
    api("/jobs/list", { method: "POST", body: { ...body, limit: pageSize, offset: pageOffset } });

  if (all) {
    let allJobs: any[] = [];
    let currentOffset = 0;
    let total = 0;

    while (true) {
      const data = await fetchPage(currentOffset);
      total = data.total;
      allJobs = allJobs.concat(data.jobs);
      if (!data.hasMore) break;
      currentOffset += pageSize;
    }

    if (json) {
      console.log(JSON.stringify({ jobs: allJobs, total }, null, 2));
      return;
    }

    console.log(`Total: ${total} jobs\n`);
    for (const j of allJobs) {
      const meta = j.metadata;
      const cat = meta.document_category || "";
      console.log(`${j.status.padEnd(10)} ${j.fileName}${cat ? ` [${cat}]` : ""}`);
    }
    return;
  }

  const data = await fetchPage(offset);

  if (json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log(`Total: ${data.total} jobs (showing ${offset + 1}–${offset + data.jobs.length})\n`);

  for (const j of data.jobs) {
    const meta = j.metadata;
    const cat = meta.document_category || "";
    console.log(`${j.status.padEnd(10)} ${j.fileName}${cat ? ` [${cat}]` : ""}`);
  }

  if (data.hasMore) {
    console.log(`\n... ${data.total - (offset + data.jobs.length)} more (use --offset ${offset + pageSize} or --all)`);
  }
}

const JOBS_WAIT_HELP = `
Usage: dillion jobs wait <job-id> [options]

Poll until the job finishes ingestion (status becomes completed) or fails.
Shows per-step timing while waiting (from job step started/completed timestamps).

  --interval <sec>   Seconds between polls (default: 5)
  --timeout <sec>    Give up after this many seconds (default: 0 = no limit)
  --json             Print final job payload as JSON on success

Exits 0 when the job status is completed; exits 1 on failure or timeout.
`.trim();

export async function jobsWaitCommand(args: string[]) {
  const { flags, positional } = parseFlags(args);

  if (flags.help === "" || flags.h === "") {
    console.log(JOBS_WAIT_HELP);
    return;
  }

  const jobId = positional[0];
  const json = flags.json !== undefined;
  const intervalSec = flags.interval ? parseFloat(flags.interval) : 5;
  const timeoutSec = flags.timeout !== undefined ? parseInt(flags.timeout, 10) : 0;

  if (!jobId || jobId.startsWith("--")) {
    console.error(JOBS_WAIT_HELP);
    process.exit(1);
  }
  if (intervalSec <= 0 || Number.isNaN(intervalSec)) {
    console.error("Error: --interval must be a positive number");
    process.exit(1);
  }
  if (flags.timeout !== undefined && (Number.isNaN(timeoutSec) || timeoutSec < 0)) {
    console.error("Error: --timeout must be a non-negative integer (0 = no limit)");
    process.exit(1);
  }

  await waitForJobCompletion({
    jobId,
    intervalSec,
    timeoutSec,
    json,
  });
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
