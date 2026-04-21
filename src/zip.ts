/**
 * Minimal ZIP writer — STORE method only (no compression).
 *
 * Designed for packaging a Vite `dist/` directory for upload to bastion. The
 * server-side already gzip-compresses across the wire, so we trade compression
 * for zero dependencies. Total bundle size for a real Vite build is small
 * (~few hundred KB) so this is fine.
 */

import { readdir, stat } from "fs/promises";
import { join, posix, relative, sep } from "path";

const SIG_LFH = 0x04034b50;
const SIG_CDFH = 0x02014b50;
const SIG_EOCD = 0x06054b50;

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(d: Date): number {
  const seconds = Math.floor(d.getSeconds() / 2);
  return ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | (seconds & 0x1f);
}

function dosDate(d: Date): number {
  const year = Math.max(1980, d.getFullYear()) - 1980;
  return ((year & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
}

interface Entry {
  name: string;
  data: Uint8Array;
  crc: number;
  time: number;
  date: number;
  /** Offset in the archive of this entry's local header. */
  localOffset: number;
}

export interface ZipFileInput {
  /** POSIX-style path inside the archive (no leading slash). */
  path: string;
  data: Uint8Array;
  /** Optional mtime (defaults to now). */
  mtime?: Date;
}

/** Build an in-memory ZIP archive (STORE method) from a list of files. */
export function buildZip(inputs: ZipFileInput[]): Uint8Array {
  const now = new Date();
  let totalSize = 0;
  const entries: Entry[] = [];

  // Pre-compute sizes for local headers + central directory
  for (const input of inputs) {
    const nameBytes = new TextEncoder().encode(input.path);
    const time = dosTime(input.mtime ?? now);
    const date = dosDate(input.mtime ?? now);
    const crc = crc32(input.data);
    entries.push({
      name: input.path,
      data: input.data,
      crc,
      time,
      date,
      localOffset: totalSize,
    });
    // local file header (30 bytes) + name + data
    totalSize += 30 + nameBytes.length + input.data.length;
  }

  const localBytes = new Uint8Array(totalSize);
  const localView = new DataView(localBytes.buffer);
  let cursor = 0;
  for (const e of entries) {
    const nameBytes = new TextEncoder().encode(e.name);
    localView.setUint32(cursor, SIG_LFH, true); cursor += 4;
    localView.setUint16(cursor, 20, true); cursor += 2;       // version needed
    localView.setUint16(cursor, 0, true); cursor += 2;        // gp flag
    localView.setUint16(cursor, 0, true); cursor += 2;        // method = store
    localView.setUint16(cursor, e.time, true); cursor += 2;
    localView.setUint16(cursor, e.date, true); cursor += 2;
    localView.setUint32(cursor, e.crc, true); cursor += 4;
    localView.setUint32(cursor, e.data.length, true); cursor += 4; // compressed
    localView.setUint32(cursor, e.data.length, true); cursor += 4; // uncompressed
    localView.setUint16(cursor, nameBytes.length, true); cursor += 2;
    localView.setUint16(cursor, 0, true); cursor += 2;        // extra len
    localBytes.set(nameBytes, cursor); cursor += nameBytes.length;
    localBytes.set(e.data, cursor); cursor += e.data.length;
  }

  // Central directory headers
  let cdSize = 0;
  for (const e of entries) {
    cdSize += 46 + new TextEncoder().encode(e.name).length;
  }
  const cdBytes = new Uint8Array(cdSize);
  const cdView = new DataView(cdBytes.buffer);
  cursor = 0;
  for (const e of entries) {
    const nameBytes = new TextEncoder().encode(e.name);
    cdView.setUint32(cursor, SIG_CDFH, true); cursor += 4;
    cdView.setUint16(cursor, 20, true); cursor += 2;          // version made by
    cdView.setUint16(cursor, 20, true); cursor += 2;          // version needed
    cdView.setUint16(cursor, 0, true); cursor += 2;           // gp flag
    cdView.setUint16(cursor, 0, true); cursor += 2;           // method
    cdView.setUint16(cursor, e.time, true); cursor += 2;
    cdView.setUint16(cursor, e.date, true); cursor += 2;
    cdView.setUint32(cursor, e.crc, true); cursor += 4;
    cdView.setUint32(cursor, e.data.length, true); cursor += 4;
    cdView.setUint32(cursor, e.data.length, true); cursor += 4;
    cdView.setUint16(cursor, nameBytes.length, true); cursor += 2;
    cdView.setUint16(cursor, 0, true); cursor += 2;           // extra len
    cdView.setUint16(cursor, 0, true); cursor += 2;           // comment len
    cdView.setUint16(cursor, 0, true); cursor += 2;           // disk #
    cdView.setUint16(cursor, 0, true); cursor += 2;           // internal attrs
    cdView.setUint32(cursor, 0, true); cursor += 4;           // external attrs
    cdView.setUint32(cursor, e.localOffset, true); cursor += 4;
    cdBytes.set(nameBytes, cursor); cursor += nameBytes.length;
  }

  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, SIG_EOCD, true);
  eocdView.setUint16(4, 0, true);                              // disk #
  eocdView.setUint16(6, 0, true);                              // disk start
  eocdView.setUint16(8, entries.length, true);                 // # entries this disk
  eocdView.setUint16(10, entries.length, true);                // # total entries
  eocdView.setUint32(12, cdSize, true);
  eocdView.setUint32(16, totalSize, true);                     // CD offset
  eocdView.setUint16(20, 0, true);                             // comment len

  const out = new Uint8Array(localBytes.length + cdBytes.length + eocd.length);
  out.set(localBytes, 0);
  out.set(cdBytes, localBytes.length);
  out.set(eocd, localBytes.length + cdBytes.length);
  return out;
}

/** Recursively gather all files in `dir`, returning `ZipFileInput`s. */
export async function walkDirToZipInputs(
  dir: string,
  options: { exclude?: (relPath: string) => boolean } = {}
): Promise<ZipFileInput[]> {
  const out: ZipFileInput[] = [];
  await walk(dir, dir, out, options.exclude);
  return out;
}

async function walk(
  root: string,
  current: string,
  out: ZipFileInput[],
  exclude?: (relPath: string) => boolean
): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(current, entry.name);
    const rel = relative(root, full).split(sep).join(posix.sep);
    if (exclude && exclude(rel)) continue;
    if (entry.isDirectory()) {
      await walk(root, full, out, exclude);
    } else if (entry.isFile()) {
      const data = await Bun.file(full).bytes();
      const st = await stat(full);
      out.push({ path: rel, data, mtime: st.mtime ?? undefined });
    }
  }
}
