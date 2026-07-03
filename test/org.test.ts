import { test, expect } from "bun:test";
import { resolveOrgSelector, type OrgEntry } from "../src/commands/org";

const ORGS: OrgEntry[] = [
  { id: "org_alpha", name: "Alpha Corp", role: "admin" },
  { id: "org_beta", name: "Beta LLC", role: "member" },
  { id: "org_beta2", name: "Beta Partners", role: "member" },
];

test("resolveOrgSelector: exact id resolves", () => {
  const r = resolveOrgSelector(ORGS, "org_beta");
  expect(r.org?.id).toBe("org_beta");
});

test("resolveOrgSelector: unique exact name resolves (case-insensitive)", () => {
  const r = resolveOrgSelector(ORGS, "alpha corp");
  expect(r.org?.id).toBe("org_alpha");
});

test("resolveOrgSelector: unique substring resolves", () => {
  const r = resolveOrgSelector(ORGS, "Alpha");
  expect(r.org?.id).toBe("org_alpha");
});

test("resolveOrgSelector: ambiguous substring lists matches", () => {
  const r = resolveOrgSelector(ORGS, "Beta");
  expect(r.org).toBeUndefined();
  expect(r.ambiguous?.map((o) => o.id).sort()).toEqual(["org_beta", "org_beta2"]);
});

test("resolveOrgSelector: exact name wins over substring ambiguity", () => {
  // "Beta LLC" is an exact name even though "Beta" alone is ambiguous.
  const r = resolveOrgSelector(ORGS, "Beta LLC");
  expect(r.org?.id).toBe("org_beta");
});

test("resolveOrgSelector: no match reports notFound", () => {
  const r = resolveOrgSelector(ORGS, "Gamma");
  expect(r.notFound).toBe(true);
  expect(r.org).toBeUndefined();
});

test("resolveOrgSelector: id match beats a colliding name", () => {
  const orgs: OrgEntry[] = [
    { id: "org_x", name: "shared", role: "member" },
    { id: "shared", name: "Other", role: "member" },
  ];
  const r = resolveOrgSelector(orgs, "shared");
  expect(r.org?.id).toBe("shared"); // exact id wins
});
