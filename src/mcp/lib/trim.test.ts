import { describe, expect, test } from "bun:test";
import agentAsk from "../fixtures/agentAsk.json";
import agentSearch from "../fixtures/agentSearch.json";
import jobsList from "../fixtures/jobsList.json";
import search from "../fixtures/search.json";
import {
  trimAgentAsk,
  trimAgentSearchResult,
  trimJobsListItem,
  trimSearchResult,
  truncate,
} from "./trim";

describe("truncate", () => {
  test("passes short text through untouched", () => {
    const r = truncate("hello", 800);
    expect(r).toEqual({ value: "hello", truncated: false, total: 5 });
  });

  test("truncates long text and appends the marker", () => {
    const r = truncate("0123456789", 4);
    expect(r.truncated).toBe(true);
    expect(r.total).toBe(10);
    expect(r.value).toBe("0123…[truncated]");
  });

  test("treats non-string input as empty", () => {
    expect(truncate(undefined as any).value).toBe("");
  });
});

describe("trimSearchResult", () => {
  test("keeps citation keys, uses enriched, drops content/distance", () => {
    const r = trimSearchResult(search.results[0], 800);
    expect(r).toEqual({
      jobId: "job_1",
      chunkId: "chunk_abc",
      chunkIndex: 3,
      fileName: "Credit Agreement.pdf",
      pages: [12, 13],
      score: 0.87,
      text: search.results[0]!.enriched,
    });
    expect(r).not.toHaveProperty("content");
    expect(r).not.toHaveProperty("distance");
    expect(r).not.toHaveProperty("enriched");
  });

  test("truncates the chunk text at maxChars", () => {
    const r = trimSearchResult(search.results[0], 10);
    expect(r.text.endsWith("…[truncated]")).toBe(true);
    expect(r.text.length).toBe(10 + "…[truncated]".length);
  });

  test("falls back to content when enriched is absent", () => {
    const r = trimSearchResult({ content: "raw only", chunkId: "c1" }, 800);
    expect(r.text).toBe("raw only");
  });
});

describe("trimJobsListItem", () => {
  test("always drops s3Key and surfaces documentCategory", () => {
    const r = trimJobsListItem(jobsList.jobs[0], false);
    expect(r).toEqual({
      id: "job_1",
      fileName: "Lease.pdf",
      status: "completed",
      createdAt: "2026-01-02T03:04:05Z",
      documentCategory: "Real Estate",
    });
    expect(JSON.stringify(r)).not.toContain("s3");
    expect(r).not.toHaveProperty("metadata");
  });

  test("includes full metadata only when includeMetadata is true", () => {
    const r = trimJobsListItem(jobsList.jobs[0], true);
    expect(r.metadata).toEqual(jobsList.jobs[0]!.metadata);
    expect(r).not.toHaveProperty("s3Key");
  });
});

describe("trimAgentAsk", () => {
  test("normalizes objectId → chunkId and maps token/time fields", () => {
    const r = trimAgentAsk(agentAsk);
    expect(r.answer).toBe(agentAsk.answer);
    expect(r.isPartialAnswer).toBe(true);
    expect(r.missingInformation).toEqual(["exact covenant thresholds"]);
    expect(r.sources).toEqual([
      { chunkId: "obj_1", collection: "chunks" },
      { chunkId: "obj_2", collection: "chunks" },
    ]);
    expect(r.totalTokens).toBe(1234);
    expect(r.totalTimeMs).toBe(567);
  });
});

describe("trimAgentSearchResult", () => {
  test("normalizes uuid → chunkId and snake_case → camelCase", () => {
    const r = trimAgentSearchResult(agentSearch.results[0], 800);
    expect(r.chunkId).toBe("uuid_123");
    expect(r.collection).toBe("chunks");
    expect(r.fileName).toBe("Master Services Agreement.pdf");
    expect(r.text).toContain("indemnification");
  });
});
