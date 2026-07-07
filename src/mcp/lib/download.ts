import { mkdir } from "fs/promises";
import { basename, dirname, isAbsolute, join } from "path";

/** Reduce any user/server-supplied name to a safe basename. */
export function sanitizeFileName(name: string): string {
  const base = basename(String(name ?? "")).replace(/[/\\]/g, "_").trim();
  return base || "download";
}

/**
 * Require an absolute path. MCP hosts often launch the server with cwd `/`, so relative
 * paths are ambiguous — file-writing/reading tools demand absolute paths and echo the
 * resolved location back.
 */
export function requireAbsolute(p: unknown, label: string): string {
  if (typeof p !== "string" || p.trim() === "" || !isAbsolute(p)) {
    throw new Error(
      `${label} must be an absolute path (got: ${p == null || p === "" ? "(empty)" : String(p)}).`,
    );
  }
  return p;
}

/** Write a buffer into `dir/<sanitized fileName>`, creating `dir`. Returns the resolved path. */
export async function saveBufferToDir(
  dir: string,
  fileName: string,
  data: Uint8Array | Buffer,
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const target = join(dir, sanitizeFileName(fileName));
  await Bun.write(target, data);
  return target;
}

/** Write data to an exact file path, creating parent dirs. Returns the path. */
export async function saveToPath(
  outPath: string,
  data: Uint8Array | Buffer | string,
): Promise<string> {
  await mkdir(dirname(outPath), { recursive: true });
  await Bun.write(outPath, data);
  return outPath;
}
