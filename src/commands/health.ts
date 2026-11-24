import { failWithApiError, fetchOrExit } from "../api";
import { getConfig } from "../config";

export async function healthCommand() {
  const { baseUrl } = await getConfig();

  const res = await fetchOrExit(`${baseUrl}/health`, { signal: AbortSignal.timeout(15_000) });
  // A 5xx from the server or a proxy is not healthy: report it and exit 1.
  if (!res.ok) failWithApiError(res.status, await res.text());
  let data: { status?: unknown; timestamp?: unknown } | null = null;
  try {
    data = await res.json();
  } catch {
    // fall through
  }
  if (!data || typeof data !== "object" || data.status === undefined) {
    console.error(`${baseUrl}/health didn't return a health report. Is this a Dillion server? (dillion auth status)`);
    process.exit(1);
  }

  console.log(`Status: ${data.status}`);
  console.log(`Server: ${baseUrl}`);
  console.log(`Time:   ${data.timestamp}`);
}
