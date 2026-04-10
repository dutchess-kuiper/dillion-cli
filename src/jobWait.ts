import { api } from "./api";

export type JobStepPayload = {
  stepName: string;
  status: string;
  error?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
};

export type JobWaitPayload = {
  status: string;
  fileName?: string;
  steps?: JobStepPayload[];
};

export function terminalWaitState(data: JobWaitPayload): "done" | "error" | "wait" {
  if (data.status === "failed") return "error";
  const failedStep = data.steps?.find((s) => s.status === "failed");
  if (failedStep) return "error";
  if (data.status === "completed") return "done";
  return "wait";
}

function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** Elapsed ms for a step: completed duration, or running time from startedAt, or null */
export function stepElapsedMs(
  step: JobStepPayload,
  now: number
): { kind: "done" | "running" | "pending"; ms: number | null } {
  const start = parseTime(step.startedAt ?? null);
  const end = parseTime(step.completedAt ?? null);
  if (start != null && end != null) {
    return { kind: "done", ms: Math.max(0, end - start) };
  }
  if (start != null && end == null) {
    return { kind: "running", ms: Math.max(0, now - start) };
  }
  return { kind: "pending", ms: null };
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function pickActiveStep(steps: JobStepPayload[] | undefined): JobStepPayload | undefined {
  if (!steps?.length) return undefined;
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i]!;
    if (s.startedAt && !s.completedAt) return s;
  }
  return undefined;
}

function formatStepLine(step: JobStepPayload, now: number, active: JobStepPayload | undefined): string {
  const elapsed = stepElapsedMs(step, now);
  const timeCol =
    elapsed.ms != null ? formatDuration(elapsed.ms).padStart(10) : "         —";
  const tag = step === active ? "  ← active" : "";
  const name = step.stepName.padEnd(22);
  const st = step.status.padEnd(12);
  return `  ${name} ${st} ${timeCol}${tag}`;
}

/**
 * Poll GET /jobs/:id until completed or failed. Prints progress to stderr unless json.
 */
export async function waitForJobCompletion(options: {
  jobId: string;
  intervalSec: number;
  timeoutSec: number;
  json: boolean;
  /** When json is true, set false to return final payload without printing (e.g. upload --json --wait) */
  printJsonOnSuccess?: boolean;
}): Promise<JobWaitPayload> {
  const { jobId, json } = options;
  const printJsonOnSuccess = options.printJsonOnSuccess ?? json;
  const intervalMs = options.intervalSec * 1000;
  const timeoutMs = options.timeoutSec > 0 ? options.timeoutSec * 1000 : 0;
  const started = Date.now();

  for (;;) {
    if (timeoutMs > 0 && Date.now() - started > timeoutMs) {
      console.error(`Timeout after ${options.timeoutSec}s waiting for job ${jobId}`);
      process.exit(1);
    }

    const data = (await api(`/jobs/${jobId}`)) as JobWaitPayload;
    const t = terminalWaitState(data);
    const now = Date.now();

    if (!json) {
      const active = pickActiveStep(data.steps);
      const wall = formatDuration(now - started);
      console.error(
        `[${new Date().toISOString()}] ${data.fileName ?? jobId}  job=${data.status}  elapsed=${wall}`
      );
      if (data.steps?.length) {
        for (const s of data.steps) {
          console.error(formatStepLine(s, now, active));
        }
      }
      console.error("");
    }

    if (t === "done") {
      if (json && printJsonOnSuccess) {
        console.log(JSON.stringify(data, null, 2));
      } else if (!json) {
        console.error(`Done: job ${jobId} completed (ingestion finished).`);
      }
      return data;
    }
    if (t === "error") {
      const failed = data.steps?.find((s) => s.status === "failed");
      const detail = failed?.error
        ? `${failed.stepName}: ${failed.error}`
        : data.status === "failed"
          ? "job status failed"
          : "a step failed";
      console.error(`Job ${jobId} failed (${detail})`);
      process.exit(1);
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
