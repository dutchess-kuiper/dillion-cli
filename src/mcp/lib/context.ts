/**
 * Process-global MCP runtime context, resolved ONCE at startup by `src/mcp/index.ts`.
 *
 * The acting org is set via `setOrgOverride` in orgContext.ts (read synchronously by
 * buildHeaders). Here we stash the default project id and the base URL so tool handlers
 * can resolve them without re-reading config on every call. Single-slot module state is
 * intentional (v1): a different org/project means a second server instance.
 */

let _defaultProjectId: string | undefined;
let _baseUrl: string | undefined;
let _apiKey: string | undefined;

export function setDefaultProjectId(id: string | undefined): void {
  _defaultProjectId = id?.trim() || undefined;
}

export function setBaseUrl(url: string): void {
  _baseUrl = url;
}

export function getBaseUrl(): string {
  if (!_baseUrl) throw new Error("MCP context not initialized (baseUrl missing).");
  return _baseUrl;
}

export function setApiKey(key: string): void {
  _apiKey = key;
}

export function getApiKey(): string {
  if (!_apiKey) throw new Error("MCP context not initialized (apiKey missing).");
  return _apiKey;
}

/**
 * Resolve the acting project: an explicit `projectId` arg wins, else the startup default
 * (from config.projectId / DILLION_PROJECT_ID). Throws a clean, actionable error otherwise
 * — `wrap` turns it into a tool error, never a process exit.
 */
export function requireProject(projectId?: string): string {
  const id = projectId?.trim() || _defaultProjectId;
  if (!id) {
    throw new Error(
      "No project specified. Pass `projectId`, or set a default with `dillion project use <id>` " +
        "or the DILLION_PROJECT_ID environment variable.",
    );
  }
  return id;
}

/** Test-only reset of the module singletons. */
export function __resetContextForTests(): void {
  _defaultProjectId = undefined;
  _baseUrl = undefined;
  _apiKey = undefined;
}
