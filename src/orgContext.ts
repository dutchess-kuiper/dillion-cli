/**
 * Acting-org override for the current CLI invocation.
 *
 * `index.ts` resolves the acting org ONCE at startup (--org-id flag ?? config.orgId)
 * and stashes the RESOLVED value here via `setOrgOverride`. `buildHeaders` in `api.ts`
 * reads it synchronously to attach `X-Dillion-Org-Id`. Resolving at startup (rather than
 * inside each fetch site) is required because `buildHeaders` is sync while config load is
 * async — stashing only the flag would silently drop `config.orgId`.
 */

let _orgOverride: string | undefined;

/** Stash the resolved acting org id (undefined = let bastion auto-select or error). */
export function setOrgOverride(orgId: string | undefined): void {
  _orgOverride = orgId?.trim() || undefined;
}

/** The resolved acting org id for this invocation, or undefined. */
export function getOrgOverride(): string | undefined {
  return _orgOverride;
}

/**
 * Precedence for the acting org: --org-id flag > config.orgId > none.
 * Pure so precedence is unit-testable independently of I/O and the CLI entrypoint.
 */
export function resolveOrgOverride(
  flagValue: string | undefined,
  configOrgId: string | undefined
): string | undefined {
  const flag = flagValue?.trim();
  if (flag) return flag;
  return configOrgId?.trim() || undefined;
}

/**
 * A raw `--org-id` value must be an org id (`org_...`), not a name; names resolve only in
 * `dillion org use`. Used by `index.ts` to print a hint on misuse.
 */
export function looksLikeOrgId(value: string): boolean {
  return value.trim().startsWith("org_");
}

/**
 * Classify the raw `--org-id` value captured by `stripOrgIdFlag`:
 *   "absent" -> the flag was not passed at all (undefined).
 *   "empty"  -> the flag was passed with no value (`--org-id`, `--org-id=`, `--org-id --json`,
 *               or whitespace-only). A usage error: falling back to the saved org here would
 *               silently run against the very org the user tried to override away from.
 *   "value"  -> a real, trimmed org id.
 * Keeping "absent" and "empty" distinct is what lets the entrypoint reject the empty case
 * instead of silently treating it as "not supplied".
 */
export type OrgIdFlag =
  | { kind: "absent" }
  | { kind: "empty" }
  | { kind: "value"; value: string };

export function classifyOrgIdFlag(flag: string | undefined): OrgIdFlag {
  if (flag === undefined) return { kind: "absent" };
  const trimmed = flag.trim();
  if (trimmed === "") return { kind: "empty" };
  return { kind: "value", value: trimmed };
}
