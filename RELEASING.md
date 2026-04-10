# Releasing dillion-cli

Releases are **tag-driven**. Pushing a version tag runs [`.github/workflows/release.yml`](.github/workflows/release.yml), which compiles the CLI for four platforms and attaches the binaries to a GitHub Release.

## Before you tag

1. **Bump the version in two places** (they must match):
   - [`package.json`](package.json) — `"version": "x.y.z"`
   - [`src/index.ts`](src/index.ts) — `export const VERSION = "x.y.z"`

2. **Commit** the version bump (and any other changes) on `main`.

## Publish a release

1. Create an annotated tag that matches the version, with a `v` prefix:

   ```sh
   git tag -a v0.1.11 -m "v0.1.11"
   ```

2. Push the tag:

   ```sh
   git push origin v0.1.11
   ```

   (Push your branch commit first if needed: `git push origin main`.)

3. **GitHub Actions** runs on **macOS**, builds the CLI, ad-hoc signs the macOS binaries, and uploads:

   - `dist/dillion-darwin-arm64`
   - `dist/dillion-darwin-x64`
   - `dist/dillion-linux-x64`
   - `dist/dillion-linux-arm64`

   Release notes are generated automatically (`generate_release_notes: true`).

4. Confirm the release under **Releases** on GitHub; `install.sh` and `dillion update` pull **latest** from there.

### Prerequisites

- **Bun** is used for the build (`bun build --compile` per target in `package.json`).
- **macOS binaries are signed in CI** before upload so `dillion update` installs runnable executables on macOS.
- Workflow permissions: `contents: write` (already set in the workflow) so the action can create/update the release.

## Local build (sanity check)

To verify binaries before tagging:

```sh
bun install
bun run build
```

Artifacts land in `dist/`. This matches what CI produces.

## Optional: manual release with GitHub CLI

[`package.json`](package.json) includes a `release` script that builds locally and runs `gh release create` with the compiled assets. This overlaps with the tag-based workflow; prefer **tag + CI** for a single source of truth. Use the script only if you intentionally want a manual upload (requires [`gh`](https://cli.github.com/) authenticated to the repo).

```sh
bun run release
```

## What users install

- **Fresh install:** `install.sh` downloads the latest release asset from GitHub (see [`install.sh`](install.sh)).
- **Updates:** `dillion update` runs the same install script; existing config at `~/.config/dillion/config.json` is unchanged.

`install.sh` is served from the **`main`** branch; binary versions come from **Releases**. If you change `install.sh`, merge to `main` so new installs see it; users on older installs get it on the next `dillion update` once `main` includes your change.
