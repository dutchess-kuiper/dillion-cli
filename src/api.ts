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
 * Structured HTTP failure carrying the original status + raw body alongside the
 * user-facing message. Thrown (instead of exiting) when the failure mode is "throw"
 * so a long-lived process (the MCP server) can turn it into a tool error instead of
 * killing the process.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * How the four fetch fns react to a non-2xx: "exit" (default) preserves the exact
 * CLI behavior (print + process.exit(1)); "throw" raises an `ApiError` so an
 * embedding process can catch it. The MCP entrypoint flips this to "throw".
 */
let _failureMode: "exit" | "throw" = "exit";

export function setApiFailureMode(mode: "exit" | "throw"): void {
  _failureMode = mode;
}

/**
 * Shared terminal error path for all fetch sites. In "exit" mode prints the message
 * and exits 1 (byte-identical CLI behavior); in "throw" mode raises an ApiError with
 * the same normalized message.
 */
export function failWithApiError(status: number, body: string): never {
  const message = formatApiError(status, body);
  if (_failureMode === "throw") {
    throw new ApiError(status, body, message);
  }
  console.error(message);
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

  const res = await fetch(`${baseUrl}${path}`, {
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

  const res = await fetch(`${baseUrl}${path}`, {
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
  const res = await fetch(`${baseUrl}${path}`, {
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
  description?: string | null
): Promise<unknown> {
  const body: { name: string; description?: string | null } = { name };
  if (description !== undefined) {
    body.description = description;
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
