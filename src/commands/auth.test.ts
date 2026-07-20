import { describe, expect, test } from "bun:test";
import {
  buildAuthStatusReport,
  looksLikeApiKey,
  maskApiKey,
  type KeyCheck,
} from "./auth";
import type { Config } from "../config";
import type { OrgEntry } from "./org";

const ORGS: OrgEntry[] = [
  { id: "org_acme", name: "Acme Capital", role: "admin" },
  { id: "org_beta", name: "Beta LLC", role: "member" },
];

const CONFIG: Config = {
  apiKey: "dil_live_abcdef123456789wxyz",
  baseUrl: "https://bastion.dillion.ai",
  orgId: "org_acme",
  projectId: "proj_123",
};

describe("looksLikeApiKey", () => {
  test("accepts dil_ keys", () => {
    expect(looksLikeApiKey("dil_live_abc")).toBe(true);
  });
  test("rejects mistyped subcommands and stray words", () => {
    expect(looksLikeApiKey("status")).toBe(false);
    expect(looksLikeApiKey("show")).toBe(false);
    expect(looksLikeApiKey("logout")).toBe(false);
  });
});

describe("maskApiKey", () => {
  test("shows only the last four characters", () => {
    expect(maskApiKey("dil_live_abcdef123456789wxyz")).toBe("****wxyz");
  });
  test("does not leak length (fixed mask regardless of key size)", () => {
    expect(maskApiKey("dil_short").length).toBe(maskApiKey("dil_a_very_long_key_here").length);
  });
  test("handles empty and very short keys", () => {
    expect(maskApiKey("")).toBe("(none)");
    expect(maskApiKey("ab")).toBe("****ab");
  });
});

describe("buildAuthStatusReport", () => {
  test("no config -> unauthenticated, exit 1", () => {
    const r = buildAuthStatusReport(null, null);
    expect(r.exitCode).toBe(1);
    expect(r.data.authenticated).toBe(false);
    expect(r.data.keyStatus).toBe("unauthenticated");
    expect(r.lines.join("\n")).toContain("Not authenticated");
  });

  test("valid key resolves the org name from memberships and exits 0", () => {
    const check: KeyCheck = { kind: "valid", orgs: ORGS };
    const r = buildAuthStatusReport(CONFIG, check);
    expect(r.exitCode).toBe(0);
    expect(r.data.keyStatus).toBe("valid");
    expect(r.data.orgName).toBe("Acme Capital");
    const text = r.lines.join("\n");
    expect(text).toContain("Org:      Acme Capital (org_acme)");
    expect(text).toContain("API key:  ****wxyz");
    expect(text).toContain("Project:  proj_123");
    expect(text).toContain("Key status: valid");
    // The raw key must never appear in output.
    expect(text).not.toContain(CONFIG.apiKey);
  });

  test("invalid key -> exit 1 and re-auth hint", () => {
    const r = buildAuthStatusReport(CONFIG, { kind: "invalid" });
    expect(r.exitCode).toBe(1);
    expect(r.data.keyStatus).toBe("invalid");
    expect(r.lines.join("\n")).toContain("INVALID");
  });

  test("unreachable server -> unverified but exit 0 (local config intact)", () => {
    const r = buildAuthStatusReport(CONFIG, { kind: "unreachable" });
    expect(r.exitCode).toBe(0);
    expect(r.data.keyStatus).toBe("unverified");
    expect(r.lines.join("\n")).toContain("server unreachable");
  });

  test("server error -> unverified, exit 0, includes status code", () => {
    const r = buildAuthStatusReport(CONFIG, { kind: "server-error", status: 503 });
    expect(r.exitCode).toBe(0);
    expect(r.data.keyStatus).toBe("unverified");
    expect(r.lines.join("\n")).toContain("503");
  });

  test("unexpected response -> unverified, exit 0", () => {
    const r = buildAuthStatusReport(CONFIG, { kind: "unexpected" });
    expect(r.exitCode).toBe(0);
    expect(r.data.keyStatus).toBe("unverified");
    expect(r.lines.join("\n")).toContain("unexpected server response");
  });

  test("stale orgId not in memberships -> shows id, no resolved name", () => {
    const cfg: Config = { ...CONFIG, orgId: "org_gone" };
    const r = buildAuthStatusReport(cfg, { kind: "valid", orgs: ORGS });
    expect(r.data.orgName).toBeNull();
    expect(r.lines.join("\n")).toContain("Org:      org_gone");
  });

  test("no org selected and no project -> (none) placeholders", () => {
    const cfg: Config = { apiKey: "dil_k_1234", baseUrl: "https://x" };
    const r = buildAuthStatusReport(cfg, { kind: "valid", orgs: ORGS });
    const text = r.lines.join("\n");
    expect(text).toContain("Org:      (none selected)");
    expect(text).toContain("Project:  (none)");
    expect(r.data.orgId).toBeNull();
    expect(r.data.projectId).toBeNull();
  });

  test("org name is only resolved on a valid check, never on unreachable", () => {
    const r = buildAuthStatusReport(CONFIG, { kind: "unreachable" });
    expect(r.data.orgName).toBeNull();
    // Falls back to the bare id since we couldn't fetch memberships.
    expect(r.lines.join("\n")).toContain("Org:      org_acme");
  });
});
