import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { stat } from "fs/promises";
import { join } from "path";
import { z } from "zod";
import { api, apiDownloadToFile, apiUploadMultipart } from "../../api";
import { MAX_RAW_BUNDLE_ZIP_BYTES, excludeReportSourcePath } from "../../commands/artifacts";
import { buildZip, walkDirToZipInputs } from "../../zip";
import { requireProject } from "../lib/context";
import { requireAbsolute } from "../lib/download";
import {
  checkPublishSizes,
  formatBytes,
  readPdfAttachment,
  readWorkbookAttachment,
} from "../lib/publish";
import { jsonContent } from "../lib/result";
import { registerTool, type Toolset } from "../lib/register";

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function versionQuery(version?: number): string {
  return version != null ? `?version=${encodeURIComponent(String(version))}` : "";
}

const ArtifactsListInput = z.object({
  projectId: z.string().optional().describe("Project id. Defaults to the configured project."),
});

const ArtifactsGetInput = z.object({
  reportId: z.string().min(1).describe("Research report id."),
});

const ArtifactsPublishInput = z.object({
  dir: z
    .string()
    .min(1)
    .describe("Absolute path to the pre-built report directory (must contain dist/index.html). Never runs vite."),
  reportId: z
    .string()
    .optional()
    .describe("Publish a NEW VERSION of this report. Mutually exclusive with title."),
  title: z
    .string()
    .optional()
    .describe("Title for a NEW report (uses projectId). Mutually exclusive with reportId."),
  projectId: z.string().optional().describe("Project id for a new report (defaults to configured)."),
  description: z.string().optional().describe("Description for a new report."),
  notes: z.string().optional().describe("Version notes."),
  includeSource: z.boolean().optional().describe("Attach a source zip (default true)."),
  pdfPath: z.string().optional().describe("Absolute path to a PDF to attach."),
  workbookPath: z.string().optional().describe("Absolute path to a .xlsx/.xls/.csv workbook to attach."),
  memoChatEnabled: z.boolean().optional().describe("Enable/disable Ask memo chat on this report."),
});

const ArtifactsDownloadRawInput = z.object({
  reportId: z.string().min(1).describe("Research report id."),
  outPath: z.string().min(1).describe("Absolute path to write the source zip (required)."),
  version: z.number().int().min(1).optional().describe("Version number (default: latest)."),
});

const ArtifactsAttachPdfInput = z.object({
  reportId: z.string().min(1).describe("Research report id."),
  pdfPath: z.string().optional().describe("Absolute path to a PDF to attach/replace."),
  remove: z.boolean().optional().describe("Remove the attached PDF instead."),
  version: z.number().int().min(1).optional().describe("Target version (default: current)."),
});

const ArtifactsAttachWorkbookInput = z.object({
  reportId: z.string().min(1).describe("Research report id."),
  workbookPath: z.string().optional().describe("Absolute path to a .xlsx/.xls/.csv workbook to attach/replace."),
  remove: z.boolean().optional().describe("Remove the attached workbook instead."),
  version: z.number().int().min(1).optional().describe("Target version (default: current)."),
});

const ArtifactsSetMemoChatInput = z.object({
  reportId: z.string().min(1).describe("Research report id."),
  enabled: z.boolean().describe("Enable (true) or disable (false) Ask memo chat."),
});

