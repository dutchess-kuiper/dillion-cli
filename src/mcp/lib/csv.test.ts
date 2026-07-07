import { describe, expect, test } from "bun:test";
import { parseCsvLine, parseObligationsBody, summarizeCsv } from "./csv";

describe("parseCsvLine", () => {
  test("splits plain fields", () => {
    expect(parseCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  test("honors quoted fields containing commas and escaped quotes", () => {
    expect(parseCsvLine('"Doe, John","She said ""hi""",plain')).toEqual([
      "Doe, John",
      'She said "hi"',
      "plain",
    ]);
  });
});

describe("summarizeCsv", () => {
  test("counts data rows and reads header columns", () => {
    const csv = "id,name,category\n1,Lease,RE\n2,Note,Fin\n";
    const s = summarizeCsv(csv);
    expect(s.columns).toEqual(["id", "name", "category"]);
    expect(s.rowCount).toBe(2);
    expect(s.byteSize).toBe(Buffer.byteLength(csv, "utf-8"));
  });

  test("handles trailing blank lines", () => {
    const s = summarizeCsv("a,b\n1,2\n\n\n");
    expect(s.rowCount).toBe(1);
    expect(s.columns).toEqual(["a", "b"]);
  });
});

describe("parseObligationsBody", () => {
  test("CSV branch: text/csv content type", () => {
    const body = "id,obligation\n1,pay rent\n";
    const r = parseObligationsBody(body, "text/csv");
    expect(r.kind).toBe("csv");
    if (r.kind === "csv") {
      expect(r.rowCount).toBe(1);
      expect(r.columns).toEqual(["id", "obligation"]);
    }
  });

  test("CSV branch: no content type, plain CSV body", () => {
    const r = parseObligationsBody("a,b\n1,2\n");
    expect(r.kind).toBe("csv");
  });

  test("JSON-error branch: application/json with detail", () => {
    const r = parseObligationsBody('{"detail":"project not found"}', "application/json");
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toBe("project not found");
  });

  test("JSON-error branch: {error} body even without content type", () => {
    const r = parseObligationsBody('{"error":"forbidden"}');
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toBe("forbidden");
  });
});
