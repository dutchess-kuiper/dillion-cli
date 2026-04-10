import { basename } from "path";
import { getConfig } from "./config";

let _config: { apiKey: string; baseUrl: string } | null = null;

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
    let msg: string;
    try {
      msg = JSON.parse(err).error;
    } catch {
      msg = err;
    }
    console.error(`Error ${res.status}: ${msg}`);
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
    let msg: string;
    try {
      msg = JSON.parse(err).error;
    } catch {
      msg = err;
    }
    console.error(`Error ${res.status}: ${msg}`);
    process.exit(1);
  }

  return res.json() as Promise<Record<string, unknown>>;
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
