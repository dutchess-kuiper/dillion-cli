import { test, expect } from "bun:test";
import {
  resolveOrgOverride,
  looksLikeOrgId,
  setOrgOverride,
  getOrgOverride,
  classifyOrgIdFlag,
} from "../src/orgContext";

test("resolveOrgOverride: flag takes precedence over config", () => {
  expect(resolveOrgOverride("org_flag", "org_config")).toBe("org_flag");
});

test("resolveOrgOverride: falls back to config when no flag", () => {
  expect(resolveOrgOverride(undefined, "org_config")).toBe("org_config");
  expect(resolveOrgOverride("", "org_config")).toBe("org_config");
  expect(resolveOrgOverride("   ", "org_config")).toBe("org_config");
});

test("resolveOrgOverride: undefined when neither present", () => {
  expect(resolveOrgOverride(undefined, undefined)).toBeUndefined();
  expect(resolveOrgOverride("", "")).toBeUndefined();
  expect(resolveOrgOverride("", "   ")).toBeUndefined();
});

test("resolveOrgOverride: trims the winning value", () => {
  expect(resolveOrgOverride("  org_flag  ", undefined)).toBe("org_flag");
  expect(resolveOrgOverride(undefined, "  org_config  ")).toBe("org_config");
});

test("looksLikeOrgId: true only for org_ prefix", () => {
  expect(looksLikeOrgId("org_abc123")).toBe(true);
  expect(looksLikeOrgId("  org_abc123  ")).toBe(true);
  expect(looksLikeOrgId("Acme Corp")).toBe(false);
  expect(looksLikeOrgId("acme")).toBe(false);
  expect(looksLikeOrgId("")).toBe(false);
});

test("classifyOrgIdFlag: absent flag is distinct from present-but-empty", () => {
  // Absent: stripOrgIdFlag returns undefined -> falls back to the saved org downstream.
  expect(classifyOrgIdFlag(undefined)).toEqual({ kind: "absent" });
  // Present but empty: `--org-id`, `--org-id=`, `--org-id --json`, or whitespace -> usage error.
  expect(classifyOrgIdFlag("")).toEqual({ kind: "empty" });
  expect(classifyOrgIdFlag("   ")).toEqual({ kind: "empty" });
});

test("classifyOrgIdFlag: a real value is trimmed and returned", () => {
  expect(classifyOrgIdFlag("org_x")).toEqual({ kind: "value", value: "org_x" });
  expect(classifyOrgIdFlag("  org_x  ")).toEqual({ kind: "value", value: "org_x" });
});

test("setOrgOverride/getOrgOverride: roundtrip and trim, empty clears", () => {
  setOrgOverride("org_x");
  expect(getOrgOverride()).toBe("org_x");
  setOrgOverride("  org_y  ");
  expect(getOrgOverride()).toBe("org_y");
  setOrgOverride("");
  expect(getOrgOverride()).toBeUndefined();
  setOrgOverride(undefined);
  expect(getOrgOverride()).toBeUndefined();
});
