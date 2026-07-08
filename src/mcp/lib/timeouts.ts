/**
 * Per-request network timeouts for the long-lived MCP server. `api()` and the presigned
 * download use bare `fetch` with no timeout, so without an abort signal a single hung
 * connection would block a tool call (and, in the poll loop, defeat the bounded deadline)
 * indefinitely. These bound each individual request; a timeout surfaces as a normal tool
 * error, never a hang.
 */

/** A single job-status poll (`GET /jobs/:id`) should return in seconds. */
export const JOB_POLL_FETCH_TIMEOUT_MS = 30_000;

/** A presigned document download can be large, so allow more headroom per file. */
export const FILE_DOWNLOAD_TIMEOUT_MS = 120_000;
