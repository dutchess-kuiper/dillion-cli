import { basename, dirname, join } from "path";
import { mkdir } from "fs/promises";
import { api } from "../api";
import { getConfig } from "../config";
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

  const results = await Promise.all(
    positional.map((jobId) =>
      downloadJob({
        jobId,
        projectId,
        format,
        out,
        multiple: positional.length > 1,
      })
    )
  );

  if (json) {
    console.log(JSON.stringify({ files: results }, null, 2));
    return;
  }

  for (const result of results) {
    if (result.error) {
      console.error(`FAIL  ${result.jobId}: ${result.error}`);
      continue;
    }

    const label = result.format === "txt" ? "TXT" : "FILE";
    console.log(`${label}  ${result.fileName}`);
    console.log(`  ${result.savedTo}\n`);
  }
}

async function downloadJob(options: {
  jobId: string;
  projectId?: string;
  format: "original" | "txt";
  out?: string;
  multiple: boolean;
}) {
  const { jobId, projectId, format, out, multiple } = options;

  try {
    const direct = await tryDirectDownload({ jobId, projectId, format });
    if (direct) {
      const savedTo = await saveDownload({
        buffer: direct.buffer,
        fileName: direct.fileName,
        out,
        multiple,
      });

      return { jobId, format, fileName: direct.fileName, savedTo, source: "direct" as const };
    }

    if (format === "txt") {
      throw new Error("Server does not support direct txt downloads yet.");
    }

    const fallback = await downloadViaPresignedUrl({ jobId, projectId });
    const savedTo = await saveDownload({
      buffer: fallback.buffer,
      fileName: fallback.fileName,
      out,
      multiple,
    });

    return { jobId, format, fileName: fallback.fileName, savedTo, source: "presigned" as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { jobId, format, error: message };
  }
}

async function tryDirectDownload(options: {
  jobId: string;
  projectId?: string;
  format: "original" | "txt";
}) {
  const { apiKey, baseUrl } = await getConfig();
  const url = new URL(`${baseUrl}/files/download/${options.jobId}`);
  if (options.projectId) url.searchParams.set("projectId", options.projectId);
  if (options.format !== "original") url.searchParams.set("format", options.format);

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!res.ok) {
    const body = await res.text();

    if (res.status === 405) {
      return null;
    }

    if (res.status === 404 && body.includes("Cannot GET")) {
      return null;
    }

    throw new Error(parseErrorMessage(body, res.status));
  }

  const fileName = getDownloadFileName(res) || defaultFileName(options.jobId, options.format);
  const buffer = Buffer.from(await res.arrayBuffer());
  return { fileName, buffer };
}

async function downloadViaPresignedUrl(options: {
  jobId: string;
  projectId?: string;
}) {
  const data = await api("/files/download", {
    method: "POST",
    body: { jobIds: [options.jobId], ...(options.projectId && { projectId: options.projectId }) },
  });

  const entry = data.urls?.[0];
  if (!entry) {
    throw new Error("No download URL returned");
  }
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

  return {
    fileName: sanitizeFileName(entry.fileName || defaultFileName(options.jobId, "original")),
    buffer: Buffer.from(await res.arrayBuffer()),
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

function getDownloadFileName(res: Response) {
  const disposition = res.headers.get("content-disposition");
  if (!disposition) return null;

  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return sanitizeFileName(decodeURIComponent(utf8Match[1]));
  }

  const plainMatch = disposition.match(/filename="?([^"]+)"?/i);
  if (plainMatch?.[1]) {
    return sanitizeFileName(plainMatch[1]);
  }

  return null;
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
