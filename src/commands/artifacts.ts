import { mkdir, stat } from "fs/promises";
import { dirname, join, resolve } from "path";
import { spawn } from "bun";
import { api, apiUploadMultipart } from "../api";
import { parseFlags } from "../flags";
import { requireProjectId, resolveProjectId } from "../projectContext";
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

Discovery:
  list -p <pid>                 List research reports for a project
  get <report-id>               Show a report and its versions

Sharing:
  share <report-id> [--password <pw>] [--expires-days N] [--allow-citations]
                                Create a password-protected share link

Common flags:
  --json                        Raw JSON output
  --notes <text>                Optional version notes
`.trim();

const REPORT_DIR_DEFAULT = "dillion-report";

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
  // Prefer bunx; vite is the script `dev` or `build` in package.json.
  const cmd = mode === "dev" ? ["bunx", "vite"] : ["bunx", "vite", "build"];
  const proc = spawn({
    cmd,
    cwd: dir,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) process.exit(code);
}

// ─── publish ──────────────────────────────────────────────────────────────

async function artifactsPublish(args: string[]) {
  const { flags, positional } = parseFlags(args);
  if (flags.help === "" || flags.h === "") {
    console.log("Usage: dillion artifacts publish [dir] (--title <t> -p <pid>) | (--report <id>)");
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

  const inputs = await walkDirToZipInputs(distDir);
  if (inputs.length === 0) {
    console.error(`No files found under ${distDir}.`);
    process.exit(1);
  }
  const zipBytes = buildZip(inputs);
  const zipBlob = new Blob([new Uint8Array(zipBytes)], { type: "application/zip" });
  const totalKb = (zipBytes.length / 1024).toFixed(1);

  if (reportId) {
    if (!json) console.log(`Uploading new version to report ${reportId} (${inputs.length} files, ${totalKb} KiB)…`);
    const res = await apiUploadMultipart(`/research-reports/${encodeURIComponent(reportId)}/versions`, {
      fileBlob: zipBlob,
      fileName: "dist.zip",
      fields: { ...(notes ? { notes } : {}) },
    });
    if (json) {
      console.log(JSON.stringify(res, null, 2));
      return;
    }
    console.log(`✓ Published v${res.version_number} (${res.file_count} files, ${formatBytes(res.byte_size)})`);
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
    }
  );

  if (json) {
    console.log(JSON.stringify(res, null, 2));
    return;
  }
  const report = res.report;
  console.log(`✓ Created report ${report.id}`);
  console.log(`  title:   ${report.title}`);
  console.log(`  version: v${report.current_version}`);
  console.log(`  files:   ${report.versions[0]?.file_count ?? "?"}`);
  console.log(`  size:    ${formatBytes(report.versions[0]?.byte_size ?? 0)}`);
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
    console.log(`    v${v.version_number}  ${formatBytes(v.byte_size ?? 0)}  ${v.file_count ?? "?"} files  ${v.created_at?.slice(0, 19) ?? ""}`);
  }
}

// ─── share ────────────────────────────────────────────────────────────────

async function artifactsShare(args: string[]) {
  const { flags, positional } = parseFlags(args);
  const reportId = positional[0];
  if (!reportId) {
    console.error("Usage: dillion artifacts share <report-id> [--password <pw>] [--expires-days N] [--allow-citations]");
    process.exit(1);
  }
  const body: Record<string, unknown> = {};
  if (flags.password) body.password = flags.password;
  if (flags["expires-days"]) body.expires_in_days = parseInt(flags["expires-days"], 10);
  if (flags.version) body.pinned_version = parseInt(flags.version, 10);
  if (flags["allow-citations"] !== undefined) body.allow_citation_excerpts = true;

  const res = await api(`/research-reports/${encodeURIComponent(reportId)}/share`, {
    method: "POST",
    body,
  });
  if (flags.json !== undefined) {
    console.log(JSON.stringify(res, null, 2));
    return;
  }
  console.log(`✓ Share link created`);
  console.log(`  token:    ${res.share.token}`);
  console.log(`  url path: ${res.url_path}`);
  if (res.share.has_password) console.log(`  password: required`);
  if (res.share.expires_at) console.log(`  expires:  ${res.share.expires_at}`);
}

// ─── helpers ──────────────────────────────────────────────────────────────

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
