import { mkdir, stat } from "fs/promises";
import { basename, dirname, join, resolve } from "path";
import { spawn } from "bun";
import { api, apiDownloadToFile, apiUploadMultipart } from "../api";
import { parseFlags } from "../flags";
import { requireProjectId } from "../projectContext";
import { VITE_REACT_TEMPLATE } from "../templates/viteReact";
import { buildZip, walkDirToZipInputs } from "../zip";

const ARTIFACTS_HELP = `
Usage: dillion artifacts <command> [options]

Authoring:
  init [dir]                    Scaffold a Vite + React report (default: ./dillion-report)
  dev [dir]                     Run the report dev server (delegates to vite)
  build [dir]                   Build the report bundle (delegates to vite build)

Publishing:
  publish [dir] --title <t> -p <pid>     Publish a NEW report from dir/dist
  publish [dir] --report <report-id>     Publish a NEW VERSION of an existing report
            (also uploads a source zip, excluding secrets/node_modules/dist/.git; use --no-raw to skip)
            (--pdf <path> attaches a PDF served by the share viewer's Download button)
            (--workbook <path> attaches a spreadsheet served by the viewer's Download workbook button)
  attach-pdf <report-id> --pdf <path> [--version N]
                                Attach/replace the PDF on a live version (no republish)
  attach-pdf <report-id> --remove [--version N]
                                Remove the attached PDF from a version
  attach-workbook <report-id> --workbook <path> [--version N]
                                Attach/replace the workbook (.xlsx/.xls/.csv) on a live version
  attach-workbook <report-id> --remove [--version N]
                                Remove the attached workbook from a version

Download:
  download-raw <report-id> --out <path> [--version N]   Save the source zip for a version

Discovery:
  list -p <pid>                 List research reports for a project
  get <report-id>               Show a report and its versions

Sharing:
  share <report-id> [--password <pw>] [--expires-days N] [--no-citations]
                                Create a share link (source preview on by default; use --no-citations to disable)
  share list <report-id>        List share links (active + revoked) for a report
  share update <report-id> <share-id> [options]
                                Change password, expiry, pin, or citation preview (see --help on each)

Common flags (share create/update):
  --password <pw>            Set or change password (8+ chars)
  --remove-password         Remove password (open link)
  --expires-days <N>        Set expiry to N days from now (1–365)
  --no-expiry               Remove expiry
  --version <N>             Pin to report version; combine with --latest to unpin
  --latest                  Pin to "always current version" (clears a version pin)
  --no-citations / --allow-citations   Toggle source preview for viewers

Common flags:
  --json                        Raw JSON output
  --notes <text>                Optional version notes
  --no-raw                      Skip uploading the source/collaboration zip on publish
  --pdf <path>                  Attach a pre-rendered PDF on publish (share viewer downloads it
                                directly instead of generating one)
  --workbook <path>             Attach a spreadsheet workbook (.xlsx/.xls/.csv) on publish
`.trim();

const REPORT_DIR_DEFAULT = "dillion-report";

/** Match ingestion backend MAX_RAW_BUNDLE_ZIP_BYTES. */
const MAX_RAW_BUNDLE_ZIP_BYTES = 32 * 1024 * 1024;
/** Match ingestion backend MAX_ATTACHED_PDF_BYTES (separate cap from report+raw). */
const MAX_ATTACHED_PDF_BYTES = 32 * 1024 * 1024;
/** Match ingestion backend MAX_ATTACHED_WORKBOOK_BYTES. */
const MAX_ATTACHED_WORKBOOK_BYTES = 32 * 1024 * 1024;
/** Accepted workbook extensions → content types (match the backend's WORKBOOK_CONTENT_TYPES). */
const WORKBOOK_CONTENT_TYPES: Record<string, string> = {
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".csv": "text/csv",
};

export async function artifactsCommand(args: string[]) {
  const sub = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(ARTIFACTS_HELP);
      return;
    case "init":
      return artifactsInit(rest);
    case "dev":
      return artifactsViteCommand(rest, "dev");
    case "build":
      return artifactsViteCommand(rest, "build");
    case "publish":
      return artifactsPublish(rest);
    case "attach-pdf":
      return artifactsAttachPdf(rest);
    case "attach-workbook":
      return artifactsAttachWorkbook(rest);
    case "download-raw":
      return artifactsDownloadRaw(rest);
    case "list":
      return artifactsList(rest);
    case "get":
      return artifactsGet(rest);
    case "share":
      return artifactsShare(rest);
    default:
      console.error(`Unknown artifacts subcommand: ${sub}`);
      console.error(ARTIFACTS_HELP);
      process.exit(1);
  }
}

