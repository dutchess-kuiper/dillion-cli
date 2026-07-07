/**
 * Obligations response handling. Bastion returns a CSV body on success but a JSON error
 * object (`{detail}` / `{error}`) on failure — with a 2xx status in some edge cases — so we
 * branch on content-type (and a JSON-shape fallback) BEFORE writing anything to disk.
 */

export type ObligationsBody =
  | { kind: "csv"; rowCount: number; columns: string[]; byteSize: number }
  | { kind: "error"; message: string };

/** Split one CSV line into fields, honoring double-quoted fields and `""` escapes. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

/** Column names (from the header row) + data row count + byte size for a CSV body. */
export function summarizeCsv(body: string): { rowCount: number; columns: string[]; byteSize: number } {
  const byteSize = Buffer.byteLength(body, "utf-8");
  const lines = body.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length === 0) return { rowCount: 0, columns: [], byteSize };
  const columns = parseCsvLine(lines[0]!);
  return { rowCount: Math.max(0, lines.length - 1), columns, byteSize };
}

/**
 * Classify an obligations response body. A JSON content-type (or a body that parses as a
 * JSON object/array) is treated as an error; everything else is treated as CSV.
 */
export function parseObligationsBody(body: string, contentType?: string): ObligationsBody {
  const ct = (contentType ?? "").toLowerCase();
  const trimmed = body.trimStart();
  const looksJson = ct.includes("json") || trimmed.startsWith("{") || trimmed.startsWith("[");
  if (looksJson) {
    try {
      const j = JSON.parse(body) as { detail?: unknown; error?: unknown };
      const raw = j.detail ?? j.error ?? j;
      const message = typeof raw === "string" ? raw : JSON.stringify(raw);
      return { kind: "error", message };
    } catch {
      return { kind: "error", message: body.slice(0, 500) };
    }
  }
  return { kind: "csv", ...summarizeCsv(body) };
}
