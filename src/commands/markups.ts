import { join, resolve } from "path";
import { api, apiDownloadToFile } from "../api";
import { parseFlags } from "../flags";

/**
 * `dillion artifacts markups …` — read and act on analyst markups (redlines)
 * on published research reports. Markups are created and submitted in the web
 * app; the CLI lists them, shows a thread, replies, resolves and reopens.
 * Drafts never reach the CLI (bastion forces include_drafts=false).
 */

export const MARKUPS_HELP = `
Usage: dillion artifacts markups <command> [options]

  list <report-id> [--version N] [--status open|resolved|all] [--author <user-id>|me] [--json]
                                List submitted markups (default: open, all versions)
  get <markup-id> [--save-ink <dir>] [--json]
                                Show a markup with its anchor and thread; --save-ink writes
                                the ink PNG crop to <dir>/<markup-id>.png
  reply <markup-id> "<text>"    Add a reply to a markup's thread
  resolve <markup-id> [--note "<text>"]
                                Mark a markup resolved (records who resolved it)
  reopen <markup-id> [--note "<text>"]
                                Reopen a resolved markup

--json prints the API's markup objects unchanged (quote, prefix/suffix context,
section, suggested replacement, ink reading, thread), e.g. to hand to an agent.
`.trim();

const LIST_STATUSES = ["open", "resolved", "all"] as const;
type ListStatus = (typeof LIST_STATUSES)[number];

export type MarkupReply = {
  id: string;
  author_name: string | null;
  event: "comment" | "resolved" | "reopened";
  body: string | null;
  created_at: string;
};

export type Markup = {
  id: string;
  version_number: number;
  kind: "highlight" | "suggestion" | "point" | "ink";
  status: "open" | "resolved";
  author_name: string | null;
  anchor: {
    section_id?: string;
    section_label?: string;
    quote?: string;
    prefix?: string;
    suffix?: string;
    figure_id?: string;
    figure_label?: string;
  };
  body: string | null;
  suggested_text: string | null;
  has_ink_png: boolean;
  ink_reading: string | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
  created_at: string;
  replies: MarkupReply[];
};

// ─── pure helpers ───────────────────────────────────────────────────────────

/**
 * Make text safe to print to a terminal: markup content is written by other
 * people, so control characters (ESC sequences, carriage returns, C1 codes)
 * and bidi overrides are shown as visible escapes instead of being
 * interpreted. Newlines are kept.
 */
export function terminalSafe(text: string): string {
  return text.replace(
    /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g,
    (ch) => `\\u{${ch.codePointAt(0)!.toString(16)}}`,
  );
}

/**
 * Flags a subcommand accepts (besides --help / -h). An unknown flag is an
 * error: `resolve --notes "…"` must not resolve while dropping the note.
 */
export function unknownFlags(
  flags: Record<string, string | true | undefined>,
  allowed: readonly string[],
): string[] {
  return Object.keys(flags).filter((k) => !allowed.includes(k) && k !== "help" && k !== "h");
}

function failOnUnknownFlags(
  flags: Record<string, string | true | undefined>,
  allowed: readonly string[],
  usage: string,
): void {
  const bad = unknownFlags(flags, allowed);
  if (bad.length === 0) return;
  console.error(`Unknown option${bad.length > 1 ? "s" : ""}: ${bad.map((f) => `--${f}`).join(", ")}`);
  console.error(usage);
  process.exit(1);
}

/** Build the list query string; returns an error message for a bad flag. */
export function buildMarkupListQuery(flags: Record<string, string | true | undefined>):
  | { ok: true; query: string }
  | { ok: false; error: string } {
  const params = new URLSearchParams();
  const status = flags.status === undefined ? "open" : flags.status;
  if (typeof status !== "string" || !LIST_STATUSES.includes(status as ListStatus)) {
    return { ok: false, error: "--status must be one of: open, resolved, all" };
  }
  params.set("status", status);
  const version = flags.version ?? flags.v;
  if (version !== undefined) {
    if (typeof version !== "string" || !/^[1-9]\d*$/.test(version.trim())) {
      return { ok: false, error: "--version must be a positive integer" };
    }
    params.set("version", version.trim());
  }
  if (flags.author !== undefined) {
    if (typeof flags.author !== "string" || !flags.author.trim()) {
      return { ok: false, error: "--author needs a user id or 'me'" };
    }
    params.set("author", flags.author.trim());
  }
  // Stroke data is only useful to the web renderer.
  params.set("include_ink", "false");
  return { ok: true, query: params.toString() };
}

