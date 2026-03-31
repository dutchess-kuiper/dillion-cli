import { saveConfig, CONFIG_DIR } from "../config";
import { mkdirSync } from "fs";

export async function authCommand(args: string[]) {
  const apiKey = args[0];
  const baseUrl = args.find((a) => a.startsWith("--url="))?.split("=")[1];

  if (!apiKey || apiKey.startsWith("--")) {
    console.error("Usage: dillion auth <api-key> [--url=https://...]");
    process.exit(1);
  }

  const server = baseUrl || "https://bastion.dillion.ai";

  // Validate key by hitting an authed endpoint
  const res = await fetch(`${server}/jobs/list`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ projectId: "00000000-0000-0000-0000-000000000000", limit: 1 }),
  }).catch(() => null);

  if (!res) {
    console.error("Server unreachable.");
    process.exit(1);
  }
  if (res.status === 401 || res.status === 403) {
    console.error("Invalid API key.");
    process.exit(1);
  }

  // Ensure config dir exists
  mkdirSync(CONFIG_DIR, { recursive: true });

  await saveConfig({ apiKey, baseUrl: server });

  console.log("Authenticated successfully.");
  if (baseUrl) console.log(`Server: ${server}`);
}
