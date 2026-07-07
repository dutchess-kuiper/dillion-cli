import { describe, expect, test } from "bun:test";
import { detectTxtUnsupported } from "./files";

describe("detectTxtUnsupported (files_text 'Cannot GET' detection)", () => {
  test("true for a 404 whose body contains 'Cannot GET'", () => {
    expect(detectTxtUnsupported(404, "Cannot GET /files/text/job_1")).toBe(true);
  });

  test("false for a 404 without the marker", () => {
    expect(detectTxtUnsupported(404, '{"detail":"job not found"}')).toBe(false);
  });

  test("false for a non-404 status even with the marker", () => {
    expect(detectTxtUnsupported(500, "Cannot GET /x")).toBe(false);
  });
});
