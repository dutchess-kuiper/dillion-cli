export async function docsCommand() {
  const docs = `
dillion - CLI for Dillion Bastion API

SETUP
  dillion auth <api-key>                  Authenticate with your API key
  dillion auth <api-key> --url=<url>      Use a custom server URL
  dillion auth status [--json]            Show server, masked key, org, project; check the key

SEARCH
  dillion search <query> -p <pid>         Hybrid search across document chunks
    --limit <n>                           Max results (default: 10)
    --alpha <0-1>                         0 = keyword, 1 = semantic (default: 0.5)
    --job <id>                            Filter to a specific job
    --blocks                              Include citable blocks per hit ([n] type p.page text)

ORGANIZATIONS
  dillion org list                        List organizations you belong to (marks active)
  dillion org use <id-or-name>            Set the active org (sent as X-Dillion-Org-Id)
  dillion org show | dillion org clear    Show or clear the active org
    (override for one command with the global --org-id <org_...> flag)

PROJECTS
  dillion projects list [--name <text>]     List your projects (optional name filter)
  dillion projects create <name>           Create a project
    --description, -d <text>               Optional description
    --access <none|view|edit>              Workspace-wide access (default: edit)
  dillion projects members -p <pid>        List who has data room access
  dillion projects invitations -p <pid>    List pending email invitations
  dillion projects invite <email> -p <pid> Give someone data room access by email
  dillion project use <pid>                Save default project (omit -p on later commands)
  dillion project show | dillion project clear

FILES
  dillion files search <query> -p <pid>   Search files by name
  dillion files download <id...> -p <pid> Download files locally
    --format <original|txt>               Download the original file or extracted text
    --out, -o <path>                      Save to file or directory
  dillion files upload <path...> -p <pid> Upload one or more files
    --wait                                Wait until ingestion completes
    --force                               Upload even if same file name exists in project

JOBS
  dillion jobs list -p <pid>              List jobs in a project
    --status <status>                     Filter by status
    --search <text>                       Search by filename
    --archived                            Show only archived jobs (--archived false = active only)
    --limit <n>                           Max results (default: 50)
    --offset <n>                          Pagination offset
  dillion jobs get <job-id>               Get job details and steps
  dillion jobs wait <job-id>              Wait until job status is completed (ingestion done) or failed
    --interval <sec>                      Poll interval (default: 5)
    --timeout <sec>                       Max wait, 0 = none (default: 0)
                                          (prints per-step timing while polling)
  dillion jobs archive <job-id...>        Archive jobs (excluded from search/agent, cannot be retried)
  dillion jobs unarchive <job-id...>      Restore archived jobs
    --json                                Print the updated job payload(s)

AGENT
  dillion agent ask <query> -p <pid>      Ask a question (generates answer)
  dillion agent search <query> -p <pid>   Retrieval-only search
    --limit <n>                           Max results (default: 10)

OBLIGATIONS
  dillion obligations <pid>               Download material obligations as CSV
    --out, -o <file>                      Save to file instead of stdout

FILTERS
  dillion filters <pid>                   Get filter facets for a project

REPORTS (artifacts)
  dillion artifacts init [dir]            Scaffold a Vite + React report
  dillion artifacts dev [dir]             Run the report dev server
  dillion artifacts build [dir]           Build the report bundle
  dillion artifacts publish [dir] --title <t> -p <pid>
                                          Publish a NEW report from dir/dist
  dillion artifacts publish [dir] --report <report-id> [--notes <text>]
                                          Publish a new VERSION of a report
    --no-raw                              Don't upload the source zip
    --pdf <path> / --workbook <path>      Attach a PDF / spreadsheet for download
    --memo-chat / --no-memo-chat          Turn Ask memo chat on or off (default off)
  dillion artifacts attach-pdf <report-id> --pdf <path> | --remove [--version N]
  dillion artifacts attach-workbook <report-id> --workbook <path> | --remove [--version N]
  dillion artifacts memo-chat <enable|disable> <report-id>
  dillion artifacts download-raw <report-id> --out <path> [--version N]
  dillion artifacts list -p <pid>         List reports in a project
  dillion artifacts get <report-id>       Show a report and its versions
  dillion artifacts share <report-id> --password <pw>
                                          Password-protected link to one report (8+ chars)
    --expires-days <N>                    Expire in N days (1-365)
    --no-citations                        Turn off source-document preview
  dillion artifacts share list <report-id>
  dillion artifacts share update <report-id> <share-id> [--password <pw>] [--expires-days N]
                                          [--no-expiry] [--version N | --latest] [--no-citations]

SHARE LINKS (several reports behind one link)
  dillion share-links create -p <pid> --title <t> --reports <id1,id2> --password <pw>
    --labels "FDD|Cap Table"              Tab labels, | separated, aligned with --reports
    --versions "3||1"                     Pin versions per tab (empty = latest)
    --description <text> / --slug <slug>
    --expires-days <N>                    Expire in N days (1-365)
    --domains a.com / --emails a@x.com    Viewer must enter an allowed email
    --no-citations                        Turn off source-document preview
  dillion share-links list -p <pid>       List links in a project
  dillion share-links get <link-id>       Show a link, its reports and URLs
  dillion share-links update <link-id>    Change title, slug, password, expiry, allowlists, reports
  dillion share-links revoke <link-id>    Revoke a link

PORTAL LINKS (no password; clients sign in at portal.dillion.ai)
  dillion share-links portal-orgs <name>  Look up existing client org ids
  dillion share-links create -p <pid> --title <t> --reports <ids> --portal
                                          Portal-only link: no /share URL, no password
    --clients a@x.com,b@y.com             Existing portal clients (exact emails)
    --orgs org_…,org_…                    Existing client orgs (ids; every member gets access)
    --no-notify                           Don't email the clients or org members
  dillion share-links portal-add <link-id> --clients … --orgs …
                                          Give existing clients/orgs access to any link
  dillion share-links portal-list <link-id>
                                          Portal URL, and who can open it
    Only EXISTING clients and orgs are accepted; invite new people from the VDR web app.
    Portal viewers always see source previews (no --no-citations) and the latest versions.

OTHER
  dillion health                          Check server status
  dillion update                          Update to latest version
  dillion version                         Show version

HELP
  dillion help                            Quick list of every command
  dillion <command> --help                Help for one command (or: dillion help <command>)
  dillion docs                            Show this reference
  dillion skill                           Print the dillion-cli agent skill (--out <path> to save)

FLAGS
  --project, -p <id>                      Project ID (optional after dillion project use)
  --org-id <org_...>                      Act in this org for one command (overrides org use)
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
  dillion jobs archive <job-id> <job-id>
  dillion project use 8f3a...
  dillion files upload ./contract.pdf --wait
  dillion files upload ./contract.pdf -p 8f3a... --json | jq -r .job_id | xargs -I{} dillion jobs wait {}
  dillion artifacts publish ./my-report --title "Acme FDD" -p 8f3a...
  dillion share-links portal-orgs "Acme"
  dillion share-links create -p 8f3a... --title "Acme pack" --reports <id1>,<id2> --portal --orgs org_…
`;

  console.log(docs.trim());
}
