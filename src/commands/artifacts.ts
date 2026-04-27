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
