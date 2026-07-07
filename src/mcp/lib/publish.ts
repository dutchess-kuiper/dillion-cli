import { basename, isAbsolute } from "path";
import {
  MAX_ATTACHED_PDF_BYTES,
  MAX_ATTACHED_WORKBOOK_BYTES,
  WORKBOOK_CONTENT_TYPES,
} from "../../commands/artifacts";

/**
 * Client-side mirrors of Bastion's report-upload caps, checked BEFORE upload so a
 * too-big bundle fails fast with a clear message instead of a raw 413.
 *
 * Server mirror: Bastion `MAX_REPORT_ZIP_BYTES` — multer per-file cap on the main report
 * zip, rejected before `validateReportUpload` even runs.
 */
export const MAX_REPORT_ZIP_BYTES = 100 * 1024 * 1024;
/** Server mirror: Bastion `MAX_COMBINED_REPORT_UPLOAD_BYTES` — dist.zip + raw source zip. */
export const MAX_COMBINED_REPORT_UPLOAD_BYTES = 128 * 1024 * 1024;

export function formatBytes(n: number): string {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1024 / 1024).toFixed(2)} MiB`;
}

/**
 * Enforce BOTH Bastion caps before upload. `rawBytes` is the source zip size (0 when no
 * source bundle is attached). Returns an error message to surface as a clean tool error,
 * or null when the sizes are acceptable.
 */
export function checkPublishSizes(distBytes: number, rawBytes: number): string | null {
  if (distBytes > MAX_REPORT_ZIP_BYTES) {
    return (
      `Report bundle (dist.zip) is ${formatBytes(distBytes)}, over the ` +
      `${formatBytes(MAX_REPORT_ZIP_BYTES)} limit (Bastion MAX_REPORT_ZIP_BYTES). ` +
      `Shrink the built bundle before publishing.`
    );
  }
  const combined = distBytes + rawBytes;
  if (combined > MAX_COMBINED_REPORT_UPLOAD_BYTES) {
    return (
      `Combined upload (dist.zip + source.zip) is ${formatBytes(combined)}, over the ` +
      `${formatBytes(MAX_COMBINED_REPORT_UPLOAD_BYTES)} limit ` +
      `(Bastion MAX_COMBINED_REPORT_UPLOAD_BYTES). Publish with includeSource:false ` +
      `or shrink the source bundle.`
    );
  }
  return null;
}

export interface AttachmentEntry {
  field: string;
  blob: Blob;
  fileName: string;
  byteSize: number;
}

/**
 * Read + validate an attached PDF into a multipart entry. Throwing variant (plan N5:
 * MCP re-implements the CLI's print+return-null validators as throwing functions so the
 * shared constants can't drift). Requires an absolute path.
 */
export async function readPdfAttachment(pdfPath: string): Promise<AttachmentEntry> {
  if (!isAbsolute(pdfPath)) throw new Error(`pdfPath must be an absolute path (got: ${pdfPath}).`);
  if (!/\.pdf$/i.test(pdfPath)) throw new Error(`pdfPath must be a .pdf file (got: ${pdfPath}).`);
  const file = Bun.file(pdfPath);
  if (!(await file.exists())) throw new Error(`pdfPath not found: ${pdfPath}`);
  const bytes = await file.bytes();
  if (bytes.length === 0) throw new Error(`pdfPath is empty: ${pdfPath}`);
  if (bytes.length > MAX_ATTACHED_PDF_BYTES) {
    throw new Error(
      `pdfPath is ${formatBytes(bytes.length)}, over the ${formatBytes(MAX_ATTACHED_PDF_BYTES)} limit.`,
    );
  }
  return {
    field: "pdf_file",
    blob: new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
    fileName: basename(pdfPath),
    byteSize: bytes.length,
  };
}

/** Accepted workbook extension (lowercased, with dot) for a path, or null. */
export function workbookExtension(path: string): string | null {
  const lower = path.toLowerCase();
  for (const ext of Object.keys(WORKBOOK_CONTENT_TYPES)) {
    if (lower.endsWith(ext)) return ext;
  }
  return null;
}

/**
 * Read + validate an attached workbook (.xlsx/.xls/.csv) into a multipart entry using the
 * field name `workbook_file` (matching the CLI). Throwing variant. Requires an absolute path.
 */
export async function readWorkbookAttachment(workbookPath: string): Promise<AttachmentEntry> {
  if (!isAbsolute(workbookPath)) {
    throw new Error(`workbookPath must be an absolute path (got: ${workbookPath}).`);
  }
  const ext = workbookExtension(workbookPath);
  if (!ext) throw new Error(`workbookPath must be a .xlsx, .xls, or .csv file (got: ${workbookPath}).`);
  const file = Bun.file(workbookPath);
  if (!(await file.exists())) throw new Error(`workbookPath not found: ${workbookPath}`);
  const bytes = await file.bytes();
  if (bytes.length === 0) throw new Error(`workbookPath is empty: ${workbookPath}`);
  if (bytes.length > MAX_ATTACHED_WORKBOOK_BYTES) {
    throw new Error(
      `workbookPath is ${formatBytes(bytes.length)}, over the ${formatBytes(MAX_ATTACHED_WORKBOOK_BYTES)} limit.`,
    );
  }
  return {
    field: "workbook_file",
    blob: new Blob([new Uint8Array(bytes)], { type: WORKBOOK_CONTENT_TYPES[ext]! }),
    fileName: basename(workbookPath),
    byteSize: bytes.length,
  };
}
