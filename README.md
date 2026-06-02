# Dillion CLI

Command-line interface for the Dillion Bastion API.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/dutchess-kuiper/dillion-cli/main/install.sh | bash
```

## Setup

```sh
dillion auth <your-api-key>
```

By default connects to `https://bastion.dillion.ai`. To use a different server:

```sh
dillion auth <your-api-key> --url=http://localhost:3100
```

## Commands

### Search

Hybrid search across document chunks:

```sh
dillion search "revenue recognition" -p <project-id>
dillion search "lease terms" -p <project-id> --limit 20 --alpha 0.7
```

### Projects

List projects (optional substring filter on name):

```sh
dillion projects list
dillion projects list --name acme
```

Create a project:

```sh
dillion projects create "Q4 diligence"
dillion projects create my-project -d "Optional description"
```

### Files

Search files by name:

```sh
dillion files search "agreement" -p <project-id>
```

Download VDR source documents locally (original uploads or extracted text):

```sh
# Original PDFs, XLSX, etc. (signed URLs)
dillion files download <job-id-1> <job-id-2> -p <project-id> --out ./downloads/

# Extracted plain text (offline review, quote extraction)
dillion files download <job-id> -p <project-id> --format txt --out ./txt/

# Resolve job IDs from filename
dillion jobs list -p <project-id> --status completed --search "credit agreement"
dillion files search "agreement" -p <project-id> --json
```

`--out` is treated as a directory when downloading multiple jobs or when the path looks like a folder; otherwise it is the literal output filename.

### Jobs

List jobs with filters:

```sh
dillion jobs list -p <project-id>
dillion jobs list -p <project-id> --status completed --search "lease"
```

Get job details:

```sh
dillion jobs get <job-id>
```

### Agent

Ask a question (generates an answer from documents):

```sh
dillion agent ask "What are the key financial covenants?" -p <project-id>
```

Retrieval-only search:

```sh
dillion agent search "indemnification clauses" -p <project-id>
```

### Obligations

Download material obligations as CSV:

```sh
dillion obligations <project-id>
dillion obligations <project-id> --out obligations.csv
```

### Research reports (`artifacts`)

Scaffold, build, and publish interactive JSX reports (see `dillion artifacts help`).

Report bundles are **classic IIFE builds** loaded in a **same-origin iframe** on the VDR share/member viewer — no sandbox, no PostHog dependency in the bundle.

**Session replay** is handled entirely by the VDR web app after the viewer email gate (same model as ONDA memos). Nothing to configure in the report project — republish with CLI v0.1.20+ to drop PostHog from older bundles.

#### Publish and download report source (raw zip)

Each `artifacts publish` uploads a **source zip** of the report directory (excluding `node_modules`, `dist`, `.git`, and secrets) so teammates can sync the Vite project. Skip it with `--no-raw` if you only want the built bundle.

```sh
# First publish — returns report.id
dillion artifacts publish ./report --title "Acme FDD" -p <project-id>

# Later versions — same report.id
dillion artifacts publish ./report --report <report-id> --notes "v2 — updated KPIs"

# Download the source zip (latest version by default)
dillion artifacts download-raw <report-id> --out ./report-source.zip

# Pin to a specific published version
dillion artifacts download-raw <report-id> --out ./report-v1.zip --version 1
```

Unzip and run locally:

```sh
unzip report-source.zip -d ./report && cd ./report && bun install && dillion artifacts dev
```

#### Attached PDF (share viewer "Download as PDF")

Attach a pre-rendered PDF so the share viewer's **Download as PDF** button serves it directly (instead of generating one server-side). Optional — without it the generated-PDF flow still works.

```sh
# Attach on publish (max 32 MiB)
dillion artifacts publish ./report --report <report-id> --pdf ./report.pdf

# Replace or attach after the report is live — no republish, no new version
dillion artifacts attach-pdf <report-id> --pdf ./updated.pdf

# Remove (viewer falls back to generated PDF)
dillion artifacts attach-pdf <report-id> --remove

# Target a specific version (default: current). Share links pinned to a
# different version keep that version's PDF.
dillion artifacts attach-pdf <report-id> --pdf ./v1.pdf --version 1
```

