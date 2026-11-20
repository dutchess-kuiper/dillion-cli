import { fetchOrExit } from "../api";
import { getConfig } from "../config";

export async function healthCommand() {
  const { baseUrl } = await getConfig();

  const res = await fetchOrExit(`${baseUrl}/health`, { signal: AbortSignal.timeout(15_000) });
  const data = await res.json();

  console.log(`Status: ${data.status}`);
  console.log(`Server: ${baseUrl}`);
  console.log(`Time:   ${data.timestamp}`);
}
