import { mkdir, writeFile } from "fs/promises";
import { basename, dirname } from "path";
import { getConfig } from "./config";

let _config: { apiKey: string; baseUrl: string } | null = null;

/** Parse FastAPI / bastion JSON error bodies into a user-facing message. */
function parseApiErrorMessage(err: string): string {
  try {
    const j = JSON.parse(err) as {
      detail?: string | { msg?: string }[];
      error?: string;
    };
    if (typeof j.detail === "string") return j.detail;
    if (Array.isArray(j.detail)) {
      return j.detail.map((e) => e.msg ?? JSON.stringify(e)).join("; ");
    }
    if (j.error) return j.error;
  } catch {
    // use raw body
  }
  return err;
}

async function config() {
  if (!_config) _config = await getConfig();
  return _config;
}

export async function api(
  path: string,
  options: {
    method?: string;
    body?: any;
    raw?: boolean;
  } = {}
): Promise<any> {
  const { apiKey, baseUrl } = await config();
  const { method = "GET", body, raw = false } = options;

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`Error ${res.status}: ${parseApiErrorMessage(err)}`);
    process.exit(1);
  }

  if (raw) return res;
  return res.json();
}

/** POST multipart to bastion `/upload` (ingestion proxy). Field name: `file`. */
export async function apiUpload(filePath: string, projectId: string): Promise<Record<string, unknown>> {
  const { apiKey, baseUrl } = await config();

  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const name = basename(filePath);
  const formData = new FormData();
  formData.append("file", file, name);

  const url = `${baseUrl}/upload?project_id=${encodeURIComponent(projectId)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`Error ${res.status}: ${parseApiErrorMessage(err)}`);
    process.exit(1);
  }

  return res.json() as Promise<Record<string, unknown>>;
}

/**
 * POST multipart to an arbitrary bastion path with optional extra form fields.
 * `file` is required (a Bun.BunFile or Blob). Returns parsed JSON.
 */
export async function apiUploadMultipart(
  path: string,
  options: {
    fileBlob: Blob;
    fileName: string;
    fields?: Record<string, string | undefined>;
    /** Optional second multipart file (e.g. `raw_file` for report source bundle). */
    extraFiles?: { field: string; blob: Blob; fileName: string }[];
  }
): Promise<any> {
  const { apiKey, baseUrl } = await config();
  const formData = new FormData();
  formData.append("file", options.fileBlob, options.fileName);
  for (const ef of options.extraFiles ?? []) {
    formData.append(ef.field, ef.blob, ef.fileName);
  }
  for (const [k, v] of Object.entries(options.fields ?? {})) {
    if (v !== undefined && v !== null) formData.append(k, v);
  }

  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`Error ${res.status}: ${parseApiErrorMessage(err)}`);
    process.exit(1);
  }
  return res.json();
}

/** GET binary from bastion (e.g. research report source zip). Writes to `outPath`. */
export async function apiDownloadToFile(path: string, outPath: string): Promise<void> {
  const { apiKey, baseUrl } = await config();
  const res = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const err = await res.text();
    console.error(`Error ${res.status}: ${parseApiErrorMessage(err)}`);
    process.exit(1);
  }
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, Buffer.from(await res.arrayBuffer()));
}

/** GET bastion `/projects` (optional `name` substring filter). */
export async function apiProjectsList(nameFilter?: string): Promise<unknown> {
  const q =
    nameFilter !== undefined && nameFilter !== ""
      ? `?name=${encodeURIComponent(nameFilter)}`
      : "";
  return api(`/projects${q}`);
}

/** POST bastion `/projects` — `description` omitted unless provided. */
export async function apiProjectsCreate(
  name: string,
  description?: string | null
): Promise<unknown> {
  const body: { name: string; description?: string | null } = { name };
  if (description !== undefined) {
    body.description = description;
  }
  return api("/projects", { method: "POST", body });
}
