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

### Files

Search files by name:

```sh
dillion files search "agreement" -p <project-id>
```

Download files locally:

```sh
dillion files download <job-id-1> <job-id-2> -p <project-id>
dillion files download <job-id> -p <project-id> --format txt
dillion files download <job-id> -p <project-id> --out ./downloads/
```

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
