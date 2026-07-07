import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { api } from "../../api";
import type { JobWaitPayload } from "../../jobWait";
import { requireProject } from "../lib/context";
import { boundedJobWait } from "../lib/poll";
import { jsonContent } from "../lib/result";
import { registerTool, type Toolset } from "../lib/register";
import { trimJobsListItem } from "../lib/trim";

const strArray = z.array(z.string()).optional();

const JobsListInput = z.object({
  projectId: z.string().optional().describe("Project id. Defaults to the configured project."),
  limit: z.number().int().min(1).max(100).optional().describe("Page size (default 25, max 100)."),
  offset: z.number().int().min(0).optional().describe("Skip this many results (default 0)."),
  status: z.string().optional().describe("Filter by status (pending/processing/completed/failed)."),
  search: z.string().optional().describe("Substring search on file names/descriptions."),
  archived: z.boolean().optional().describe("Show only archived jobs."),
  tags: strArray.describe("Filter by tags."),
  categories: strArray.describe("Filter by diligence categories."),
  people: strArray.describe("Filter by people."),
  organizations: strArray.describe("Filter by organizations."),
  locations: strArray.describe("Filter by locations."),
  flags: strArray.describe("Filter by inconsistency flags."),
  dateFrom: z.string().optional().describe("Jobs created on/after this date (YYYY-MM-DD)."),
  dateTo: z.string().optional().describe("Jobs created on/before this date (YYYY-MM-DD)."),
  sortBy: z
    .string()
    .optional()
    .describe("Sort field: created_at, updated_at, file_name, or status."),
  sortDir: z.enum(["asc", "desc"]).optional().describe("Sort direction (default desc)."),
  includeMetadata: z
    .boolean()
    .optional()
    .describe("Include the full metadata object per job (default false; s3Key is always dropped)."),
});

const JobsGetInput = z.object({
  jobId: z.string().min(1).describe("The job id."),
});

const JobsWaitInput = z.object({
  jobId: z.string().min(1).describe("The job id to poll."),
  intervalSeconds: z.number().min(1).max(60).optional().describe("Seconds between polls (default 5)."),
  maxWaitSeconds: z
    .number()
    .int()
    .min(1)
    .max(300)
    .optional()
    .describe("Bounded wait ceiling (default 50, max 300). Returns timedOut:true at the deadline."),
});

export function registerJobsTools(server: McpServer, toolset: Toolset): void {
  registerTool(server, toolset, {
    name: "jobs_list",
    core: true,
    description:
      "List ingestion jobs for a project with filters + pagination. Paginate via offset/hasMore. " +
      "s3Key is always dropped; pass includeMetadata:true for the full metadata object.",
    inputSchema: JobsListInput.shape,
    annotations: { readOnlyHint: true },
    handler: async (args: z.infer<typeof JobsListInput>) => {
      const projectId = requireProject(args.projectId);
      const limit = args.limit ?? 25;
      const offset = args.offset ?? 0;
      const includeMetadata = args.includeMetadata === true;
      const body: Record<string, unknown> = {
        projectId,
        limit,
        offset,
        ...(args.status && { status: args.status }),
        ...(args.search && { search: args.search }),
        ...(args.archived !== undefined && { archived: args.archived }),
        ...(args.tags?.length && { tags: args.tags }),
        ...(args.categories?.length && { diligenceCategories: args.categories }),
        ...(args.people?.length && { people: args.people }),
        ...(args.organizations?.length && { organizations: args.organizations }),
        ...(args.locations?.length && { locations: args.locations }),
        ...(args.flags?.length && { inconsistencyFlags: args.flags }),
        ...(args.dateFrom && { dateFrom: args.dateFrom }),
        ...(args.dateTo && { dateTo: args.dateTo }),
        ...(args.sortBy && { sortBy: args.sortBy }),
        ...(args.sortDir && { sortDir: args.sortDir }),
      };
      const data = await api("/jobs/list", { method: "POST", body });
      return jsonContent({
        total: data.total,
        limit,
        offset,
        hasMore: data.hasMore,
        jobs: (data.jobs ?? []).map((j: any) => trimJobsListItem(j, includeMetadata)),
      });
    },
  });

  registerTool(server, toolset, {
    name: "jobs_get",
    core: true,
    description: "Get a job's details and per-step status/cost.",
    inputSchema: JobsGetInput.shape,
    annotations: { readOnlyHint: true },
    handler: async (args: z.infer<typeof JobsGetInput>) => {
      const data = await api(`/jobs/${encodeURIComponent(args.jobId)}`);
      return jsonContent({
        id: data.id ?? args.jobId,
        fileName: data.fileName,
        status: data.status,
        projectId: data.projectId,
        createdAt: data.createdAt,
        ...(data.errorMessage ? { errorMessage: data.errorMessage } : {}),
        steps: (data.steps ?? []).map((s: any) => ({
          stepName: s.stepName,
          status: s.status,
          ...(s.error ? { error: s.error } : {}),
          ...(s.cost != null ? { cost: s.cost } : {}),
        })),
      });
    },
  });

  registerTool(server, toolset, {
    name: "jobs_wait",
    description:
      "Poll a job until it completes or fails, bounded by maxWaitSeconds. Returns timedOut:true " +
      "at the deadline (call again to continue waiting) — it never hangs.",
    inputSchema: JobsWaitInput.shape,
    annotations: { readOnlyHint: true },
    handler: async (args: z.infer<typeof JobsWaitInput>) => {
      const result = await boundedJobWait({
        jobId: args.jobId,
        intervalSeconds: args.intervalSeconds,
        maxWaitSeconds: args.maxWaitSeconds,
        fetchJob: (id) => api(`/jobs/${encodeURIComponent(id)}`) as Promise<JobWaitPayload>,
      });
      return jsonContent(result);
    },
  });
}
