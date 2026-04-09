import { basename, dirname, join } from "path";
import { mkdir } from "fs/promises";
import { api, apiUpload } from "../api";
import { getConfig } from "../config";
import { parseFlags } from "../flags";

export async function filesUploadCommand(args: string[]) {
  const { flags, positional } = parseFlags(args);
  const projectId = flags.project || flags.p;
  const json = flags.json !== undefined;

  if (!projectId || positional.length === 0) {
    console.error("Usage: dillion files upload <file> [...] --project <id>");
    process.exit(1);
  }

  const results: Record<string, unknown>[] = [];

  for (const filePath of positional) {
    const data = await apiUpload(filePath, projectId);
    results.push({ path: filePath, ...data });
  }

  if (json) {
    console.log(JSON.stringify(positional.length === 1 ? results[0] : { uploads: results }, null, 2));
    return;
  }

  for (const row of results) {
    const jobId = row.job_id as string | undefined;
    const fileName = row.file_name as string | undefined;
    const localPath = row.path as string | undefined;
    if (jobId) {
      console.log(`${fileName ?? localPath ?? "?"}  job_id=${jobId}`);
    } else {
      console.log(JSON.stringify(row));
    }
  }
}

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
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    const files = await Promise.all(
      positional.map((jobId) => fetchTextJob({ jobId, projectId }))
    );
    console.log(JSON.stringify({ files }, null, 2));
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
  return Promise.all(
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
}

async function fetchTextJob(options: {
  jobId: string;
  projectId?: string;
}) {
  const { apiKey, baseUrl } = await getConfig();
  const url = new URL(`${baseUrl}/files/text/${options.jobId}`);
  if (options.projectId) url.searchParams.set("projectId", options.projectId);

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });

  const body = await res.text();
  if (!res.ok) {
    if (res.status === 404 && body.includes("Cannot GET")) {
      throw new Error("Server does not support txt downloads yet.");
    }
    throw new Error(parseErrorMessage(body, res.status));
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

function parseErrorMessage(body: string, status: number) {
  try {
    const parsed = JSON.parse(body) as { error?: string };
    return parsed.error || `Request failed with ${status}`;
  } catch {
    return body || `Request failed with ${status}`;
  }
}