function oneLine(text: string | null | undefined, max = 80): string {
  const s = (text ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** What the markup says, in one line: comment, suggested edit or ink reading. */
export function markupGist(m: Markup): string {
  const quote = m.anchor.quote ? `"${oneLine(m.anchor.quote, 50)}"` : "";
  switch (m.kind) {
    case "suggestion": {
      const edit =
        m.suggested_text === "" || m.suggested_text === null
          ? `strike ${quote}`
          : `${quote} → "${oneLine(m.suggested_text, 50)}"`;
      return m.body ? `${edit}  (${oneLine(m.body, 60)})` : edit;
    }
    case "highlight":
      return `${quote}: ${oneLine(m.body)}`;
    case "point":
      return `[${oneLine(m.anchor.figure_label, 40) || `figure ${m.anchor.figure_id ?? "?"}`}]: ${oneLine(m.body)}`;
    case "ink": {
      const reading = m.ink_reading ? oneLine(m.ink_reading) : "(no reading yet)";
      return m.body ? `ink: ${reading}  (${oneLine(m.body, 60)})` : `ink: ${reading}`;
    }
  }
}

/** Human list output, grouped by version (newest first). */
export function formatMarkupList(markups: Markup[]): string {
  if (markups.length === 0) return "(no markups)";
  const byVersion = new Map<number, Markup[]>();
  for (const m of markups) {
    const list = byVersion.get(m.version_number) ?? [];
    list.push(m);
    byVersion.set(m.version_number, list);
  }
  const lines: string[] = [];
  for (const v of [...byVersion.keys()].sort((a, b) => b - a)) {
    const group = byVersion.get(v)!;
    const open = group.filter((m) => m.status === "open").length;
    lines.push(`v${v}  (${open} open, ${group.length - open} resolved)`);
    for (const m of group) {
      const section = m.anchor.section_label || m.anchor.section_id || "?";
      lines.push(
        `  ${m.id}  ${m.kind.padEnd(10)} ${m.status.padEnd(8)} ${m.author_name ?? "?"}  §${section}`,
      );
      lines.push(`      ${markupGist(m)}`);
    }
  }
  return lines.join("\n");
}

/** Human detail output for one markup and its thread. */
export function formatMarkupDetail(m: Markup): string {
  const a = m.anchor;
  const lines = [
    `${m.id}  ${m.kind}  ${m.status}  v${m.version_number}`,
    `  author:   ${m.author_name ?? "?"}  ${m.created_at.slice(0, 19)}`,
    `  section:  ${a.section_label ? `${a.section_label} (${a.section_id})` : a.section_id ?? "?"}`,
  ];
  if (a.quote) {
    lines.push(`  quote:    …${a.prefix ?? ""}[${a.quote}]${a.suffix ?? ""}…`);
  }
  if (a.figure_id) {
    lines.push(`  figure:   ${a.figure_label ? `${a.figure_label} (${a.figure_id})` : a.figure_id}`);
  }
  if (m.kind === "suggestion") {
    lines.push(
      `  suggest:  ${m.suggested_text ? `replace with "${m.suggested_text}"` : "strike out"}`,
    );
  }
  if (m.kind === "ink") {
    lines.push(`  reading:  ${m.ink_reading ?? "(none)"}`);
    lines.push(`  ink png:  ${m.has_ink_png ? "yes (--save-ink <dir>)" : "no"}`);
  }
  if (m.body) lines.push(`  comment:  ${m.body}`);
  if (m.status === "resolved") {
    lines.push(`  resolved: by ${m.resolved_by_name ?? "?"} at ${m.resolved_at?.slice(0, 19) ?? "?"}`);
  }
  if (m.replies.length > 0) {
    lines.push("  thread:");
    for (const r of m.replies) {
      const what =
        r.event === "comment" ? r.body ?? "" : `[${r.event}]${r.body ? ` ${r.body}` : ""}`;
      lines.push(`    ${r.created_at.slice(0, 19)}  ${r.author_name ?? "?"}: ${what}`);
    }
  }
  return lines.join("\n");
}

// ─── command wrappers ───────────────────────────────────────────────────────

export async function markupsCommand(args: string[]) {
  const sub = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(MARKUPS_HELP);
      return;
    case "list":
      return markupsList(rest);
    case "get":
      return markupsGet(rest);
    case "reply":
      return markupsReply(rest);
    case "resolve":
      return markupsSetStatus(rest, "resolve");
    case "reopen":
      return markupsSetStatus(rest, "reopen");
    default:
      console.error(`Unknown markups subcommand: ${sub}`);
      console.error(MARKUPS_HELP);
      process.exit(1);
  }
}

function wantsHelp(flags: Record<string, string | true | undefined>): boolean {
  return flags.help !== undefined || flags.h !== undefined;
}

async function markupsList(args: string[]) {
  const { flags, positional } = parseFlags(args);
  const usage =
    "Usage: dillion artifacts markups list <report-id> [--version N] [--status open|resolved|all] [--author <user-id>|me] [--json]";
  if (wantsHelp(flags)) {
    console.log(usage);
    return;
  }
  failOnUnknownFlags(flags, ["version", "v", "status", "author", "json"], usage);
  const reportId = positional[0];
  if (!reportId) {
    console.error(usage);
    process.exit(1);
  }
  const q = buildMarkupListQuery(flags);
  if (!q.ok) {
    console.error(q.error);
    process.exit(1);
  }
  const data = (await api(
    `/research-reports/${encodeURIComponent(reportId)}/markups?${q.query}`,
  )) as Markup[];
  if (flags.json !== undefined) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  console.log(terminalSafe(formatMarkupList(data)));
}

async function markupsGet(args: string[]) {
  const { flags, positional } = parseFlags(args);
  const usage = "Usage: dillion artifacts markups get <markup-id> [--save-ink <dir>] [--json]";
  if (wantsHelp(flags)) {
    console.log(usage);
    return;
  }
  failOnUnknownFlags(flags, ["save-ink", "json"], usage);
  const markupId = positional[0];
  if (!markupId) {
    console.error(usage);
    process.exit(1);
  }
  const saveInk = flags["save-ink"];
  if (saveInk !== undefined && (typeof saveInk !== "string" || !saveInk.trim())) {
    console.error("--save-ink needs a directory");
    process.exit(1);
  }
  const m = (await api(`/markups/${encodeURIComponent(markupId)}`)) as Markup;
  let savedTo: string | null = null;
  if (typeof saveInk === "string") {
    if (!m.has_ink_png) {
      console.error(`Markup ${m.id} has no ink PNG`);
      process.exit(1);
    }
    savedTo = join(resolve(saveInk), `${m.id}.png`);
    await apiDownloadToFile(`/markups/${encodeURIComponent(m.id)}/ink-png`, savedTo);
  }
  if (flags.json !== undefined) {
    console.log(JSON.stringify(savedTo ? { ...m, ink_png_path: savedTo } : m, null, 2));
    return;
  }
  console.log(terminalSafe(formatMarkupDetail(m)));
  if (savedTo) console.log(`✓ Wrote ${savedTo}`);
}

async function markupsReply(args: string[]) {
  const { flags, positional } = parseFlags(args);
  const usage = 'Usage: dillion artifacts markups reply <markup-id> "<text>"';
  if (wantsHelp(flags)) {
    console.log(usage);
    return;
  }
  failOnUnknownFlags(flags, ["json"], usage);
  const [markupId, ...textParts] = positional;
  const text = textParts.join(" ").trim();
  if (!markupId || !text) {
    console.error(usage);
    process.exit(1);
  }
  const m = (await api(`/markups/${encodeURIComponent(markupId)}/replies`, {
    method: "POST",
    body: { body: text },
  })) as Markup;
  if (flags.json !== undefined) {
    console.log(JSON.stringify(m, null, 2));
    return;
  }
  console.log(terminalSafe(`✓ Replied on ${m.id} (${m.replies.length} in thread)`));
}

async function markupsSetStatus(args: string[], action: "resolve" | "reopen") {
  const { flags, positional } = parseFlags(args);
  const usage = `Usage: dillion artifacts markups ${action} <markup-id> [--note "<text>"]`;
  if (wantsHelp(flags)) {
    console.log(usage);
    return;
  }
  failOnUnknownFlags(flags, ["note", "json"], usage);
  const markupId = positional[0];
  if (!markupId) {
    console.error(usage);
    process.exit(1);
  }
  const note = flags.note;
  if (note !== undefined && (typeof note !== "string" || !note.trim())) {
    console.error("--note needs text");
    process.exit(1);
  }
  const m = (await api(`/markups/${encodeURIComponent(markupId)}/${action}`, {
    method: "POST",
    body: typeof note === "string" ? { note: note.trim() } : {},
  })) as Markup;
  if (flags.json !== undefined) {
    console.log(JSON.stringify(m, null, 2));
    return;
  }
  console.log(
    terminalSafe(
      action === "resolve"
        ? `✓ Resolved ${m.id} (by ${m.resolved_by_name ?? "you"})`
        : `✓ Reopened ${m.id}`,
    ),
  );
}
