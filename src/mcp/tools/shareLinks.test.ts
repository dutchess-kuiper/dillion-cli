import { describe, expect, test } from "bun:test";
import { buildShareLinkItems, buildShareLinkUpdateBody } from "./shareLinks";

describe("buildShareLinkItems", () => {
  test("assigns sort_order by index and includes optional fields", () => {
    const items = buildShareLinkItems([
      { reportId: "r1", displayLabel: "FDD", pinnedVersion: 3 },
      { reportId: "r2" },
    ]);
    expect(items).toEqual([
      { report_id: "r1", sort_order: 0, display_label: "FDD", pinned_version: 3 },
      { report_id: "r2", sort_order: 1 },
    ]);
  });
});

describe("buildShareLinkUpdateBody (share-link mutual exclusions)", () => {
  test("rejects password + removePassword", () => {
    expect(() => buildShareLinkUpdateBody({ password: "longenough", removePassword: true })).toThrow(
      /password OR removePassword/,
    );
  });

  test("rejects expiresInDays + clearExpiry", () => {
    expect(() => buildShareLinkUpdateBody({ expiresInDays: 7, clearExpiry: true })).toThrow(
      /expiresInDays OR clearExpiry/,
    );
  });

  test("rejects allowedEmailDomains + clearDomains", () => {
    expect(() => buildShareLinkUpdateBody({ allowedEmailDomains: ["a.com"], clearDomains: true })).toThrow(
      /allowedEmailDomains OR clearDomains/,
    );
  });

  test("rejects allowedEmails + clearEmails", () => {
    expect(() => buildShareLinkUpdateBody({ allowedEmails: ["a@a.com"], clearEmails: true })).toThrow(
      /allowedEmails OR clearEmails/,
    );
  });

  test("rejects an empty reports array", () => {
    expect(() => buildShareLinkUpdateBody({ reports: [] })).toThrow(/at least one item/);
  });

  test("rejects an empty change set", () => {
    expect(() => buildShareLinkUpdateBody({})).toThrow(/No changes/);
  });

  test("maps fields to snake_case and builds items", () => {
    const body = buildShareLinkUpdateBody({
      title: "New",
      clearDomains: true,
      reports: [{ reportId: "r1" }],
    });
    expect(body.title).toBe("New");
    expect(body.clear_allowed_email_domains).toBe(true);
    expect(body.items).toEqual([{ report_id: "r1", sort_order: 0 }]);
  });
});
