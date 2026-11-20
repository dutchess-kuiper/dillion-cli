import { mkdir, writeFile } from "fs/promises";
import { basename, dirname } from "path";
import { getConfig } from "./config";
import { getOrgOverride } from "./orgContext";

let _config: { apiKey: string; baseUrl: string } | null = null;

/**
 * Build request headers for every bastion call. Always sets `Authorization`, and attaches
 * `X-Dillion-Org-Id` when an acting org has resolved for this invocation (else sends none,
 * letting bastion auto-select or error). Content-Type is NOT hard-coded: the JSON `api()`
 * site passes it via `extra`, while the multipart upload sites pass nothing so `fetch` can
 * set the multipart boundary itself.
 */
export function buildHeaders(
  apiKey: string,
  extra?: Record<string, string>
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    ...extra,
  };
  const orgId = getOrgOverride();
  if (orgId) headers["X-Dillion-Org-Id"] = orgId;
  return headers;
}

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

/**
 * Friendly guidance for the bastion org-scoping error slugs (cross-repo contract).
 * These failures are invocation-wide — they depend on the caller's org selection,
 * not on any one resource — which is why isOrgScopeApiError gates whether a batch
 * operation should abort outright or record a per-item failure and continue.
 */
const ORG_SCOPE_MESSAGES: Record<string, string> = {
  org_selection_required:
    "You belong to multiple organizations. Run `dillion org list` then `dillion org use <org>`, or pass --org-id.",
  not_a_member_of_org: "You are not a member of that organization. Run `dillion org list`.",
  no_org_memberships: "Your account doesn't belong to any organization yet; contact your admin.",
  org_validation_failed:
    "Could not validate your organization. Run `dillion org list`, then re-select with `dillion org use <org>`.",
};

/** Whether an error body is one of the bastion org-scoping slugs. */
export function isOrgScopeApiError(body: string): boolean {
  return Object.hasOwn(ORG_SCOPE_MESSAGES, parseApiErrorMessage(body));
}

/**
 * Format an error body into the user-facing message: the friendly org-scoping
 * guidance when the slug matches, otherwise the generic parsed form. Does NOT
 * exit — callers that must keep going (per-job batch loops) throw this instead.
 */
export function formatApiError(status: number, body: string): string {
  const msg = parseApiErrorMessage(body);
  return Object.hasOwn(ORG_SCOPE_MESSAGES, msg) ? ORG_SCOPE_MESSAGES[msg]! : `Error ${status}: ${msg}`;
}

/**
 * Explain a failed fetch (no HTTP response at all) in one line, without a
 * stack trace. Pure: the caller decides whether to exit.
 */
export function describeNetworkError(err: unknown, url: string): string {
  let host = url;
  try {
    host = new URL(url).origin;
  } catch {
    // keep the raw value
  }
  const e = err as { name?: string; code?: string; message?: string } | undefined;
  const code = e?.code ?? "";
  if (e?.name === "TimeoutError" || e?.name === "AbortError") {
    return `${host} didn't respond in time. Try again, or check it with: dillion health`;
  }
  if (code === "ERR_INVALID_URL") {
    return "The saved server URL isn't valid. See it with: dillion auth status, fix it with: dillion auth <api-key> --url=<url>";
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return `Couldn't find ${host}. Check your internet connection and the server URL (dillion auth status).`;
  }
  if (code === "ConnectionRefused" || code === "ECONNREFUSED") {
    return `Couldn't connect to ${host}: nothing is accepting connections there. Is the server up? (dillion auth status)`;
  }
  if (/CERT|TLS|SSL/i.test(code) || /certificate/i.test(e?.message ?? "")) {
    return `Couldn't make a secure connection to ${host} (certificate problem).`;
  }
  return `Couldn't reach ${host}${e?.message ? ` (${e.message})` : ""}. Check your connection, or run: dillion health`;
}

/** `fetch` that prints describeNetworkError and exits 1 when no response arrives. */
export async function fetchOrExit(url: string | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    console.error(describeNetworkError(err, String(url)));
    process.exit(1);
  }
}

