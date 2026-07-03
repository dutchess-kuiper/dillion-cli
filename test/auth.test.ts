import { test, expect } from "bun:test";
import { buildAuthOutcome, parseOrgsResponse } from "../src/commands/auth";

const A = { id: "org_a", name: "Alpha", role: "admin" };
const B = { id: "org_b", name: "Beta", role: "member" };

test("buildAuthOutcome: single org auto-selects and reports it", () => {
  const { config, lines } = buildAuthOutcome("k", "https://s", [A], null, false);
  expect(config.orgId).toBe("org_a");
  expect(config.apiKey).toBe("k");
  expect(config.baseUrl).toBe("https://s");
  expect(lines).toContain("Organization: Alpha");
});

test("buildAuthOutcome: multi org does not auto-select, prints hint", () => {
  const { config, lines } = buildAuthOutcome("k", "https://s", [A, B], null, false);
  expect(config.orgId).toBeUndefined();
  expect(lines.some((l) => l.includes("You belong to 2 organizations"))).toBe(true);
  expect(lines.some((l) => l.includes("dillion org use"))).toBe(true);
});

test("buildAuthOutcome: multi org keeps a still-valid prior selection", () => {
  const prev = { apiKey: "k", baseUrl: "https://s", orgId: "org_b" };
  const { config } = buildAuthOutcome("k", "https://s", [A, B], prev, false);
  expect(config.orgId).toBe("org_b");
});

test("buildAuthOutcome: multi org drops a prior selection no longer a member", () => {
  const prev = { apiKey: "k", baseUrl: "https://s", orgId: "org_gone" };
  const { config } = buildAuthOutcome("k", "https://s", [A, B], prev, false);
  expect(config.orgId).toBeUndefined();
});

test("buildAuthOutcome: zero org warns but still saves creds", () => {
  const { config, lines } = buildAuthOutcome("k", "https://s", [], null, false);
  expect(config.orgId).toBeUndefined();
  expect(config.apiKey).toBe("k");
  expect(lines.some((l) => l.includes("no organization"))).toBe(true);
});

test("buildAuthOutcome: preserves projectId and reports explicit server", () => {
  const prev = { apiKey: "old", baseUrl: "https://old", projectId: "p1" };
  const { config, lines } = buildAuthOutcome("k", "https://s", [A], prev, true);
  expect(config.projectId).toBe("p1");
  expect(lines).toContain("Server: https://s");
});

// parseOrgsResponse: fail closed so a malformed 200 body never masquerades as "zero orgs"
// (which would save the key and print "you belong to no organization").

test("parseOrgsResponse: null (JSON parse failure) is unexpected, not zero orgs", () => {
  expect("unexpected" in parseOrgsResponse(null)).toBe(true);
});

test("parseOrgsResponse: object without an orgs array is unexpected", () => {
  expect("unexpected" in parseOrgsResponse({})).toBe(true);
  expect("unexpected" in parseOrgsResponse({ orgs: "nope" })).toBe(true);
  expect("unexpected" in parseOrgsResponse({ orgs: null })).toBe(true);
});

test("parseOrgsResponse: a genuine {orgs:[]} is treated as zero orgs", () => {
  const r = parseOrgsResponse({ orgs: [] });
  expect("unexpected" in r).toBe(false);
  expect((r as { orgs: unknown[] }).orgs).toEqual([]);
});

test("parseOrgsResponse: a populated list returns the entries", () => {
  const r = parseOrgsResponse({ orgs: [A, B] });
  expect((r as { orgs: typeof A[] }).orgs.map((o) => o.id)).toEqual(["org_a", "org_b"]);
});
