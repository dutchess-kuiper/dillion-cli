import { getConfig } from "./config";

let _config: { apiKey: string; baseUrl: string } | null = null;

async function config() {
  if (!_config) _config = await getConfig();
  return _config;
}

export async function api(
  path: string,
  options: {
    method?: string;
    body?: any;
    raw?: boolean;
  } = {}
): Promise<any> {
  const { apiKey, baseUrl } = await config();
  const { method = "GET", body, raw = false } = options;

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.text();
    let msg: string;
    try {
      msg = JSON.parse(err).error;
    } catch {
      msg = err;
    }
    console.error(`Error ${res.status}: ${msg}`);
    process.exit(1);
  }

  if (raw) return res;
  return res.json();
}
