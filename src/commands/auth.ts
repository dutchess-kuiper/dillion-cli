import { saveConfig, CONFIG_DIR } from "../config";
import { mkdirSync } from "fs";

export async function authCommand(args: string[]) {
  const apiKey = args[0];
  const baseUrl = args.find((a) => a.startsWith("--url="))?.split("=")[1];

  if (!apiKey || apiKey.startsWith("--")) {
    console.error("Usage: dillion auth <api-key> [--url=https://...]");
    process.exit(1);
  }

  // Ensure config dir exists
  mkdirSync(CONFIG_DIR, { recursive: true });

  await saveConfig({
    apiKey,
    baseUrl: baseUrl || "https://bastion.dillion.ai",
  });

  console.log("Authenticated successfully.");
  if (baseUrl) console.log(`Server: ${baseUrl}`);
}
