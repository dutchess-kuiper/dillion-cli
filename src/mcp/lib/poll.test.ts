import { describe, expect, test } from "bun:test";
import type { JobWaitPayload } from "../../jobWait";
import { boundedJobWait } from "./poll";

/** A fake monotonic clock: advances by `stepMs` on every read. */
function fakeClock(stepMs: number) {
  let t = 0;
  return () => {
    const now = t;
    t += stepMs;
    return now;
  };
}

describe("boundedJobWait", () => {
  test("returns done when the job completes", async () => {
    let calls = 0;
    const fetchJob = async (): Promise<JobWaitPayload> => {
      calls++;
      if (calls < 2) return { status: "processing", steps: [{ stepName: "extract", status: "running" }] };
      return { status: "completed", steps: [{ stepName: "extract", status: "completed" }] };
    };
    const res = await boundedJobWait({
      jobId: "job_1",
      intervalSeconds: 1,
      maxWaitSeconds: 60,
      fetchJob,
      now: fakeClock(100),
      sleep: async () => {},
    });
    expect(res.done).toBe(true);
    expect(res.failed).toBe(false);
    expect(res.timedOut).toBe(false);
    expect(res.status).toBe("completed");
    expect(res.polls).toBe(2);
  });

  test("reports failure with structured step detail", async () => {
    const fetchJob = async (): Promise<JobWaitPayload> => ({
      status: "processing",
      steps: [
        { stepName: "extract", status: "completed" },
        { stepName: "embed", status: "failed", error: "OOM" },
      ],
    });
    const res = await boundedJobWait({
      jobId: "job_1",
      fetchJob,
      now: fakeClock(0),
      sleep: async () => {},
    });
    expect(res.failed).toBe(true);
    expect(res.done).toBe(false);
    expect(res.failedStep).toEqual({ stepName: "embed", error: "OOM" });
  });

  test("times out at the deadline instead of hanging (never done/failed)", async () => {
    let calls = 0;
    const fetchJob = async (): Promise<JobWaitPayload> => {
      calls++;
      return { status: "processing", steps: [{ stepName: "extract", status: "running" }] };
    };
    // Clock advances 30s per read; maxWait 50s → the deadline is crossed after a couple polls.
    const res = await boundedJobWait({
      jobId: "job_1",
      intervalSeconds: 5,
      maxWaitSeconds: 50,
      fetchJob,
      now: fakeClock(30_000),
      sleep: async () => {},
    });
    expect(res.timedOut).toBe(true);
    expect(res.done).toBe(false);
    expect(res.failed).toBe(false);
    expect(res.status).toBe("processing");
    expect(calls).toBeGreaterThanOrEqual(1);
    // It must terminate — a hang would never reach this assertion.
  });

  test("clamps maxWaitSeconds to the 300s cap", async () => {
    // With a clock that jumps 301s on the first post-fetch read, a >300 request still stops.
    const fetchJob = async (): Promise<JobWaitPayload> => ({ status: "processing" });
    const res = await boundedJobWait({
      jobId: "job_1",
      maxWaitSeconds: 100000,
      fetchJob,
      now: fakeClock(301_000),
      sleep: async () => {},
    });
    expect(res.timedOut).toBe(true);
    // If the cap were NOT applied, one 301s tick would stay under the (uncapped) deadline
    // and it would poll again; stopping on poll 1 proves the clamp to 300s.
    expect(res.polls).toBe(1);
  });
});
