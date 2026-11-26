import { basename, dirname, join } from "path";
import { mkdir } from "fs/promises";
import { api, apiUpload, buildHeaders, failWithApiError, formatApiError, isOrgScopeApiError, explainNetworkError } from "../api";
import { getConfig } from "../config";
import { waitForJobCompletion } from "../jobWait";
import { requireProjectId, resolveProjectId } from "../projectContext";
import { parseFlags } from "../flags";

const FILES_UPLOAD_HELP = `
Usage: dillion files upload <file> [...] --project <id> [options]

  --wait              After each upload, wait until ingestion completes (see jobs wait)
  --interval <sec>    Poll interval when using --wait (default: 5)
  --timeout <sec>     Max wait seconds per file with --wait, 0 = no limit (default: 0)
  --force             Upload even if a job with the same file name already exists
  --json              Raw JSON (per file or { uploads: [...] })

Set a default project with: dillion project use <id>  (then -p is optional)
`.trim();

async function findExistingJobByFileName(projectId: string, fileName: string) {
  const data = await api("/jobs/list", {
    method: "POST",
    body: { projectId, search: fileName, limit: 80 },
  });
  const jobs = (data.jobs ?? []) as Array<{ id: string; fileName: string; status: string }>;
  return jobs.find((j) => j.fileName === fileName);
}

