import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, test } from "bun:test";
import { setApiFailureMode } from "../api";
import { setApiKey, setBaseUrl, setDefaultProjectId, __resetContextForTests } from "./lib/context";
import type { Toolset } from "./lib/register";
import { createDillionMcpServer } from "./server";

const CORE_TOOLS = [
  "search",
  "agent_ask",
  "files_search",
  "jobs_list",
  "jobs_get",
  "obligations_export",
  "artifacts_publish",
  "artifacts_share_create",
].sort();

async function connectClient(toolset: Toolset): Promise<Client> {
  const server = createDillionMcpServer(toolset);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

afterEach(() => {
  __resetContextForTests();
  // Undo the global mutations the error-path test makes, so state never leaks between tests.
  setApiFailureMode("exit");
  delete process.env.DILLION_API_KEY;
  delete process.env.DILLION_BASE_URL;
});

describe("createDillionMcpServer — handshake + tool registration", () => {
  test("full toolset exposes exactly 30 tools with serializable schemas", async () => {
    const client = await connectClient("full");
    const { tools } = await client.listTools();
    expect(tools.length).toBe(30);
    for (const t of tools) {
      expect(typeof t.name).toBe("string");
      expect(typeof t.description).toBe("string");
      // JSON Schema must serialize without throwing.
      expect(() => JSON.stringify(t.inputSchema)).not.toThrow();
    }
    await client.close();
  });

  test("core toolset exposes exactly the 8 pipeline tools", async () => {
    const client = await connectClient("core");
    const { tools } = await client.listTools();
    expect(tools.length).toBe(8);
    expect(tools.map((t) => t.name).sort()).toEqual(CORE_TOOLS);
    await client.close();
  });

  test("error-path call against an unroutable base URL returns isError, process survives", async () => {
    // Configure the reused CLI plumbing to throw (caught → clean tool errors) and point at
    // an unroutable server.
    setApiFailureMode("throw");
    process.env.DILLION_API_KEY = "dil_dummy";
    process.env.DILLION_BASE_URL = "http://127.0.0.1:9";
    setBaseUrl("http://127.0.0.1:9");
    setApiKey("dil_dummy");
    setDefaultProjectId("proj_test");

    const client = await connectClient("full");

    // health: direct fetch to an unroutable URL → clean isError.
    const health = await client.callTool({ name: "health", arguments: {} });
    expect(health.isError).toBe(true);

    // search: goes through the api() throw funnel → connection error caught → clean isError.
    const search = await client.callTool({ name: "search", arguments: { query: "test" } });
    expect(search.isError).toBe(true);

    // Process is still alive: another request succeeds.
    const { tools } = await client.listTools();
    expect(tools.length).toBe(30);

    await client.close();
  });
});
