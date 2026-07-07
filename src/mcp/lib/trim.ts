/**
 * Pure result shapers. Bastion responses carry redundant/leaky fields (both `content`
 * and `enriched` on search hits; `s3Key` + full `metadata` on jobs; the same chunk UUID
 * named `chunkId` / `uuid` / `objectId` across endpoints). These functions trim to the
 * model-facing shape documented in the plan so tool output stays small and consistently
 * keyed on `chunkId`.
 */

export interface Truncated {
  value: string;
  truncated: boolean;
  total: number;
}

/** Truncate `text` to `max` chars, appending `…[truncated]` and reporting the original length. */
export function truncate(text: string, max = 800): Truncated {
  const s = typeof text === "string" ? text : "";
  const total = s.length;
  if (total <= max) return { value: s, truncated: false, total };
  return { value: s.slice(0, max) + "…[truncated]", truncated: true, total };
}

export interface TrimmedSearchResult {
  jobId: string | undefined;
  chunkId: string | undefined;
  chunkIndex: number | undefined;
  fileName: string | undefined;
  pages: unknown[];
  score: number | undefined;
  text: string;
}

/**
 * `/search` hit → model shape. Keeps the canonical citation keys (`jobId` + `chunkId`),
 * uses `enriched` (fallback `content`) for the text truncated to `maxChars`, and drops the
 * duplicate `content`/`distance` fields.
 */
export function trimSearchResult(r: any, maxChars = 800): TrimmedSearchResult {
  const body = typeof r?.enriched === "string" && r.enriched.length > 0 ? r.enriched : r?.content;
  return {
    jobId: r?.jobId,
    chunkId: r?.chunkId,
    chunkIndex: r?.chunkIndex,
    fileName: r?.fileName,
    pages: Array.isArray(r?.pages) ? r.pages : [],
    score: r?.score,
    text: truncate(body ?? "", maxChars).value,
  };
}

export interface TrimmedJobsListItem {
  id: string | undefined;
  fileName: string | undefined;
  status: string | undefined;
  createdAt: string | undefined;
  documentCategory: string | undefined;
  metadata?: unknown;
}

/**
 * `/jobs/list` item → model shape. `s3Key` is ALWAYS dropped; the full `metadata` object is
 * included only when `includeMetadata` is true. `documentCategory` is surfaced from
 * `metadata.document_category` regardless.
 */
export function trimJobsListItem(job: any, includeMetadata = false): TrimmedJobsListItem {
  const out: TrimmedJobsListItem = {
    id: job?.id,
    fileName: job?.fileName,
    status: job?.status,
    createdAt: job?.createdAt,
    documentCategory: job?.metadata?.document_category,
  };
  if (includeMetadata) out.metadata = job?.metadata;
  return out;
}

export interface TrimmedAgentAsk {
  answer: string | undefined;
  isPartialAnswer: boolean;
  missingInformation: unknown[];
  sources: { chunkId: string | undefined; collection: string | undefined }[];
  totalTokens: number | undefined;
  totalTimeMs: number | undefined;
}

/**
 * `/agent/ask` → model shape. Sources are normalized `objectId` → `chunkId`. NOTE: agent/ask
 * sources carry NO jobId — the tool description tells the model to use `search` for citations.
 */
export function trimAgentAsk(data: any): TrimmedAgentAsk {
  return {
    answer: data?.answer,
    isPartialAnswer: data?.isPartialAnswer === true,
    missingInformation: Array.isArray(data?.missingInformation) ? data.missingInformation : [],
    sources: (Array.isArray(data?.sources) ? data.sources : []).map((s: any) => ({
      chunkId: s?.objectId,
      collection: s?.collection,
    })),
    totalTokens: data?.usage?.totalTokens,
    totalTimeMs: data?.totalTime,
  };
}

export interface TrimmedAgentSearchResult {
  chunkId: string | undefined;
  collection: string | undefined;
  fileName: string | undefined;
  text: string;
}

/**
 * `/agent/search` item → model shape. Normalizes `uuid` → `chunkId` and snake_case
 * `properties.file_name`/`content` → camelCase `fileName`/`text` (truncated).
 */
export function trimAgentSearchResult(r: any, maxChars = 800): TrimmedAgentSearchResult {
  return {
    chunkId: r?.uuid,
    collection: r?.collection,
    fileName: r?.properties?.file_name,
    text: truncate(r?.properties?.content ?? "", maxChars).value,
  };
}
