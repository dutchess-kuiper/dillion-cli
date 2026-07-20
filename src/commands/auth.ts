import { loadConfig, saveConfig, CONFIG_DIR, type Config } from "../config";
import { mkdirSync } from "fs";
import { parseFlags } from "../flags";
import type { OrgEntry } from "./org";

export interface AuthOutcome {
  /** Config to persist. */
  config: Config;
  /** stdout lines to print in order. */
  lines: string[];
}

/**
 * Decide what to save and print after a successful `GET /orgs` validation. Pure so the
 * three membership cases are unit-testable without network/fs/process.exit.
 *
 * - one org  -> auto-select it.
 * - many     -> do not auto-select, but keep a still-valid prior selection across re-auth;
 *               otherwise print the list and the `org use` hint.
 * - zero     -> save creds anyway and warn.
 */
export function buildAuthOutcome(
  apiKey: string,
  server: string,
  orgs: OrgEntry[],
  previous: Config | null,
  serverExplicit: boolean
): AuthOutcome {
  const config: Config = {
    apiKey,
    baseUrl: server,
    ...(previous?.projectId ? { projectId: previous.projectId } : {}),
  };
  const lines: string[] = ["Authenticated successfully."];
  if (serverExplicit) lines.push(`Server: ${server}`);

  if (orgs.length === 1) {
    config.orgId = orgs[0]!.id;
    lines.push(`Organization: ${orgs[0]!.name}`);
  } else if (orgs.length > 1) {
    if (previous?.orgId && orgs.some((o) => o.id === previous.orgId)) {
      config.orgId = previous.orgId;
    }
    lines.push(`You belong to ${orgs.length} organizations:`);
    for (const o of orgs) {
      const marker = o.id === config.orgId ? "* " : "  ";
      lines.push(`${marker}${o.name}  (${o.id})`);
    }
    lines.push(
      config.orgId
        ? `Active: ${config.orgId}. Change it with: dillion org use <org-id-or-name>`
        : "Select one with: dillion org use <org-id-or-name>  (or pass --org-id per command)"
    );
  } else {
    lines.push("Key is valid but you belong to no organization; contact your admin.");
  }

  return { config, lines };
}

/**
 * Interpret a parsed `GET /orgs` body. Fails closed: a non-object (parse failure -> null) or a
 * body whose `orgs` is not an array is an unexpected response, NOT zero orgs. Only a genuinely
 * parsed `{ "orgs": [...] }` yields the membership list (which may legitimately be empty).
 */
export function parseOrgsResponse(
  data: unknown
): { orgs: OrgEntry[] } | { unexpected: true } {
  if (!data || typeof data !== "object" || !Array.isArray((data as { orgs?: unknown }).orgs)) {
    return { unexpected: true };
  }
  return { orgs: (data as { orgs: OrgEntry[] }).orgs };
}

