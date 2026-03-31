import { getConfig } from "../config";

export async function healthCommand() {
  const { baseUrl } = await getConfig();

  const res = await fetch(`${baseUrl}/health`);
  const data = await res.json();

  console.log(`Status: ${data.status}`);
  console.log(`Server: ${baseUrl}`);
  console.log(`Time:   ${data.timestamp}`);
}
