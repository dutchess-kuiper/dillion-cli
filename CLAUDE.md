# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## What this is

Terminal client for the Dillion Bastion API (`bastion.dillion.ai`) — the Bun/Express gateway in the sibling `dillion-bastion` repo. The CLI covers auth/org selection, project and file management, ingestion jobs, hybrid search, agent ask/search, obligations export, and the artifacts workflow (publish/share research reports). It ships as standalone compiled binaries; users install via `install.sh` and update with `dillion update`.

## Runtime and commands

The runtime is **Bun**, not Node — source uses `Bun.file`, `Bun.write`, and `bun build --compile`. Do not introduce Node-only APIs or npm scripts that assume `node`.

```sh
bun src/index.ts <command>   # run the CLI locally (or: bun run dev)
bun test                     # unit tests (bun:test, colocated *.test.ts)
bunx tsc --noEmit            # typecheck (strict mode)
bun run build                # compile all four platform binaries into dist/
```

Verify changes with `bun test` and `bunx tsc --noEmit` before finishing. `bun build --compile` may leave stray `.<hash>.bun-build` artifacts in the repo root — delete them, never commit them.

## Architecture

Single entry point, one file per command group, no CLI framework:

- `src/index.ts` — arg splitting (`command` / `subcommand`), the `HELP` text, the `switch` dispatch (commands lazy-`import`ed), the daily update check, and `export const VERSION`. The global `--org-id` flag is stripped here before dispatch so per-command parsers never see it.
- `src/commands/*.ts` — one file per command group (`auth`, `org`, `projects`, `files`, `jobs`, `artifacts`, …).
- `src/api.ts` — the fetch layer: `Bearer` auth from config, `X-Dillion-Org-Id` header when an org is active, bastion error-slug mapping (`formatApiError`), multipart upload/download helpers.
- `src/config.ts` — credentials and defaults at `~/.config/dillion/config.json` (`apiKey`, `baseUrl`, optional `orgId` / `projectId`). `getConfig()` exits if not logged in; `loadConfig()` returns null.
- `src/flags.ts` — the shared `parseFlags` (`--flag value`, `--flag=value`, `-f value`, repeated flags, `--` passthrough).
- `src/orgContext.ts` / `src/projectContext.ts` — resolve the acting org/project (flag → saved config).

### The testable-core pattern

Commands separate decision logic from IO: pure functions take parsed inputs and return data (`buildAuthOutcome`, `buildAuthStatusReport`, `classifyOrgsStatus`, `resolveOrgSelector`), while thin `*Command` wrappers do fetch/fs/`process.exit` and printing. Put new branching logic in an exported pure function and unit-test it in a colocated `*.test.ts`; keep the wrapper mechanical. `process.exit` and bare `fetch` belong only in wrappers.

## Conventions

- **Adding a command:** add the dispatch branch in `src/index.ts`, a line in its `HELP` string, a `--help` path in the command itself, and document it in `README.md`. Subcommand groups branch on `subcommand` and pass `subrest` (see `org` / `projects` for the pattern).
- **Errors:** print to stderr and `process.exit(1)`. Exit codes are part of the contract — scripts depend on them (`jobs wait`, `auth status`).
- **Secrets:** API keys are `dil_`-prefixed. Never print a stored key (mask with the last 4 chars) and never echo a rejected argument back — it may be a real secret that would land in CI logs.
- **Network calls** should carry an `AbortSignal.timeout(...)` so no command can hang on a silent host.
- **`--json`** on read commands prints machine-readable output; keep human and JSON paths building from the same data.

## Gotchas

- **`main` is protected.** Direct pushes are rejected by repository rules — every change lands through a PR, including version bumps.
- **Releases are tag-driven** (see `RELEASING.md`). The version lives in **two places that must match**: `package.json` `"version"` and `VERSION` in `src/index.ts`. Bump both, land the commit on `main` via PR, then push the `v<x.y.z>` tag — CI builds and signs the binaries and creates the GitHub Release that `dillion update` and `install.sh` pull from.
- The update check in `src/index.ts` hits the GitHub releases API at most once per day and is skipped for `auth`/`update`/`version`/`help`.
