import { terminalWaitState, type JobStepPayload, type JobWaitPayload } from "../../jobWait";

export interface TrimmedStep {
  stepName: string;
  status: string;
  error?: string | null;
}

export interface BoundedJobWaitResult {
  done: boolean;
  timedOut: boolean;
  failed: boolean;
  status: string;
  failedStep?: { stepName: string; error?: string | null };
  steps?: TrimmedStep[];
  waitedSeconds: number;
  polls: number;
}

function trimSteps(steps: JobStepPayload[] | undefined): TrimmedStep[] | undefined {
  if (!steps?.length) return undefined;
  return steps.map((s) => ({
    stepName: s.stepName,
    status: s.status,
    ...(s.error != null ? { error: s.error } : {}),
  }));
}

const DEFAULT_INTERVAL_SECONDS = 5;
const DEFAULT_MAX_WAIT_SECONDS = 50;
/** Hard cap so a wait never approaches an MCP host's tool timeout indefinitely. */
const MAX_WAIT_CAP_SECONDS = 300;

/**
 * Poll a job until it reaches a terminal state OR the bounded deadline elapses. Reuses ONLY
 * the pure `terminalWaitState` from jobWait.ts (never `waitForJobCompletion`, which writes
 * stdout + exits). Returns `{ timedOut: true, status }` at the deadline instead of hanging;
 * a job *failure* is a normal result with `failed: true` + structured step detail. Never
 * writes to stdout. `fetchJob`/`now`/`sleep` are injectable for deterministic tests.
 */
export async function boundedJobWait(options: {
  jobId: string;
  intervalSeconds?: number;
  maxWaitSeconds?: number;
  fetchJob: (jobId: string) => Promise<JobWaitPayload>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<BoundedJobWaitResult> {
  const maxWait = Math.min(
    MAX_WAIT_CAP_SECONDS,
    Math.max(1, options.maxWaitSeconds ?? DEFAULT_MAX_WAIT_SECONDS),
  );
  const interval = Math.max(0.1, options.intervalSeconds ?? DEFAULT_INTERVAL_SECONDS);
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const start = now();
  const deadlineMs = start + maxWait * 1000;
  let polls = 0;

  for (;;) {
    const data = await options.fetchJob(options.jobId);
    polls++;
    const state = terminalWaitState(data);
    const waitedSeconds = Math.round((now() - start) / 1000);

    if (state === "done") {
      return {
        done: true,
        timedOut: false,
        failed: false,
        status: data.status,
        steps: trimSteps(data.steps),
        waitedSeconds,
        polls,
      };
    }
    if (state === "error") {
      const failed = data.steps?.find((s) => s.status === "failed");
      return {
        done: false,
        timedOut: false,
        failed: true,
        status: data.status,
        ...(failed ? { failedStep: { stepName: failed.stepName, error: failed.error ?? null } } : {}),
        steps: trimSteps(data.steps),
        waitedSeconds,
        polls,
      };
    }

    // Not terminal: stop at the deadline rather than hang.
    const remainingMs = deadlineMs - now();
    if (remainingMs <= 0) {
      return {
        done: false,
        timedOut: true,
        failed: false,
        status: data.status,
        steps: trimSteps(data.steps),
        waitedSeconds,
        polls,
      };
    }
    await sleep(Math.min(interval * 1000, remainingMs));
  }
}