export async function filesUploadCommand(args: string[]) {
  const { flags, positional } = parseFlags(args);

  if (flags.help === "" || flags.h === "") {
    console.log(FILES_UPLOAD_HELP);
    return;
  }

  const projectId = await requireProjectId(
    flags,
    FILES_UPLOAD_HELP
  );
  const json = flags.json !== undefined;
  const wait = flags.wait !== undefined;
  const force = flags.force !== undefined;
  const intervalSec = flags.interval ? parseFloat(flags.interval) : 5;
  const timeoutSec = flags.timeout !== undefined ? parseInt(flags.timeout, 10) : 0;

  if (positional.length === 0) {
    console.error(FILES_UPLOAD_HELP);
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

  const results: Record<string, unknown>[] = [];

  for (const filePath of positional) {
    const baseName = basename(filePath);
    if (!force) {
      const existing = await findExistingJobByFileName(projectId, baseName);
      if (existing) {
        console.error(
          `Skipping ${baseName}: a job with this file name already exists (job ${existing.id}, status=${existing.status}).\n` +
            `  Use --force to upload anyway.`
        );
        if (json) {
          results.push({
            path: filePath,
            skipped: true,
            reason: "duplicate_file_name",
            existing_job_id: existing.id,
            existing_status: existing.status,
          });
        }
        continue;
      }
    }

    const data = await apiUpload(filePath, projectId);
    const row: Record<string, unknown> = { path: filePath, ...data };
    results.push(row);

    if (!json) {
      const jobId = row.job_id as string | undefined;
      const fileName = row.file_name as string | undefined;
      const s3Key = row.s3_key as string | undefined;
      if (jobId) {
        const s3Note = s3Key ? `  s3_key=${s3Key}` : "";
        console.log(`${fileName ?? baseName}  job_id=${jobId}${s3Note}`);
      } else {
        console.log(JSON.stringify(row));
      }
    }

    if (wait && row.job_id) {
      const final = await waitForJobCompletion({
        jobId: String(row.job_id),
        intervalSec,
        timeoutSec,
        json,
        ...(json ? { printJsonOnSuccess: false as const } : {}),
      });
      if (json) {
        row.job_completed = final;
      }
    }
  }

  if (json) {
    console.log(JSON.stringify(positional.length === 1 ? results[0] : { uploads: results }, null, 2));
  }
}

export async function filesSearchCommand(args: string[]) {
  const { flags, positional } = parseFlags(args);
  const query = positional.join(" ");
  const projectId = await requireProjectId(
    flags,
    "Usage: dillion files search <query> --project <id>  (or: dillion project use <id>)"
  );
  const limit = flags.limit ? parseInt(flags.limit) : 50;
  const json = flags.json !== undefined;

  if (!query) {
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
  const projectId = await resolveProjectId(flags);
  const json = flags.json !== undefined;
  const format = (flags.format || "original").toLowerCase();
  const out = flags.out || flags.o;

  if (positional.length === 0) {
    console.error("Usage: dillion files download <jobId...> [--project <id>] [--format original|txt] [--out <path>]");
    process.exit(1);
  }

  if (format !== "original" && format !== "txt") {
    console.error("Usage: --format must be one of: original, txt");
    process.exit(1);
  }

  if (json) {
    if (format === "original") {
      const data = await api("/files/download", {
        method: "POST",
        body: { jobIds: positional, ...(projectId && { projectId }) },
      });
      const entries: Array<{ jobId?: string; error?: string | null; url?: string | null }> =
        Array.isArray(data?.urls) ? data.urls : [];
      // Ids the server left out (e.g. jobs the caller can't see) become error
      // entries, so the JSON accounts for every requested id.
      const missing = missingJobIds(positional, entries).map((jobId) => ({
        jobId,
        url: null,
        error: "not returned by the server",
      }));
      const urls = [...entries, ...missing];
      console.log(JSON.stringify({ ...data, urls }, null, 2));
      reportJsonDownloadFailures(
        urls.map((e) => ({ jobId: String(e.jobId ?? ""), error: e.error || (e.url ? undefined : "no URL") })),
      );
      return;
    }

    // One bad job id must not lose the others: each file reports its own error.
    const files = await Promise.all(
      positional.map(async (jobId) => {
        try {
          return await fetchTextJob({ jobId, projectId });
        } catch (error) {
          return { jobId, error: error instanceof Error ? error.message : String(error) };
        }
      })
    );
    console.log(JSON.stringify({ files }, null, 2));
    reportJsonDownloadFailures(
      files.map((f) => ({ jobId: f.jobId, error: "error" in f ? f.error : undefined })),
    );
    return;
  }

  if (format === "original") {
    const results = await downloadOriginalJobs({
      jobIds: positional,
      projectId,
      out,
      multiple: positional.length > 1,
    });

    for (const result of results) {
      if (result.error) {
        console.error(`FAIL  ${result.jobId}: ${result.error}`);
        continue;
      }

      console.log(`FILE  ${result.fileName}`);
      console.log(`  ${result.savedTo}\n`);
    }
    exitForDownloadFailures(results);
    return;
  }

  const results = await Promise.all(
    positional.map(async (jobId) => {
      try {
        const file = await fetchTextJob({ jobId, projectId });
        const savedTo = await saveDownload({
          buffer: Buffer.from(file.text, "utf-8"),
          fileName: file.fileName,
          out,
          multiple: positional.length > 1,
        });

        return { jobId: file.jobId, fileName: file.fileName, savedTo };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { jobId, error: message };
      }
    })
  );

  for (const result of results) {
    if (result.error) {
      console.error(`FAIL  ${result.jobId}: ${result.error}`);
      continue;
    }

    console.log(`TXT   ${result.fileName}`);
    console.log(`  ${result.savedTo}\n`);
  }
  exitForDownloadFailures(results);
}

/**
 * Exit status for a batch download: 0 only when every requested file was
 * saved. Failures don't stop the batch (the other files still download); the
 * command just exits 1 at the end so scripts can tell.
 */
export function downloadOutcome(results: Array<{ error?: string | null }>): {
  failed: number;
  total: number;
  exitCode: 0 | 1;
} {
  const failed = results.filter((r) => r.error).length;
  return { failed, total: results.length, exitCode: failed > 0 ? 1 : 0 };
}

/**
 * Requested job ids missing from the server's response. Bastion accepts ids in
 * any case but answers with Postgres's lowercase form, so compare
 * case-insensitively; a missing id is reported as the caller typed it.
 */
export function missingJobIds(
  requested: string[],
  entries: Array<{ jobId?: string | null }>,
): string[] {
  const returned = new Set(entries.map((e) => String(e.jobId ?? "").toLowerCase()));
  return requested.filter((id) => !returned.has(id.toLowerCase()));
}

function exitForDownloadFailures(results: Array<{ jobId?: string; error?: string | null }>): void {
  const { failed, total, exitCode } = downloadOutcome(results);
  if (exitCode === 0) return;
  console.error(
    failed === total
      ? `No files downloaded (${failed} failed).`
      : `${total - failed} of ${total} files downloaded; ${failed} failed.`,
  );
  process.exit(exitCode);
}

/**
 * --json: stdout already holds every file's result, failures included as
 * `error` entries, so the command exits 0 and callers read the JSON. Scripts
 * (e.g. the DDD citation bake) discard stdout on a non-zero exit, which would
 * lose the good URLs along with the bad one. Failures are also named on stderr.
 */
function reportJsonDownloadFailures(results: Array<{ jobId?: string; error?: string | null }>): void {
  for (const r of results) {
    if (r.error) console.error(`FAIL  ${r.jobId ?? "?"}: ${r.error}`);
  }
}

async function downloadOriginalJobs(options: {
  jobIds: string[];
  projectId?: string;
  out?: string;
  multiple: boolean;
}) {
  const data = await api("/files/download", {
    method: "POST",
    body: { jobIds: options.jobIds, ...(options.projectId && { projectId: options.projectId }) },
  });

  const entries = Array.isArray(data.urls) ? data.urls : [];
  const missing = missingJobIds(options.jobIds, entries)
    .map((jobId) => ({ jobId, error: "not returned by the server" }) as { jobId: string; error?: string; fileName?: string; savedTo?: string });
  const fetched = await Promise.all(
    entries.map(async (entry: any) => {
      const jobId = String(entry.jobId || "");

      try {
        if (entry.error) {
          throw new Error(entry.error);
        }
        if (!entry.url) {
          throw new Error("Download URL missing from response");
        }

        const res = await fetch(entry.url);
        if (!res.ok) {
          throw new Error(`Signed URL download failed with ${res.status}`);
        }

        const fileName = sanitizeFileName(entry.fileName || defaultFileName(jobId, "original"));
        const savedTo = await saveDownload({
          buffer: Buffer.from(await res.arrayBuffer()),
          fileName,
          out: options.out,
          multiple: options.multiple,
        });

        return { jobId, fileName, savedTo };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { jobId, error: message };
      }
    })
  );
  return [...fetched, ...missing];
}

async function fetchTextJob(options: {
  jobId: string;
  projectId?: string;
}) {
  const { apiKey, baseUrl } = await getConfig();
  const url = new URL(`${baseUrl}/files/text/${options.jobId}`);
  if (options.projectId) url.searchParams.set("projectId", options.projectId);

  // A network failure here is this file's error (the batch reports it and
  // keeps going), not a reason to exit before the other files are reported.
  let res: Response;
  try {
    res = await fetch(url, {
      headers: buildHeaders(apiKey, { Accept: "application/json" }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    throw new Error(await explainNetworkError(err, String(url)));
  }

  let body: string;
  try {
    body = await res.text();
  } catch (err) {
    throw new Error(`the response was cut off (${err instanceof Error ? err.message : String(err)})`);
  }
  if (!res.ok) {
    if (res.status === 404 && body.includes("Cannot GET")) {
      throw new Error("Server does not support txt downloads yet.");
    }
    // Org-scoping failures apply to the whole invocation (every job in the batch
    // would fail the same way), so exit with the shared guidance. Anything else
    // (e.g. one bad job id) must THROW, not exit: the per-job catch in the batch
    // loop records `FAIL <jobId>` and keeps downloading the remaining jobs.
    if (isOrgScopeApiError(body)) {
      failWithApiError(res.status, body);
    }
    throw new Error(formatApiError(res.status, body));
  }

  const data = JSON.parse(body) as { jobId?: string; fileName?: string; text?: string };
  if (typeof data.text !== "string") {
    throw new Error("Text payload missing from response");
  }

  return {
    jobId: data.jobId || options.jobId,
    fileName: sanitizeFileName(data.fileName || defaultFileName(options.jobId, "txt")),
    text: data.text,
  };
}

async function saveDownload(options: {
  buffer: Buffer;
  fileName: string;
  out?: string;
  multiple: boolean;
}) {
  const target = resolveOutputPath(options);
  await mkdir(dirname(target), { recursive: true });
  await Bun.write(target, options.buffer);
  return target;
}

function resolveOutputPath(options: {
  fileName: string;
  out?: string;
  multiple: boolean;
}) {
  const safeName = sanitizeFileName(options.fileName);

  if (!options.out) {
    return join(process.cwd(), safeName);
  }

  if (options.multiple) {
    return join(options.out, safeName);
  }

  if (looksLikeDirectory(options.out)) {
    return join(options.out, safeName);
  }

  return options.out;
}

function looksLikeDirectory(out: string) {
  if (out.endsWith("/") || out.endsWith("\\")) return true;

  const parsed = basename(out);
  return !parsed.includes(".");
}

function sanitizeFileName(name: string) {
  return basename(name).replace(/[/\\]/g, "_");
}

function defaultFileName(jobId: string, format: "original" | "txt") {
  return format === "txt" ? `${jobId}.txt` : jobId;
}
