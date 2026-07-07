import { describe, expect, test } from "bun:test";
import { buildShareUpdateBody } from "./shares";

describe("buildShareUpdateBody (report share mutual exclusions)", () => {
  test("rejects password + removePassword", () => {
    expect(() => buildShareUpdateBody({ password: "longenough", removePassword: true })).toThrow(
      /password OR removePassword/,
    );
  });

  test("rejects expiresInDays + clearExpiry", () => {
    expect(() => buildShareUpdateBody({ expiresInDays: 30, clearExpiry: true })).toThrow(
      /expiresInDays OR clearExpiry/,
    );
  });

  test("rejects pinnedVersion + pinToLatest", () => {
    expect(() => buildShareUpdateBody({ pinnedVersion: 2, pinToLatest: true })).toThrow(
      /pinnedVersion OR pinToLatest/,
    );
  });

  test("rejects an empty change set", () => {
    expect(() => buildShareUpdateBody({})).toThrow(/No changes/);
  });

  test("maps fields to snake_case", () => {
    expect(
      buildShareUpdateBody({ removePassword: true, clearExpiry: true, pinToLatest: true, allowCitationExcerpts: false }),
    ).toEqual({
      remove_password: true,
      clear_expiry: true,
      pin_to_latest: true,
      allow_citation_excerpts: false,
    });
    expect(buildShareUpdateBody({ pinnedVersion: 3 })).toEqual({ pinned_version: 3 });
  });
});
