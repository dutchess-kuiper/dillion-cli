import { test, expect, mock, beforeAll, afterAll } from "bun:test";
import { mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { setOrgOverride } from "../src/orgContext";

// Stub config so the helpers never read the real ~/.config/dillion/config.json
// (and never process.exit when it is absent, e.g. on CI).
mock.module("../src/config", () => ({
  getConfig: async () => ({ apiKey: "test-key", baseUrl: "http://bastion.test" }),
  loadConfig: async () => ({ apiKey: "test-key", baseUrl: "http://bastion.test" }),
}));

// api.ts is imported dynamically AFTER the mock is registered.
const { buildHeaders, api, apiUpload, apiUploadMultipart, apiDownloadToFile } = await import(
  "../src/api"
);

const DIR = join(tmpdir(), "dillion-cli-test");
const realFetch = globalThis.fetch;
let calls: { url: string; init: any }[] = [];

function installFetch() {
  calls = [];
  globalThis.fetch = (async (url: any, init?: any) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as any;
}

function headers(): Record<string, string> {
  return (calls[0]?.init?.headers ?? {}) as Record<string, string>;
}

beforeAll(() => mkdirSync(DIR, { recursive: true }));
afterAll(() => {
  globalThis.fetch = realFetch;
  setOrgOverride(undefined);
});

// --- buildHeaders (pure) ---

test("buildHeaders: omits org header when none resolved", () => {
  setOrgOverride(undefined);
  const h = buildHeaders("k");
  expect(h.Authorization).toBe("Bearer k");
  expect(h["X-Dillion-Org-Id"]).toBeUndefined();
});

test("buildHeaders: includes org header when resolved", () => {
  setOrgOverride("org_z");
  expect(buildHeaders("k")["X-Dillion-Org-Id"]).toBe("org_z");
  setOrgOverride(undefined);
});

test("buildHeaders: never hard-codes Content-Type; passes it through extra", () => {
  setOrgOverride(undefined);
  expect(buildHeaders("k")["Content-Type"]).toBeUndefined();
  expect(buildHeaders("k", { "Content-Type": "application/json" })["Content-Type"]).toBe(
    "application/json"
  );
});

// --- all four helpers route through buildHeaders ---

test("api() sends org header and JSON content-type", async () => {
  installFetch();
  setOrgOverride("org_api");
  await api("/orgs");
  expect(headers()["X-Dillion-Org-Id"]).toBe("org_api");
  expect(headers()["Content-Type"]).toBe("application/json");
  expect(headers().Authorization).toBe("Bearer test-key");
  setOrgOverride(undefined);
});

test("api() omits org header when none resolved", async () => {
  installFetch();
  setOrgOverride(undefined);
  await api("/orgs");
  expect(headers()["X-Dillion-Org-Id"]).toBeUndefined();
});

test("apiUpload() sends org header and no Content-Type", async () => {
  installFetch();
  setOrgOverride("org_up");
  const f = join(DIR, "upload.txt");
  await Bun.write(f, "hello");
  await apiUpload(f, "proj1");
  expect(headers()["X-Dillion-Org-Id"]).toBe("org_up");
  expect(headers()["Content-Type"]).toBeUndefined();
  setOrgOverride(undefined);
});

test("apiUploadMultipart() sends org header and no Content-Type", async () => {
  installFetch();
  setOrgOverride("org_mp");
  await apiUploadMultipart("/x", { fileBlob: new Blob(["hi"]), fileName: "a.txt" });
  expect(headers()["X-Dillion-Org-Id"]).toBe("org_mp");
  expect(headers()["Content-Type"]).toBeUndefined();
  setOrgOverride(undefined);
});

test("apiDownloadToFile() sends org header and no Content-Type", async () => {
  installFetch();
  setOrgOverride("org_dl");
  await apiDownloadToFile("/x", join(DIR, "out.bin"));
  expect(headers()["X-Dillion-Org-Id"]).toBe("org_dl");
  expect(headers()["Content-Type"]).toBeUndefined();
  setOrgOverride(undefined);
});