export async function authCommand(args: string[]) {
  const apiKey = args[0];
  const baseUrl = args.find((a) => a.startsWith("--url="))?.split("=")[1];

  if (!apiKey || apiKey.startsWith("--")) {
    console.error("Usage: dillion auth <api-key> [--url=https://...]");
    console.error("       dillion auth status   Show and validate stored credentials");
    process.exit(1);
  }

  // Backstop: any non-key first arg (a mistyped subcommand like `auth show`, or a stray word)
  // must not be silently sent to /orgs as a bearer token — that produced the misleading
  // "Invalid API key" for `auth status`. `status` is routed away before we get here; this
  // catches everything else. Don't echo the arg back: a rejected value might be a real secret
  // (a truncated paste, a wrong-provider key) and would leak into logs / terminal scrollback.
  if (!looksLikeApiKey(apiKey)) {
    console.error(`Not a valid API key (expected a key starting with "dil_").`);
    console.error("Usage: dillion auth <api-key> [--url=https://...]");
    console.error("       dillion auth status   Show and validate stored credentials");
    process.exit(1);
  }

  const server = baseUrl || "https://bastion.dillion.ai";

  // Validate the key against a direct (pre-org-selection) route and learn the memberships.
  const res = await fetch(`${server}/orgs`, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  }).catch(() => null);

  if (!res) {
    console.error("Server unreachable.");
    process.exit(1);
  }
  if (res.status === 401 || res.status === 403) {
    console.error("Invalid API key.");
    process.exit(1);
  }
  if (res.status === 404) {
    console.error(
      "This server doesn't support org discovery yet. Update the server, or use an older CLI."
    );
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`Server error (${res.status}). Try again.`);
    process.exit(1);
  }

  const parsed = parseOrgsResponse(await res.json().catch(() => null));
  if ("unexpected" in parsed) {
    console.error(
      "Unexpected response from the server while reading your organizations. Try again, or update the CLI if this persists."
    );
    process.exit(1);
  }
  const orgs = parsed.orgs;

  mkdirSync(CONFIG_DIR, { recursive: true });

  const previous = await loadConfig();
  const { config, lines } = buildAuthOutcome(apiKey, server, orgs, previous, !!baseUrl);
  await saveConfig(config);

  for (const line of lines) console.log(line);
}

/** Whether a first arg to `dillion auth` is a credential rather than a mistyped subcommand. */
export function looksLikeApiKey(arg: string): boolean {
  return arg.startsWith("dil_");
}

/** Redact a stored key for display: fixed mask + last 4 chars (no length leak). */
export function maskApiKey(key: string): string {
  if (!key) return "(none)";
  return `****${key.length >= 4 ? key.slice(-4) : key}`;
}

/** Outcome of validating the stored key against `GET /orgs`. */
export type KeyCheck =
  | { kind: "valid"; orgs: OrgEntry[] }
  | { kind: "invalid" }
  | { kind: "unreachable" }
  | { kind: "unsupported-server" }
  | { kind: "unexpected" }
  | { kind: "server-error"; status: number };

export interface AuthStatusReport {
  /** Machine-readable shape for `--json`. */
  data: {
    /** Whether a config file with a key is present — NOT whether the key works (see keyStatus). */
    configured: boolean;
    server: string | null;
    apiKey: string | null;
    orgId: string | null;
    orgName: string | null;
    projectId: string | null;
    keyStatus: "valid" | "invalid" | "unverified" | "unauthenticated";
  };
  /** Human-readable lines, printed in order. */
  lines: string[];
  exitCode: number;
}

/**
 * Build the `auth status` report from the stored config and a live key check. Pure so the
 * cases (no config, valid, invalid, and the four "can't verify" outcomes) are unit-testable
 * without fs/network. A missing config is the only failure that exits non-zero besides an
 * outright-invalid key; anything that merely blocks verification (unreachable, server error,
 * unsupported server, unexpected body) leaves a valid local config reported as unverified,
 * not broken.
 */
