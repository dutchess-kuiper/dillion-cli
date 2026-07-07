import { describe, expect, test } from "bun:test";
import { excludeReportSourcePath } from "../../commands/artifacts";
import {
  MAX_COMBINED_REPORT_UPLOAD_BYTES,
  MAX_REPORT_ZIP_BYTES,
  checkPublishSizes,
} from "./publish";

describe("checkPublishSizes", () => {
  test("passes when both caps are satisfied", () => {
    expect(checkPublishSizes(10 * 1024 * 1024, 5 * 1024 * 1024)).toBeNull();
  });

  test("rejects when dist.zip exceeds the 100MiB cap", () => {
    const msg = checkPublishSizes(MAX_REPORT_ZIP_BYTES + 1, 0);
    expect(msg).not.toBeNull();
    expect(msg).toContain("MAX_REPORT_ZIP_BYTES");
  });

  test("rejects when dist+raw exceeds the 128MiB combined cap", () => {
    // dist alone under 100MiB, but combined over 128MiB.
    const dist = 90 * 1024 * 1024;
    const raw = 40 * 1024 * 1024;
    expect(dist).toBeLessThanOrEqual(MAX_REPORT_ZIP_BYTES);
    expect(dist + raw).toBeGreaterThan(MAX_COMBINED_REPORT_UPLOAD_BYTES);
    const msg = checkPublishSizes(dist, raw);
    expect(msg).not.toBeNull();
    expect(msg).toContain("MAX_COMBINED_REPORT_UPLOAD_BYTES");
  });
});

describe("excludeReportSourcePath (source-zip exclusions)", () => {
  test("excludes node_modules, dist, .git, and secrets", () => {
    expect(excludeReportSourcePath("node_modules/react/index.js")).toBe(true);
    expect(excludeReportSourcePath("dist/index.html")).toBe(true);
    expect(excludeReportSourcePath(".git/config")).toBe(true);
    expect(excludeReportSourcePath(".env")).toBe(true);
    expect(excludeReportSourcePath(".env.local")).toBe(true);
    expect(excludeReportSourcePath("keys/id_rsa")).toBe(true);
  });

  test("keeps ordinary source files", () => {
    expect(excludeReportSourcePath("src/App.tsx")).toBe(false);
    expect(excludeReportSourcePath("package.json")).toBe(false);
    expect(excludeReportSourcePath("vite.config.ts")).toBe(false);
  });
});