export function registerArtifactsTools(server: McpServer, toolset: Toolset): void {
  registerTool(server, toolset, {
    name: "artifacts_list",
    description: "List research reports for a project.",
    inputSchema: ArtifactsListInput.shape,
    annotations: { readOnlyHint: true },
    handler: async (args: z.infer<typeof ArtifactsListInput>) => {
      const projectId = requireProject(args.projectId);
      const data = await api(`/projects/${encodeURIComponent(projectId)}/research-reports`);
      const list = Array.isArray(data)
        ? data.map((r: any) => ({
            id: r.id,
            title: r.title,
            current_version: r.current_version,
            updated_at: r.updated_at,
          }))
        : data;
      return jsonContent(list);
    },
  });

  registerTool(server, toolset, {
    name: "artifacts_get",
    description: "Get a research report and its versions (sizes, file counts, dates).",
    inputSchema: ArtifactsGetInput.shape,
    annotations: { readOnlyHint: true },
    handler: async (args: z.infer<typeof ArtifactsGetInput>) => {
      const data = await api(`/research-reports/${encodeURIComponent(args.reportId)}`);
      return jsonContent({
        id: data.id,
        title: data.title,
        projectId: data.project_id,
        currentVersion: data.current_version,
        versions: (data.versions ?? []).map((v: any) => ({
          versionNumber: v.version_number,
          byteSize: v.byte_size,
          fileCount: v.file_count,
          createdAt: v.created_at,
          ...(v.raw_bundle_byte_size != null ? { sourceByteSize: v.raw_bundle_byte_size } : {}),
          ...(v.pdf_byte_size != null ? { pdfByteSize: v.pdf_byte_size } : {}),
          ...(v.workbook_byte_size != null ? { workbookByteSize: v.workbook_byte_size } : {}),
        })),
      });
    },
  });

  registerTool(server, toolset, {
    name: "artifacts_publish",
    core: true,
    description:
      "Publish a pre-BUILT report bundle (dir/dist). Provide title (+projectId) for a new report " +
      "OR reportId for a new version. Uploads a source zip unless includeSource:false.",
    inputSchema: ArtifactsPublishInput.shape,
    handler: async (args: z.infer<typeof ArtifactsPublishInput>) => {
      const dir = requireAbsolute(args.dir, "dir");
      const distDir = join(dir, "dist");
      if (!(await pathExists(distDir))) {
        throw new Error(`Build output not found at ${distDir}. Build the report first.`);
      }
      if (!(await pathExists(join(distDir, "index.html")))) {
        throw new Error(`${distDir} does not contain index.html — refusing to publish.`);
      }
      if (args.reportId && args.title) {
        throw new Error("Pass reportId (new version) OR title (new report), not both.");
      }
      if (!args.reportId && !args.title) {
        throw new Error("Provide reportId (publish a new version) or title (publish a new report).");
      }

      const inputs = await walkDirToZipInputs(distDir);
      if (inputs.length === 0) throw new Error(`No files found under ${distDir}.`);
      const distZip = buildZip(inputs);
      const distBytes = distZip.length;

      let rawBytes = 0;
      let sourceSkipped: string | undefined;
      const extraFiles: { field: string; blob: Blob; fileName: string }[] = [];

      if (args.includeSource !== false) {
        const rawInputs = await walkDirToZipInputs(dir, { exclude: excludeReportSourcePath });
        if (rawInputs.length > 0) {
          const rawZip = buildZip(rawInputs);
          if (rawZip.length > MAX_RAW_BUNDLE_ZIP_BYTES) {
            sourceSkipped = `source zip is ${formatBytes(rawZip.length)}, over the ${formatBytes(
              MAX_RAW_BUNDLE_ZIP_BYTES,
            )} limit — published without source`;
          } else {
            rawBytes = rawZip.length;
            extraFiles.push({
              field: "raw_file",
              blob: new Blob([new Uint8Array(rawZip)], { type: "application/zip" }),
              fileName: "source.zip",
            });
          }
        } else {
          sourceSkipped = "no source files to bundle";
        }
      }

      // Client-side pre-check of BOTH Bastion caps (dist.zip ≤100MiB AND dist+raw ≤128MiB).
      const sizeError = checkPublishSizes(distBytes, rawBytes);
      if (sizeError) throw new Error(sizeError);

      if (args.pdfPath !== undefined) {
        const pdf = await readPdfAttachment(requireAbsolute(args.pdfPath, "pdfPath"));
        extraFiles.push({ field: pdf.field, blob: pdf.blob, fileName: pdf.fileName });
      }
      if (args.workbookPath !== undefined) {
        const wb = await readWorkbookAttachment(requireAbsolute(args.workbookPath, "workbookPath"));
        extraFiles.push({ field: wb.field, blob: wb.blob, fileName: wb.fileName });
      }

      const memoFields =
        args.memoChatEnabled === undefined
          ? {}
          : { memo_chat_enabled: args.memoChatEnabled ? "true" : "false" };
      const zipBlob = new Blob([new Uint8Array(distZip)], { type: "application/zip" });
      const attach = extraFiles.length > 0 ? extraFiles : undefined;

      if (args.reportId) {
        const res = await apiUploadMultipart(
          `/research-reports/${encodeURIComponent(args.reportId)}/versions`,
          {
            fileBlob: zipBlob,
            fileName: "dist.zip",
            fields: { ...(args.notes ? { notes: args.notes } : {}), ...memoFields },
            extraFiles: attach,
          },
        );
        return jsonContent({
          reportId: args.reportId,
          version: res.version_number,
          fileCount: res.file_count,
          byteSize: res.byte_size,
          ...(res.raw_bundle_byte_size != null ? { sourceByteSize: res.raw_bundle_byte_size } : {}),
          ...(res.pdf_byte_size != null ? { pdfByteSize: res.pdf_byte_size } : {}),
          ...(res.workbook_byte_size != null ? { workbookByteSize: res.workbook_byte_size } : {}),
          ...(sourceSkipped ? { sourceSkipped } : {}),
        });
      }

      const projectId = requireProject(args.projectId);
      const res = await apiUploadMultipart(
        `/projects/${encodeURIComponent(projectId)}/research-reports`,
        {
          fileBlob: zipBlob,
          fileName: "dist.zip",
          fields: {
            title: args.title!,
            ...(args.description ? { description: args.description } : {}),
            ...(args.notes ? { notes: args.notes } : {}),
            ...memoFields,
          },
          extraFiles: attach,
        },
      );
      const report = res.report ?? {};
      const v0 = report.versions?.[0];
      return jsonContent({
        reportId: report.id,
        title: report.title,
        version: report.current_version,
        ...(v0?.file_count != null ? { fileCount: v0.file_count } : {}),
        ...(v0?.byte_size != null ? { byteSize: v0.byte_size } : {}),
        ...(v0?.raw_bundle_byte_size != null ? { sourceByteSize: v0.raw_bundle_byte_size } : {}),
        ...(v0?.pdf_byte_size != null ? { pdfByteSize: v0.pdf_byte_size } : {}),
        ...(v0?.workbook_byte_size != null ? { workbookByteSize: v0.workbook_byte_size } : {}),
        ...(sourceSkipped ? { sourceSkipped } : {}),
      });
    },
  });

  registerTool(server, toolset, {
    name: "artifacts_download_raw",
    description: "Download a report version's source zip to an absolute path.",
    inputSchema: ArtifactsDownloadRawInput.shape,
    handler: async (args: z.infer<typeof ArtifactsDownloadRawInput>) => {
      const outPath = requireAbsolute(args.outPath, "outPath");
      await apiDownloadToFile(
        `/research-reports/${encodeURIComponent(args.reportId)}/raw${versionQuery(args.version)}`,
        outPath,
      );
      return jsonContent({ path: outPath });
    },
  });

  registerTool(server, toolset, {
    name: "artifacts_attach_pdf",
    description:
      "Attach/replace or remove the PDF on a live report version in place (no republish). " +
      "Pass pdfPath to attach, or remove:true to remove.",
    inputSchema: ArtifactsAttachPdfInput.shape,
    handler: async (args: z.infer<typeof ArtifactsAttachPdfInput>) => {
      if (args.remove && args.pdfPath) throw new Error("Pass pdfPath OR remove:true, not both.");
      if (!args.remove && !args.pdfPath) throw new Error("Provide pdfPath (attach) or remove:true.");
      if (args.remove) {
        const res = await api(
          `/research-reports/${encodeURIComponent(args.reportId)}/pdf${versionQuery(args.version)}`,
          { method: "DELETE" },
        );
        return jsonContent({ versionNumber: res.version_number });
      }
      const pdf = await readPdfAttachment(requireAbsolute(args.pdfPath!, "pdfPath"));
      const res = await apiUploadMultipart(`/research-reports/${encodeURIComponent(args.reportId)}/pdf`, {
        method: "PUT",
        fileField: "pdf_file",
        fileBlob: pdf.blob,
        fileName: pdf.fileName,
        fields: { ...(args.version != null ? { version: String(args.version) } : {}) },
      });
      return jsonContent({ versionNumber: res.version_number, pdfByteSize: res.pdf_byte_size });
    },
  });

  registerTool(server, toolset, {
    name: "artifacts_attach_workbook",
    description:
      "Attach/replace or remove the workbook (.xlsx/.xls/.csv) on a live report version in place. " +
      "Pass workbookPath to attach, or remove:true to remove.",
    inputSchema: ArtifactsAttachWorkbookInput.shape,
    handler: async (args: z.infer<typeof ArtifactsAttachWorkbookInput>) => {
      if (args.remove && args.workbookPath) {
        throw new Error("Pass workbookPath OR remove:true, not both.");
      }
      if (!args.remove && !args.workbookPath) {
        throw new Error("Provide workbookPath (attach) or remove:true.");
      }
      if (args.remove) {
        const res = await api(
          `/research-reports/${encodeURIComponent(args.reportId)}/workbook${versionQuery(args.version)}`,
          { method: "DELETE" },
        );
        return jsonContent({ versionNumber: res.version_number });
      }
      const wb = await readWorkbookAttachment(requireAbsolute(args.workbookPath!, "workbookPath"));
      const res = await apiUploadMultipart(
        `/research-reports/${encodeURIComponent(args.reportId)}/workbook`,
        {
          method: "PUT",
          fileField: "workbook_file",
          fileBlob: wb.blob,
          fileName: wb.fileName,
          fields: { ...(args.version != null ? { version: String(args.version) } : {}) },
        },
      );
      return jsonContent({ versionNumber: res.version_number, workbookByteSize: res.workbook_byte_size });
    },
  });

  registerTool(server, toolset, {
    name: "artifacts_set_memo_chat",
    description: "Enable or disable Ask memo chat on a published report.",
    inputSchema: ArtifactsSetMemoChatInput.shape,
    handler: async (args: z.infer<typeof ArtifactsSetMemoChatInput>) => {
      const res = await api(`/research-reports/${encodeURIComponent(args.reportId)}/memo-chat`, {
        method: "PATCH",
        body: { enabled: args.enabled },
      });
      return jsonContent({
        reportId: args.reportId,
        memoChatEnabled: res?.memo_chat_enabled ?? args.enabled,
      });
    },
  });
}