export function buildAuthStatusReport(
  config: Config | null,
  check: KeyCheck | null
): AuthStatusReport {
  if (!config) {
    return {
      data: {
        configured: false,
        server: null,
        apiKey: null,
        orgId: null,
        orgName: null,
        projectId: null,
        keyStatus: "unauthenticated",
      },
      lines: ["Not authenticated. Run: dillion auth <api-key>"],
      exitCode: 1,
    };
  }

  // Resolve a friendly org name from the membership list only when the key checked out.
  const orgName =
    config.orgId && check?.kind === "valid"
      ? check.orgs.find((o) => o.id === config.orgId)?.name ?? null
      : null;

  const lines: string[] = [
    `Server:   ${config.baseUrl}`,
    `API key:  ${maskApiKey(config.apiKey)}`,
    `Org:      ${config.orgId ? (orgName ? `${orgName} (${config.orgId})` : config.orgId) : "(none selected)"}`,
    `Project:  ${config.projectId ?? "(none)"}`,
  ];

  let keyStatus: AuthStatusReport["data"]["keyStatus"] = "unverified";
  let exitCode = 0;
  switch (check?.kind) {
    case "valid":
      keyStatus = "valid";
      lines.push("Key status: valid");
      break;
    case "invalid":
      keyStatus = "invalid";
      exitCode = 1;
      lines.push("Key status: INVALID — re-authenticate with: dillion auth <api-key>");
      break;
    case "server-error":
      lines.push(`Key status: could not verify (server error ${check.status})`);
      break;
    case "unreachable":
      lines.push("Key status: could not verify (server unreachable)");
      break;
    case "unsupported-server":
      lines.push(
        "Key status: could not verify (server doesn't support org discovery; update the server or CLI)"
      );
      break;
    default:
      lines.push("Key status: could not verify (unexpected server response)");
      break;
  }

  return {
    data: {
      configured: true,
      server: config.baseUrl,
      apiKey: maskApiKey(config.apiKey),
      orgId: config.orgId ?? null,
      orgName,
      projectId: config.projectId ?? null,
      keyStatus,
    },
    lines,
    exitCode,
  };
}

/** Hard cap on the `auth status` validation request so a silent host can't hang the command. */
const AUTH_CHECK_TIMEOUT_MS = 10_000;

/**
 * Classify the HTTP status of a `GET /orgs` response into a KeyCheck outcome, or `ok` when a
 * 2xx means the caller should still parse the body. Pure and total so the status ladder — the
 * logic whose silent breakage caused the original `auth status` bug — is unit-testable.
 *
 * 404 is its own `unsupported-server` case (mirrors the login flow's actionable hint) rather
 * than a generic error: it means the server predates org discovery, not that the key is bad.
 */
export function classifyOrgsStatus(
  status: number
):
  | { kind: "invalid" }
  | { kind: "unsupported-server" }
  | { kind: "server-error"; status: number }
  | { kind: "ok" } {
  if (status === 401 || status === 403) return { kind: "invalid" };
  if (status === 404) return { kind: "unsupported-server" };
  if (status < 200 || status >= 300) return { kind: "server-error", status };
  return { kind: "ok" };
}

/**
 * Validate the stored key against the same pre-org-selection `GET /orgs` route login uses.
 * Sends only the bearer token (no X-Dillion-Org-Id) so the result reflects the key itself,
 * not the current org selection. Never exits — maps every outcome (including a timeout, which
 * rejects into the `.catch` below) to a KeyCheck.
 */
async function checkStoredKey(config: Config): Promise<KeyCheck> {
  const res = await fetch(`${config.baseUrl}/orgs`, {
    method: "GET",
    headers: { Authorization: `Bearer ${config.apiKey}` },
    signal: AbortSignal.timeout(AUTH_CHECK_TIMEOUT_MS),
  }).catch(() => null);

  if (!res) return { kind: "unreachable" };

  const classified = classifyOrgsStatus(res.status);
  if (classified.kind !== "ok") return classified;

  const parsed = parseOrgsResponse(await res.json().catch(() => null));
  if ("unexpected" in parsed) return { kind: "unexpected" };
  return { kind: "valid", orgs: parsed.orgs };
}

export async function authStatusCommand(args: string[]) {
  const { flags } = parseFlags(args);
  if (flags.help === "" || flags.h === "") {
    console.log(
      "Usage: dillion auth status [--json]\n\n" +
        "Show the stored server, API key, org, and project, then validate the key against the server."
    );
    return;
  }

  const config = await loadConfig();
  const check = config ? await checkStoredKey(config) : null;
  const report = buildAuthStatusReport(config, check);

  if (flags.json !== undefined) {
    console.log(JSON.stringify(report.data, null, 2));
  } else {
    for (const line of report.lines) console.log(line);
  }

  if (report.exitCode !== 0) process.exit(report.exitCode);
}