// ─── init ─────────────────────────────────────────────────────────────────

async function artifactsInit(args: string[]) {
  const { flags, positional } = parseFlags(args);
  if (flags.help === "" || flags.h === "") {
    console.log("Usage: dillion artifacts init [dir]\n  Scaffolds a Vite + React report.");
    return;
  }
  const target = resolve(positional[0] || REPORT_DIR_DEFAULT);

  const exists = await pathExists(target);
  if (exists) {
    console.error(`Refusing to overwrite existing path: ${target}`);
    process.exit(1);
  }

  for (const file of VITE_REACT_TEMPLATE) {
    const fullPath = join(target, file.path);
    await mkdir(dirname(fullPath), { recursive: true });
    await Bun.write(fullPath, file.contents);
  }

  console.log(`✓ Scaffolded report in ${target}`);
  console.log(`\nNext steps:`);
  console.log(`  cd ${target}`);
  console.log(`  bun install        # or npm install / pnpm install`);
  console.log(`  dillion artifacts dev`);
}

// ─── dev / build (delegates to local vite) ────────────────────────────────

async function artifactsViteCommand(args: string[], mode: "dev" | "build") {
  const { positional } = parseFlags(args);
  const dir = resolve(positional[0] || ".");
  if (!(await pathExists(join(dir, "package.json")))) {
    console.error(`No package.json found in ${dir}.`);
    console.error(`Run inside a directory created by 'dillion artifacts init', or pass the path.`);
    process.exit(1);
  }
  const cmd = mode === "dev" ? ["bunx", "vite"] : ["bunx", "vite", "build"];
  const proc = spawn({
    cmd,
    cwd: dir,
    env: process.env,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) process.exit(code);
}

function excludeReportSourcePath(rel: string): boolean {
  const n = rel.replace(/\\/g, "/");
  const base = n.includes("/") ? n.slice(n.lastIndexOf("/") + 1) : n;

  if (n === "node_modules" || n.startsWith("node_modules/")) return true;
  if (n === "dist" || n.startsWith("dist/")) return true;
  if (n === ".git" || n.startsWith(".git/")) return true;
  if (n === ".aws" || n.startsWith(".aws/")) return true;
  if (n.endsWith(".DS_Store")) return true;

  if (n === ".env" || n.startsWith(".env.")) return true;
  if (base === ".npmrc" || base === ".yarnrc" || base === ".pnp.cjs") return true;

  if (/\.(pem|key|p12|pfx|keystore)$/i.test(n)) return true;
  if (base === "id_rsa" || base === "id_ed25519" || base === "id_ecdsa") return true;
  if (/^service[-_]?account.*\.json$/i.test(base)) return true;
  if (base === "credentials.json" || base === "secrets.json") return true;

  return false;
}

// ─── publish ──────────────────────────────────────────────────────────────

async function artifactsPublish(args: string[]) {
  const { flags, positional } = parseFlags(args);
  if (flags.help === "" || flags.h === "") {
    console.log(
      "Usage: dillion artifacts publish [dir] (--title <t> -p <pid>) | (--report <id>)\n" +
        "  Bundles report source (excluding secrets, node_modules, dist, .git) as raw_file unless --no-raw.",
    );
    return;
  }
  const dir = resolve(positional[0] || ".");
  const distDir = join(dir, "dist");
  if (!(await pathExists(distDir))) {
    console.error(`Build output not found at ${distDir}.`);
    console.error(`Run 'dillion artifacts build' first.`);
    process.exit(1);
  }
  if (!(await pathExists(join(distDir, "index.html")))) {
    console.error(`${distDir} does not contain index.html — refusing to publish.`);
    process.exit(1);
  }

  const reportId = flags.report || flags.r;
  const json = flags.json !== undefined;
  const notes = flags.notes;
  const skipRaw = flags["no-raw"] !== undefined;
  const pdfPath = flags.pdf;
  const workbookPath = flags.workbook;

  const inputs = await walkDirToZipInputs(distDir);
  if (inputs.length === 0) {
    console.error(`No files found under ${distDir}.`);
    process.exit(1);
  }
  const zipBytes = buildZip(inputs);
  const zipBlob = new Blob([new Uint8Array(zipBytes)], { type: "application/zip" });
  const totalKb = (zipBytes.length / 1024).toFixed(1);

  let extraFiles: { field: string; blob: Blob; fileName: string }[] | undefined;
  if (!skipRaw) {
    const rawInputs = await walkDirToZipInputs(dir, { exclude: excludeReportSourcePath });
    if (rawInputs.length > 0) {
      const rawZip = buildZip(rawInputs);
      if (rawZip.length > MAX_RAW_BUNDLE_ZIP_BYTES) {
        if (!json) {
          console.warn(
            `Skipping source upload: zip is ${formatBytes(rawZip.length)} (limit ${formatBytes(MAX_RAW_BUNDLE_ZIP_BYTES)}). ` +
              `Publishing report only.`,
          );
        }
      } else {
        const rawKb = (rawZip.length / 1024).toFixed(1);
        if (!json) {
          console.log(`Packaging source for collaboration (${rawInputs.length} files, ${rawKb} KiB zip)…`);
        }
        extraFiles = [
          {
            field: "raw_file",
            blob: new Blob([new Uint8Array(rawZip)], { type: "application/zip" }),
            fileName: "source.zip",
          },
        ];
      }
    } else if (!json) {
      console.log("(no extra source files to upload — skipped raw bundle)");
    }
  }

  if (pdfPath !== undefined) {
    // Invalid --pdf reports an error but does NOT abort the publish.
    const pdfEntry = await readAttachedPdfEntry(pdfPath);
    if (pdfEntry) {
      if (!json) console.log(`Attaching PDF (${formatBytes(pdfEntry.blob.size)})…`);
      (extraFiles ??= []).push(pdfEntry);
    } else {
      console.error("Publishing without attached PDF.");
    }
  }

  if (workbookPath !== undefined) {
    // Invalid --workbook reports an error but does NOT abort the publish.
    const workbookEntry = await readAttachedWorkbookEntry(workbookPath);
    if (workbookEntry) {
      if (!json) console.log(`Attaching workbook (${formatBytes(workbookEntry.blob.size)})…`);
      (extraFiles ??= []).push(workbookEntry);
    } else {
      console.error("Publishing without attached workbook.");
    }
  }

  if (reportId) {
    if (!json) console.log(`Uploading new version to report ${reportId} (${inputs.length} files, ${totalKb} KiB)…`);
    const res = await apiUploadMultipart(`/research-reports/${encodeURIComponent(reportId)}/versions`, {
      fileBlob: zipBlob,
      fileName: "dist.zip",
      fields: { ...(notes ? { notes } : {}) },
      extraFiles,
    });
    if (json) {
      console.log(JSON.stringify(res, null, 2));
      return;
    }
    const rawNote =
      res.raw_bundle_byte_size != null
        ? `, source ${formatBytes(res.raw_bundle_byte_size)}`
        : "";
    const pdfNote =
      res.pdf_byte_size != null ? `, pdf ${formatBytes(res.pdf_byte_size)}` : "";
    const workbookNote =
      res.workbook_byte_size != null ? `, workbook ${formatBytes(res.workbook_byte_size)}` : "";
    console.log(
      `✓ Published v${res.version_number} (${res.file_count} files, ${formatBytes(res.byte_size)}${rawNote}${pdfNote}${workbookNote})`,
    );
    return;
  }

  const title = flags.title;
  if (!title) {
    console.error("--title is required when publishing a new report (or pass --report <id> to add a version).");
    process.exit(1);
  }
  const projectId = await requireProjectId(
    flags,
    "Usage: dillion artifacts publish --title <t> --project <id>  (or: dillion project use <id>)"
  );

  if (!json) console.log(`Publishing "${title}" to project ${projectId} (${inputs.length} files, ${totalKb} KiB)…`);
  const res = await apiUploadMultipart(
    `/projects/${encodeURIComponent(projectId)}/research-reports`,
    {
      fileBlob: zipBlob,
      fileName: "dist.zip",
      fields: {
        title,
        ...(flags.description ? { description: flags.description } : {}),
        ...(notes ? { notes } : {}),
      },
      extraFiles,
    }
  );

  if (json) {
    console.log(JSON.stringify(res, null, 2));
    return;
  }
  const report = res.report;
  const v0 = report.versions?.[0];
  console.log(`✓ Created report ${report.id}`);
  console.log(`  title:   ${report.title}`);
  console.log(`  version: v${report.current_version}`);
  if (!v0) {
    console.log(`  (version details unavailable)`);
    return;
  }
  const rawNote =
    v0.raw_bundle_byte_size != null ? `, source ${formatBytes(v0.raw_bundle_byte_size)}` : "";
  const pdfNote = v0.pdf_byte_size != null ? `, pdf ${formatBytes(v0.pdf_byte_size)}` : "";
  const workbookNote =
    v0.workbook_byte_size != null ? `, workbook ${formatBytes(v0.workbook_byte_size)}` : "";
  console.log(`  files:   ${v0.file_count ?? "?"}`);
  console.log(`  size:    ${formatBytes(v0.byte_size ?? 0)}${rawNote}${pdfNote}${workbookNote}`);
}

/**
 * Read + validate a `--pdf` path into an `extraFiles` entry.
 * Returns null (after printing an error) when the file is unusable.
 */
async function readAttachedPdfEntry(
  pdfPath: string,
): Promise<{ field: string; blob: Blob; fileName: string } | null> {
  if (!pdfPath || typeof pdfPath !== "string") {
    console.error("--pdf requires a path to a .pdf file.");
    return null;
  }
  const full = resolve(pdfPath);
  if (!/\.pdf$/i.test(full)) {
    console.error(`--pdf: ${pdfPath} is not a .pdf file.`);
    return null;
  }
  const file = Bun.file(full);
  if (!(await file.exists())) {
    console.error(`--pdf: file not found: ${pdfPath}`);
    return null;
  }
  const bytes = await file.bytes();
  if (bytes.length === 0) {
    console.error(`--pdf: ${pdfPath} is empty.`);
    return null;
  }
  if (bytes.length > MAX_ATTACHED_PDF_BYTES) {
    console.error(
      `--pdf: ${pdfPath} is ${formatBytes(bytes.length)} (limit ${formatBytes(MAX_ATTACHED_PDF_BYTES)}).`,
    );
    return null;
  }
  return {
    field: "pdf_file",
    blob: new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
    fileName: basename(full),
  };
}

/** Return the accepted workbook extension (lowercased, with dot) for a path, or null. */
function workbookExtension(path: string): string | null {
  const lower = path.toLowerCase();
  for (const ext of Object.keys(WORKBOOK_CONTENT_TYPES)) {
    if (lower.endsWith(ext)) return ext;
  }
  return null;
}

/**
 * Read + validate a `--workbook` path into an `extraFiles` entry.
 * Returns null (after printing an error) when the file is unusable.
 */
async function readAttachedWorkbookEntry(
  workbookPath: string,
): Promise<{ field: string; blob: Blob; fileName: string } | null> {
  if (!workbookPath || typeof workbookPath !== "string") {
    console.error("--workbook requires a path to a .xlsx, .xls, or .csv file.");
    return null;
  }
  const full = resolve(workbookPath);
  const ext = workbookExtension(full);
  if (!ext) {
    console.error(`--workbook: ${workbookPath} must be a .xlsx, .xls, or .csv file.`);
    return null;
  }
  const file = Bun.file(full);
  if (!(await file.exists())) {
    console.error(`--workbook: file not found: ${workbookPath}`);
    return null;
  }
  const bytes = await file.bytes();
  if (bytes.length === 0) {
    console.error(`--workbook: ${workbookPath} is empty.`);
    return null;
  }
  if (bytes.length > MAX_ATTACHED_WORKBOOK_BYTES) {
    console.error(
      `--workbook: ${workbookPath} is ${formatBytes(bytes.length)} (limit ${formatBytes(MAX_ATTACHED_WORKBOOK_BYTES)}).`,
    );
    return null;
  }
  return {
    field: "workbook_file",
    blob: new Blob([new Uint8Array(bytes)], { type: WORKBOOK_CONTENT_TYPES[ext] }),
    fileName: basename(full),
  };
}

// ─── attach-pdf (post-live attach / replace / remove) ─────────────────────

async function artifactsAttachPdf(args: string[]) {
  const { flags, positional } = parseFlags(args);
  const usage =
    "Usage: dillion artifacts attach-pdf <report-id> --pdf <path> [--version N]\n" +
    "       dillion artifacts attach-pdf <report-id> --remove [--version N]\n" +
    "  Attaches/replaces (or removes) the PDF on a live version in place — no republish,\n" +
    "  no new version. Defaults to the report's current version.";
  if (flags.help === "" || flags.h === "") {
    console.log(usage);
    return;
  }
  const reportId = positional[0] || flags.report || flags.r;
  if (!reportId || typeof reportId !== "string") {
    console.error(usage);
    process.exit(1);
  }
  const json = flags.json !== undefined;
  const version = typeof flags.version === "string" && flags.version.trim() ? flags.version.trim() : undefined;

  if (flags.remove !== undefined) {
    const q = version ? `?version=${encodeURIComponent(version)}` : "";
    const res = await api(`/research-reports/${encodeURIComponent(reportId)}/pdf${q}`, {
      method: "DELETE",
    });
    if (json) {
      console.log(JSON.stringify(res, null, 2));
      return;
    }
    console.log(`✓ Removed attached PDF from v${res.version_number}`);
    return;
  }

  const pdfPath = flags.pdf;
  if (!pdfPath || typeof pdfPath !== "string") {
    console.error(usage);
    process.exit(1);
  }
  const pdfEntry = await readAttachedPdfEntry(pdfPath);
  if (!pdfEntry) {
    // Unlike publish --pdf, the PDF is the whole point here — fail.
    process.exit(1);
  }
  if (!json) console.log(`Uploading ${pdfEntry.fileName} (${formatBytes(pdfEntry.blob.size)})…`);
  const res = await apiUploadMultipart(`/research-reports/${encodeURIComponent(reportId)}/pdf`, {
    method: "PUT",
    fileField: "pdf_file",
    fileBlob: pdfEntry.blob,
    fileName: pdfEntry.fileName,
    fields: { ...(version ? { version } : {}) },
  });
  if (json) {
    console.log(JSON.stringify(res, null, 2));
    return;
  }
  console.log(`✓ Attached PDF to v${res.version_number} (${formatBytes(res.pdf_byte_size ?? 0)})`);
  console.log(
    "  Note: share links pinned to a different version keep that version's PDF — pass --version N to target it.",
  );
}

// ─── attach-workbook (post-live attach / replace / remove) ────────────────

async function artifactsAttachWorkbook(args: string[]) {
  const { flags, positional } = parseFlags(args);
  const usage =
    "Usage: dillion artifacts attach-workbook <report-id> --workbook <path> [--version N]\n" +
    "       dillion artifacts attach-workbook <report-id> --remove [--version N]\n" +
    "  Attaches/replaces (or removes) the workbook (.xlsx/.xls/.csv) on a live version in place —\n" +
    "  no republish, no new version. Defaults to the report's current version.";
  if (flags.help === "" || flags.h === "") {
    console.log(usage);
    return;
  }
  const reportId = positional[0] || flags.report || flags.r;
  if (!reportId || typeof reportId !== "string") {
    console.error(usage);
    process.exit(1);
  }
  const json = flags.json !== undefined;
  const version = typeof flags.version === "string" && flags.version.trim() ? flags.version.trim() : undefined;

  if (flags.remove !== undefined) {
    const q = version ? `?version=${encodeURIComponent(version)}` : "";
    const res = await api(`/research-reports/${encodeURIComponent(reportId)}/workbook${q}`, {
      method: "DELETE",
    });
    if (json) {
      console.log(JSON.stringify(res, null, 2));
      return;
    }
    console.log(`✓ Removed attached workbook from v${res.version_number}`);
    return;
  }

  const workbookPath = flags.workbook;
  if (!workbookPath || typeof workbookPath !== "string") {
    console.error(usage);
    process.exit(1);
  }
  const workbookEntry = await readAttachedWorkbookEntry(workbookPath);
  if (!workbookEntry) {
    // Unlike publish --workbook, the workbook is the whole point here — fail.
    process.exit(1);
  }
  if (!json) console.log(`Uploading ${workbookEntry.fileName} (${formatBytes(workbookEntry.blob.size)})…`);
  const res = await apiUploadMultipart(`/research-reports/${encodeURIComponent(reportId)}/workbook`, {
    method: "PUT",
    fileField: "workbook_file",
    fileBlob: workbookEntry.blob,
    fileName: workbookEntry.fileName,
    fields: { ...(version ? { version } : {}) },
  });
  if (json) {
    console.log(JSON.stringify(res, null, 2));
    return;
  }
  console.log(`✓ Attached workbook to v${res.version_number} (${formatBytes(res.workbook_byte_size ?? 0)})`);
  console.log(
    "  Note: share links pinned to a different version keep that version's workbook — pass --version N to target it.",
  );
}

async function artifactsDownloadRaw(args: string[]) {
  const { flags, positional } = parseFlags(args);
  if (flags.help === "" || flags.h === "") {
    console.log("Usage: dillion artifacts download-raw <report-id> --out <path> [--version N]");
    return;
  }
  const reportId = positional[0];
  if (!reportId) {
    console.error("Usage: dillion artifacts download-raw <report-id> --out <path> [--version N]");
    process.exit(1);
  }
  const outFlag = flags.out ?? flags.o;
  if (!outFlag || typeof outFlag !== "string") {
    console.error("--out <path> (or -o) is required");
    process.exit(1);
  }
  let q = "";
  const vNum = flags.version ?? flags.v;
  if (typeof vNum === "string" && vNum.trim().length > 0) {
    q = `?version=${encodeURIComponent(vNum.trim())}`;
  }
  const outPath = resolve(String(outFlag));
  await apiDownloadToFile(`/research-reports/${encodeURIComponent(reportId)}/raw${q}`, outPath);
  console.log(`✓ Wrote ${outPath}`);
}

// ─── list / get ───────────────────────────────────────────────────────────

async function artifactsList(args: string[]) {
  const { flags } = parseFlags(args);
  const projectId = await requireProjectId(
    flags,
    "Usage: dillion artifacts list --project <id>  (or: dillion project use <id>)"
  );
  const data = await api(`/projects/${encodeURIComponent(projectId)}/research-reports`);
  if (flags.json !== undefined) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (!Array.isArray(data) || data.length === 0) {
    console.log("(no reports)");
    return;
  }
  for (const r of data) {
    console.log(
      `${r.id}  v${r.current_version}  ${r.updated_at?.slice(0, 19) ?? ""}  ${r.title}`
    );
  }
}

async function artifactsGet(args: string[]) {
  const { flags, positional } = parseFlags(args);
  const reportId = positional[0];
  if (!reportId) {
    console.error("Usage: dillion artifacts get <report-id>");
    process.exit(1);
  }
  const data = await api(`/research-reports/${encodeURIComponent(reportId)}`);
  if (flags.json !== undefined) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  console.log(`${data.id}  ${data.title}`);
  console.log(`  project:  ${data.project_id}`);
  console.log(`  current:  v${data.current_version}`);
  console.log(`  versions:`);
  for (const v of data.versions ?? []) {
    const raw =
      v.raw_bundle_byte_size != null ? `  +source ${formatBytes(v.raw_bundle_byte_size)}` : "";
    const pdf = v.pdf_byte_size != null ? `  +pdf ${formatBytes(v.pdf_byte_size)}` : "";
    const workbook =
      v.workbook_byte_size != null ? `  +workbook ${formatBytes(v.workbook_byte_size)}` : "";
    console.log(
      `    v${v.version_number}  ${formatBytes(v.byte_size ?? 0)}  ${v.file_count ?? "?"} files  ${v.created_at?.slice(0, 19) ?? ""}${raw}${pdf}${workbook}`,
    );
  }
}

// ─── share ────────────────────────────────────────────────────────────────

async function artifactsShare(args: string[]) {
  const { flags, positional } = parseFlags(args);
  if (positional[0] === "list") {
    if (!positional[1]) {
      console.error("Usage: dillion artifacts share list <report-id>");
      process.exit(1);
    }
    return artifactsShareList(positional[1], flags);
  }
  if (positional[0] === "update") {
    const reportId = positional[1];
    const shareId = positional[2];
    if (!reportId || !shareId) {
      console.error(
        "Usage: dillion artifacts share update <report-id> <share-id> [options]\n" +
          "  Options: --password, --remove-password, --expires-days, --no-expiry, --version, --latest, --no-citations, --allow-citations, --json",
      );
      process.exit(1);
    }
    return artifactsShareUpdate(reportId, shareId, flags);
  }
  return artifactsShareCreate(args);
}

async function artifactsShareList(reportId: string, flags: Record<string, string | true | undefined>) {
  const data = await api(`/research-reports/${encodeURIComponent(reportId)}/shares`);
  if (flags.json !== undefined) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (!Array.isArray(data) || data.length === 0) {
    console.log("(no share links)");
    return;
  }
  for (const s of data) {
    const rev = s.revoked_at ? ` revoked ${s.revoked_at}` : " active";
    const pin = s.pinned_version != null ? `v${s.pinned_version}` : "latest";
    const ex = s.expires_at ? s.expires_at : "no expiry";
    const pw = s.has_password ? "password" : "open";
    const cite = s.allow_citation_excerpts ? "citations" : "no-citations";
    console.log(
      `${s.id}\n  token: ${s.token.slice(0, 12)}…  ${pw}  pin:${pin}  ${cite}  ${ex}${rev}\n  created: ${s.created_at}`,
    );
  }
}

function buildShareUpdateBody(
  flags: Record<string, string | true | undefined>,
  forCreate: boolean,
): Record<string, unknown> {
  const noCitations = flags["no-citations"] !== undefined;
  const allowCitations = flags["allow-citations"] !== undefined;
  if (noCitations && allowCitations) {
    console.error("Cannot use both --allow-citations and --no-citations");
    process.exit(1);
  }
  const removePassword = flags["remove-password"] !== undefined;
  const noExpiry = flags["no-expiry"] !== undefined;
  const latest = flags.latest !== undefined;
  if (noExpiry && flags["expires-days"]) {
    console.error("Cannot use both --no-expiry and --expires-days");
    process.exit(1);
  }
  if (latest && flags.version) {
    console.error("Cannot use both --latest and --version (pick one)");
    process.exit(1);
  }
  if (forCreate) {
    if (removePassword || noExpiry) {
      console.error("--remove-password and --no-expiry are only for: dillion artifacts share update …");
      process.exit(1);
    }
    if (latest) {
      console.error("--latest is only for share update (use a version pin on create, or leave unpinned for latest)");
      process.exit(1);
    }
  }
  const body: Record<string, unknown> = {};
  if (flags.password) body.password = flags.password;
  if (removePassword) body.remove_password = true;
  if (flags["expires-days"]) {
    body.expires_in_days = parseInt(String(flags["expires-days"]), 10);
  }
  if (noExpiry) body.clear_expiry = true;
  if (latest) body.pin_to_latest = true;
  if (flags.version) body.pinned_version = parseInt(String(flags.version), 10);
  if (noCitations) body.allow_citation_excerpts = false;
  else if (allowCitations) body.allow_citation_excerpts = true;
  return body;
}

async function artifactsShareUpdate(
  reportId: string,
  shareId: string,
  flags: Record<string, string | true | undefined>,
) {
  const body = buildShareUpdateBody(flags, false);
  if (Object.keys(body).length === 0) {
    console.error("No changes: pass at least one of --password, --remove-password, --expires-days, --no-expiry, --version, --latest, --no-citations, --allow-citations");
    process.exit(1);
  }
  const s = await api(
    `/research-reports/${encodeURIComponent(reportId)}/shares/${encodeURIComponent(shareId)}`,
    { method: "PATCH", body },
  );
  if (flags.json !== undefined) {
    console.log(JSON.stringify(s, null, 2));
    return;
  }
  console.log("✓ Share link updated");
  console.log(`  has_password: ${s.has_password}`);
  console.log(`  pinned: ${s.pinned_version ?? "latest"}`);
  console.log(`  allow_citation_excerpts: ${s.allow_citation_excerpts}`);
  console.log(`  expires_at: ${s.expires_at ?? "(none)"}`);
}

async function artifactsShareCreate(args: string[]) {
  const { flags, positional } = parseFlags(args);
  const reportId = positional[0];
  if (!reportId) {
    console.error(
      "Usage: dillion artifacts share <report-id> [--password <pw>] [--expires-days N] [--no-citations] ...\n" +
        "     dillion artifacts share list <report-id>\n" +
        "     dillion artifacts share update <report-id> <share-id> [options]",
    );
    process.exit(1);
  }
  const body = buildShareUpdateBody(flags, true);

  const res = await api(`/research-reports/${encodeURIComponent(reportId)}/share`, {
    method: "POST",
    body,
  });
  if (flags.json !== undefined) {
    console.log(JSON.stringify(res, null, 2));
    return;
  }
  console.log("✓ Share link created");
  console.log(`  token:    ${res.share.token}`);
  console.log(`  url path: ${res.url_path}`);
  if (res.share.has_password) console.log("  password: required");
  if (res.share.expires_at) console.log(`  expires:  ${res.share.expires_at}`);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function formatBytes(n: number): string {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1024 / 1024).toFixed(2)} MiB`;
}