/** Shared terminal error path for all fetch sites: print the message and exit 1. */
export function failWithApiError(status: number, body: string): never {
  console.error(formatApiError(status, body));
  process.exit(1);
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

  const res = await fetchOrExit(`${baseUrl}${path}`, {
    method,
    headers: buildHeaders(apiKey, { "Content-Type": "application/json" }),
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.text();
    failWithApiError(res.status, err);
  }

  if (raw) return res;
  return res.json();
}

/**
 * Like `api()`, but returns failures instead of exiting, for callers that must
 * clean up (e.g. revoke a half-built link) before reporting the error.
 */
export async function apiResult(
  path: string,
  options: { method?: string; body?: any } = {}
): Promise<
  | { ok: true; data: any }
  | { ok: false; message: string; /** true = no response, so the outcome is unknown */ transport: boolean }
> {
  const { apiKey, baseUrl } = await config();
  const { method = "GET", body } = options;
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: buildHeaders(apiKey, { "Content-Type": "application/json" }),
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    return { ok: false, transport: true, message: describeNetworkError(err, `${baseUrl}${path}`) };
  }
  if (!res.ok) return { ok: false, transport: false, message: formatApiError(res.status, await res.text()) };
  // A cut-off body can parse to null instead of throwing: either way the
  // request may have been applied, so report it as unconfirmed.
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (data === null || data === undefined) {
    return { ok: false, transport: true, message: "the response was cut off" };
  }
  return { ok: true, data };
}

/** The bastion base URL this invocation talks to (from `dillion auth`). */
export async function apiBaseUrl(): Promise<string> {
  return (await config()).baseUrl;
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
  const res = await fetchOrExit(url, {
    method: "POST",
    headers: buildHeaders(apiKey),
    body: formData,
  });

  if (!res.ok) {
    const err = await res.text();
    failWithApiError(res.status, err);
  }

  return res.json() as Promise<Record<string, unknown>>;
}

/**
 * Send multipart to an arbitrary bastion path with optional extra form fields.
 * `file` is required (a Bun.BunFile or Blob). Returns parsed JSON.
 */
export async function apiUploadMultipart(
  path: string,
  options: {
    fileBlob: Blob;
    fileName: string;
    /** Multipart field name for the main file (default: `file`). */
    fileField?: string;
    /** HTTP method (default: POST; PUT for in-place updates like attach-pdf). */
    method?: "POST" | "PUT";
    fields?: Record<string, string | undefined>;
    /** Optional second multipart file (e.g. `raw_file` for report source bundle). */
    extraFiles?: { field: string; blob: Blob; fileName: string }[];
  }
): Promise<any> {
  const { apiKey, baseUrl } = await config();
  const formData = new FormData();
  formData.append(options.fileField ?? "file", options.fileBlob, options.fileName);
  for (const ef of options.extraFiles ?? []) {
    formData.append(ef.field, ef.blob, ef.fileName);
  }
  for (const [k, v] of Object.entries(options.fields ?? {})) {
    if (v !== undefined && v !== null) formData.append(k, v);
  }

  const res = await fetchOrExit(`${baseUrl}${path}`, {
    method: options.method ?? "POST",
    headers: buildHeaders(apiKey),
    body: formData,
  });

  if (!res.ok) {
    const err = await res.text();
    failWithApiError(res.status, err);
  }
  return res.json();
}

/** GET binary from bastion (e.g. research report source zip). Writes to `outPath`. */
export async function apiDownloadToFile(path: string, outPath: string): Promise<void> {
  const { apiKey, baseUrl } = await config();
  const res = await fetchOrExit(`${baseUrl}${path}`, {
    method: "GET",
    headers: buildHeaders(apiKey),
  });
  if (!res.ok) {
    const err = await res.text();
    failWithApiError(res.status, err);
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
  description?: string | null,
  orgAccess?: "none" | "viewer" | "editor"
): Promise<unknown> {
  const body: {
    name: string;
    description?: string | null;
    org_access?: "none" | "viewer" | "editor";
  } = { name };
  if (description !== undefined) {
    body.description = description;
  }
  if (orgAccess !== undefined) {
    body.org_access = orgAccess;
  }
  return api("/projects", { method: "POST", body });
}

/** GET bastion `/projects/:id/members`. */
export async function apiProjectMembers(projectId: string): Promise<unknown> {
  return api(`/projects/${encodeURIComponent(projectId)}/members`);
}

/** GET bastion `/projects/:id/invitations`. */
export async function apiProjectInvitations(projectId: string): Promise<unknown> {
  return api(`/projects/${encodeURIComponent(projectId)}/invitations`);
}

export type ProjectInviteResult = {
  status: "member_added" | "invitation_pending";
  email: string;
  invitation?: Record<string, unknown>;
  membership?: Record<string, unknown>;
  message?: string;
};

/** POST bastion `/projects/:id/invitations` — invite by email. */
export async function apiProjectInvite(
  projectId: string,
  email: string,
): Promise<ProjectInviteResult> {
  return api(`/projects/${encodeURIComponent(projectId)}/invitations`, {
    method: "POST",
    body: { email },
  });
}
