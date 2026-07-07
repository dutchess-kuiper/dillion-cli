import { describe, expect, test } from "bun:test";
import { requireAbsolute, sanitizeFileName } from "./download";

describe("requireAbsolute (absolute-path validation)", () => {
  test("accepts an absolute path and returns it", () => {
    expect(requireAbsolute("/tmp/out.csv", "outPath")).toBe("/tmp/out.csv");
  });

  test("rejects a relative path", () => {
    expect(() => requireAbsolute("./out.csv", "outPath")).toThrow(/absolute path/);
  });

  test("rejects empty / non-string with the label", () => {
    expect(() => requireAbsolute("", "destDir")).toThrow(/destDir/);
    expect(() => requireAbsolute(undefined, "destDir")).toThrow(/destDir/);
  });
});

describe("sanitizeFileName", () => {
  test("strips directory components and separators", () => {
    expect(sanitizeFileName("/a/b/c.pdf")).toBe("c.pdf");
    expect(sanitizeFileName("weird/../name")).toBe("name");
  });

  test("falls back to 'download' for empty names", () => {
    expect(sanitizeFileName("")).toBe("download");
  });
});
