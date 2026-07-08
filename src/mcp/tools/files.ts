import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { basename } from "path";
import { z } from "zod";
import { api, apiUpload, buildHeaders, formatApiError } from "../../api";
import type { JobWaitPayload } from "../../jobWait";
import { getApiKey, getBaseUrl, requireProject } from "../lib/context";
import { requireAbsolute, sanitizeFileName, saveBufferToDir } from "../lib/download";
import { boundedJobWait } from "../lib/poll";
import { jsonContent } from "../lib/result";
import { registerTool, type Toolset } from "../lib/register";
import { FILE_DOWNLOAD_TIMEOUT_MS, JOB_POLL_FETCH_TIMEOUT_MS } from "../lib/timeouts";
import { truncate } from "../lib/trim";

/**
 * The CLI detects a not-yet-deployed `/files/text/:id` route by a 404 whose body contains
 * "Cannot GET". Reproduced exactly here so the MCP handler can raise the CLI's friendly
 * "not supported" message instead of leaking a raw 404. Pure so it is unit-testable.
 */
export function detectTxtUnsupported(status: number, body: string): boolean {
  return status === 404 && body.includes("Cannot GET");
}

async function findExistingJobByFileName(projectId: string, fileName: string) {
  const data = await api("/jobs/list", {
    method: "POST",
    body: { projectId, search: fileName, limit: 80 },
  });
  const jobs = (data.jobs ?? []) as Array<{ id: string; fileName: string; status: string }>;
  return jobs.find((j) => j.fileName === fileName);
}

const FilesSearchInput = z.object({
  query: z.string().min(1).describe("Substring to match against file names."),
  projectId: z.string().optional().describe("Project id. Defaults to the configured project."),
  limit: z.number().int().min(1).max(200).optional().describe("Max results (default 50)."),
});

const FilesTextInput = z.object({
  jobId: z.string().min(1).describe("Job id of the document."),
  projectId: z.string().optional().describe("Optional project id scope."),
  maxChars: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Truncate extracted text to this many chars (default 50000)."),
});

const FilesDownloadInput = z.object({
  jobIds: z.array(z.string().min(1)).min(1).describe("Job ids to download."),
  destDir: z.string().min(1).describe("Absolute directory to write files into (required)."),
  projectId: z.string().optional().describe("Optional project id scope."),
});

const FilesUploadInput = z.object({
  path: z.string().min(1).describe("Absolute path to the file to upload."),
  projectId: z.string().optional().describe("Project id. Defaults to the configured project."),
  force: z.boolean().optional().describe("Upload even if a job with the same file name exists."),
  wait: z.boolean().optional().describe("Poll ingestion after upload (bounded). Default false."),
  intervalSeconds: z.number().min(1).max(60).optional().describe("Poll interval when wait:true (default 5)."),
  maxWaitSeconds: z
    .number()
    .int()
    .min(1)
    .max(300)
    .optional()
    .describe("Bounded wait ceiling when wait:true (default 50, max 300)."),
});