#### Single-report share links

Create one password-protected link for a single published report. The link follows **latest** by default — republishing with `--report <id>` updates what viewers see at the same URL.

```sh
# List reports and pick report-id
dillion artifacts list -p <project-id>

# Create share (password required for external diligence — 8+ chars)
dillion artifacts share <report-id> --password '<password>' --expires-days 30

# Inspect existing shares
dillion artifacts share list <report-id>

# Update password, expiry, or citation preview
dillion artifacts share update <report-id> <share-id> --password '<new-password>'
dillion artifacts share update <report-id> <share-id> --expires-days 14
dillion artifacts share update <report-id> <share-id> --no-citations   # hide source preview
dillion artifacts share update <report-id> <share-id> --latest         # follow latest version
```

Counterparty URL format:

```
https://vdr.dillion.ai/share/reports/<token>
```

Useful viewer URLs (append to the share URL):

| Suffix / query | Purpose |
|----------------|---------|
| `/files` | Full-page VDR corpus browser (requires citation preview enabled) |
| `?tab=files` | Open the “VDR Files” tab beside the report |
| `?noTop=1` or `?embed=1` | Hide the title/version header |

### Multi-report share links (`share-links`)

Use when one counterparty link should bundle **multiple reports** as tabs — e.g. FDD memo + cap table + doc-DD summary on the same deal.

```sh
# Create — comma-separated report IDs, optional tab labels and version pins
dillion share-links create \
  -p <project-id> \
  --title "Acme diligence pack" \
  --description "Q3 2025 financial and legal review" \
  --reports <report-id-1>,<report-id-2>,<report-id-3> \
  --labels "FDD|Cap Table|Doc DD" \
  --versions "3||1" \
  --password '<password>' \
  --expires-days 30

# Optional email gate (viewer must enter an allowed address)
dillion share-links create \
  -p <project-id> \
  --title "Counsel review" \
  --reports <report-id> \
  --password '<password>' \
  --domains lawfirm.com \
  --emails partner@lawfirm.com

# Manage
dillion share-links list -p <project-id>
dillion share-links get <link-id>
dillion share-links update <link-id> --password '<new-password>' --expires-days 14
dillion share-links update <link-id> --reports <id1>,<id2> --labels "FDD|Cap Table"
dillion share-links revoke <link-id>
```

Counterparty URL format:

```
https://vdr.dillion.ai/share/<slug>
```

**`--labels` and `--versions` alignment:** pipe-separated entries match `--reports` index-by-index. An empty entry means “use report title” (labels) or “always latest” (versions). Example: `--reports a,b,c --versions "2||1"` pins report A to v2, B to latest, C to v1.

**Defaults:** source-document preview (click-through citations) is **on** unless you pass `--no-citations`. Passwords must be **8+ characters**; expiry is **1–365 days** when set.

Set `DILLION_FRONTEND_URL` (e.g. `https://vdr.dillion.ai`) if the CLI should print full URLs instead of relative paths.

### Filters

Get available filter facets for a project:

```sh
dillion filters <project-id>
```

### Other

```sh
dillion health       # Check server status
dillion update       # Update to latest version
dillion --version    # Show version
dillion help         # Show help
```

## Flags

| Flag | Short | Description |
|------|-------|-------------|
| `--project` | `-p` | Project ID |
| `--description` | `-d` | Project description (`projects create`) |
| `--name` | | Filter projects by name substring (`projects list`) |
| `--json` | | Output raw JSON |
| `--limit` | | Result limit |
| `--out` | `-o` | Output file or directory |

All commands support `--json` for raw JSON output, useful for piping:

```sh
dillion jobs list -p <project-id> --json | jq '.jobs[].fileName'
```

## Update

```sh
dillion update
```

## Uninstall

```sh
sudo rm /usr/local/bin/dillion
rm -rf ~/.config/dillion
```

## Releasing (maintainers)

See [RELEASING.md](RELEASING.md) for versioning, tags, and CI.
