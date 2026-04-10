export async function docsCommand() {
  const docs = `
dillion - CLI for Dillion Bastion API

SETUP
  dillion auth <api-key>                  Authenticate with your API key
  dillion auth <api-key> --url=<url>      Use a custom server URL

SEARCH
  dillion search <query> -p <pid>         Hybrid search across document chunks
    --limit <n>                           Max results (default: 10)
    --alpha <0-1>                         0 = keyword, 1 = semantic (default: 0.5)
    --job <id>                            Filter to a specific job

PROJECTS
  dillion projects list [--name <text>]     List your projects (optional name filter)
  dillion projects create <name>           Create a project
    --description, -d <text>               Optional description

FILES
  dillion files search <query> -p <pid>   Search files by name
  dillion files download <id...> -p <pid> Download files locally
    --format <original|txt>               Download the original file or extracted text
    --out, -o <path>                      Save to file or directory
  dillion files upload <path...> -p <pid> Upload one or more files (requires bastion upload proxy)

JOBS
  dillion jobs list -p <pid>              List jobs in a project
    --status <status>                     Filter by status
    --search <text>                       Search by filename
    --limit <n>                           Max results (default: 50)
    --offset <n>                          Pagination offset
  dillion jobs get <job-id>               Get job details and steps
  dillion jobs wait <job-id>              Wait until job status is completed (ingestion done) or failed
    --interval <sec>                      Poll interval (default: 5)
    --timeout <sec>                       Max wait, 0 = none (default: 0)

AGENT
  dillion agent ask <query> -p <pid>      Ask a question (generates answer)
  dillion agent search <query> -p <pid>   Retrieval-only search
    --limit <n>                           Max results (default: 10)

OBLIGATIONS
  dillion obligations <pid>               Download material obligations as CSV
    --out, -o <file>                      Save to file instead of stdout

FILTERS
  dillion filters <pid>                   Get filter facets for a project

OTHER
  dillion health                          Check server status
  dillion update                          Update to latest version
  dillion version                         Show version
  dillion docs                            Show this reference
  dillion help                            Show quick help

FLAGS
  --project, -p <id>                      Project ID
  --json                                  Output raw JSON (all commands)
  --limit <n>                             Result limit
  --out, -o <file>                        Output file

EXAMPLES
  dillion auth dln_abc123
  dillion projects list
  dillion projects create "New deal" -d "Client X"
  dillion search "revenue recognition" -p 8f3a...
  dillion jobs list -p 8f3a... --status completed --json
  dillion obligations 8f3a... -o matobs.csv
  dillion agent ask "What are the key covenants?" -p 8f3a...
  dillion jobs list -p 8f3a... --json | jq '.jobs[].fileName'
  dillion jobs wait <job-id> --timeout 7200
  dillion files upload ./contract.pdf -p 8f3a... --json | jq -r .job_id | xargs -I{} dillion jobs wait {}
`;

  console.log(docs.trim());
}