export function registerFilesTools(server: McpServer, toolset: Toolset): void {
  registerTool(server, toolset, {
    name: "files_search",
    core: true,
    description: "Search a project's files by file name.",
    inputSchema: FilesSearchInput.shape,
    annotations: { readOnlyHint: true },
    handler: async (args: z.infer<typeof FilesSearchInput>) => {
      const projectId = requireProject(args.projectId);
      const limit = args.limit ?? 50;
      const data = await api("/files/search", {
        method: "POST",
        body: { projectId, query: args.query, limit },
      });
      return jsonContent({
        total: data.total,
        hasMore: data.hasMore,
        files: (data.jobs ?? []).map((j: any) => ({
          id: j.id,
          fileName: j.fileName,
          status: j.status,
        })),
      });
    },
  });

  registerTool(server, toolset, {
    name: "files_text",
    description:
      "Fetch a document's extracted plain text. Returns a clean 'not supported' error if the " +
      "server has not deployed the text endpoint.",
    inputSchema: FilesTextInput.shape,
    annotations: { readOnlyHint: true },
    handler: async (args: z.infer<typeof FilesTextInput>) => {
      const maxChars = args.maxChars ?? 50000;
      const url = new URL(`${getBaseUrl()}/files/text/${encodeURIComponent(args.jobId)}`);
      if (args.projectId) url.searchParams.set("projectId", args.projectId);
      const res = await fetch(url, {
        headers: buildHeaders(getApiKey(), { Accept: "application/json" }),
      });
      const body = await res.text();
      if (!res.ok) {
        if (detectTxtUnsupported(res.status, body)) {
          throw new Error("Server does not support txt downloads yet.");
        }
        throw new Error(formatApiError(res.status, body));
      }
      const data = JSON.parse(body) as { jobId?: string; fileName?: string; text?: string };
      const { value, truncated, total } = truncate(typeof data.text === "string" ? data.text : "", maxChars);
      return jsonContent({
        jobId: data.jobId ?? args.jobId,
        fileName: data.fileName,
        text: value,
        truncated,
        totalChars: total,
      });
    },
  });

  registerTool(server, toolset, {
    name: "files_download",
    description:
      "Download original document files (via 1h presigned URLs) into an absolute directory. " +
      "Reports per-file failures and any job ids the server silently dropped (missing).",
    inputSchema: FilesDownloadInput.shape,
    handler: async (args: z.infer<typeof FilesDownloadInput>) => {
      const destDir = requireAbsolute(args.destDir, "destDir");
      const data = await api("/files/download", {
        method: "POST",
        body: { jobIds: args.jobIds, ...(args.projectId && { projectId: args.projectId }) },
      });
      const entries: any[] = Array.isArray(data.urls) ? data.urls : [];
      const returned = new Set(entries.map((e) => String(e.jobId ?? "")));
      const missing = args.jobIds.filter((id) => !returned.has(id));

      const downloaded: { jobId: string; fileName: string; path: string }[] = [];
      const failed: { jobId: string; error: string }[] = [];
      for (const entry of entries) {
        const jobId = String(entry.jobId ?? "");
        try {
          if (entry.error) throw new Error(String(entry.error));
          if (!entry.url) throw new Error("Download URL missing from response");
          const r = await fetch(entry.url, { signal: AbortSignal.timeout(FILE_DOWNLOAD_TIMEOUT_MS) });
          if (!r.ok) throw new Error(`Signed URL download failed with ${r.status}`);
          const fileName = sanitizeFileName(entry.fileName || jobId);
          const path = await saveBufferToDir(destDir, fileName, Buffer.from(await r.arrayBuffer()));
          downloaded.push({ jobId, fileName, path });
        } catch (err) {
          failed.push({ jobId, error: err instanceof Error ? err.message : String(err) });
        }
      }
      return jsonContent({ downloaded, failed, missing });
    },
  });

  registerTool(server, toolset, {
    name: "files_upload",
    description:
      "Upload a file (absolute path) for ingestion. Skips duplicates by file name unless force:true. " +
      "With wait:true, polls ingestion (bounded — may return timedOut).",
    inputSchema: FilesUploadInput.shape,
    handler: async (args: z.infer<typeof FilesUploadInput>) => {
      const path = requireAbsolute(args.path, "path");
      const file = Bun.file(path);
      if (!(await file.exists())) throw new Error(`File not found: ${path}`);
      const projectId = requireProject(args.projectId);
      const fileName = basename(path);

      if (args.force !== true) {
        const existing = await findExistingJobByFileName(projectId, fileName);
        if (existing) {
          return jsonContent({
            fileName,
            skipped: true,
            reason: "duplicate_file_name",
            existingJobId: existing.id,
            existingStatus: existing.status,
          });
        }
      }

      const data = await apiUpload(path, projectId);
      const jobId = (data.job_id ?? (data as any).jobId) as string | undefined;
      const result: Record<string, unknown> = {
        jobId,
        fileName: (data.file_name as string) ?? fileName,
      };
      if (args.wait === true && jobId) {
        result.wait = await boundedJobWait({
          jobId: String(jobId),
          intervalSeconds: args.intervalSeconds,
          maxWaitSeconds: args.maxWaitSeconds,
          fetchJob: (id) =>
            api(`/jobs/${encodeURIComponent(id)}`, {
              signal: AbortSignal.timeout(JOB_POLL_FETCH_TIMEOUT_MS),
            }) as Promise<JobWaitPayload>,
        });
      }
      return jsonContent(result);
    },
  });
}
