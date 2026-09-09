import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Stage state machine (design §4.3). Each stage is exactly one Machinist run.
 * Names match the design; the Web UI renders operator-facing copy (design §4.12).
 */
export const stageValidator = v.union(
  v.literal("DRAFT"),
  v.literal("GENESIS"),
  v.literal("BUILD"),
  v.literal("ASSESS"),
  v.literal("FIX"),
  v.literal("REVIEW_LOOP"),
  v.literal("DEPLOY_DEV"),
  v.literal("HANDOFF"),
  v.literal("MAINTAIN"),
  v.literal("TRIAGE"),
  v.literal("NEEDS_HUMAN"),
);

export const modeValidator = v.union(v.literal("dark"), v.literal("gray"));

export const runStateValidator = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("timed_out"),
  v.literal("cancelled"),
);

export const providerProfileValidator = v.object({
  profile: v.union(v.literal("default"), v.literal("eu")),
  hosting: v.optional(v.string()),
  identity: v.optional(v.string()),
  secrets: v.optional(v.string()),
  backend: v.optional(v.string()),
  payments: v.optional(v.string()),
  sandbox: v.string(),
  llm: v.optional(v.string()),
  review: v.optional(v.string()),
  scm: v.optional(v.string()),
});

/** Factory tables (design §4.3), merged into schema.ts alongside the SVCOS tables. */
export const factoryTables = {
  /** One product. The spec is stored verbatim; derived policy fields are indexed for the UI. */
  projects: defineTable({
    name: v.string(),
    repo: v.optional(v.string()), // owner/name once genesis has created it
    spec: v.any(), // factory-spec.json, validated against spec/factory-spec.schema.json
    mode: modeValidator,
    greptileThreshold: v.number(),
    maxRepairRounds: v.number(),
    forcedGrayPaths: v.array(v.string()),
    providers: providerProfileValidator,
    stage: stageValidator,
    phaseIndex: v.number(), // current BUILD phase, 0-based
    devUrl: v.optional(v.string()),
    clerkClaimUrl: v.optional(v.string()),
    providerHandles: v.optional(
      v.object({
        vercelProject: v.optional(v.string()),
        convexDeployment: v.optional(v.string()),
        dopplerProject: v.optional(v.string()),
      }),
    ),
    lastAssessmentAt: v.optional(v.number()),
    phaseIssues: v.optional(v.array(v.string())), // issue URLs, index = phase
    currentPr: v.optional(v.number()),
    repairRound: v.optional(v.number()),
    retryCount: v.optional(v.number()),
    createdBy: v.string(), // Clerk user id
    updatedAt: v.number(),
  })
    .index("by_name", ["name"])
    .index("by_repo", ["repo"])
    .index("by_stage", ["stage"]),

  /** Mirror of one Machinist job/run. State is copied from the control plane; nothing here is authoritative for Machinist. */
  runs: defineTable({
    projectId: v.id("projects"),
    stage: stageValidator,
    command: v.string(),
    machinistJobId: v.optional(v.string()),
    machinistRunId: v.optional(v.string()),
    commandHash: v.optional(v.string()),
    executor: v.optional(v.string()),
    model: v.optional(v.string()),
    repository: v.string(),
    prompt: v.string(),
    state: runStateValidator,
    attempt: v.number(), // 1 on first submission; 2 on the single automatic retry (design §11)
    exitCode: v.optional(v.number()),
    error: v.optional(v.string()),
    resultLine: v.optional(v.string()), // the final RESULT / *_RESULT line parsed from events
    tokenUsage: v.optional(
      v.object({
        input: v.number(),
        output: v.number(),
        cacheRead: v.optional(v.number()),
        cacheWrite: v.optional(v.number()),
      }),
    ),
    ref: v.optional(v.string()), // issue or PR URL the run worked on
    headSha: v.optional(v.string()),
    queuedAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index("by_project", ["projectId", "queuedAt"])
    .index("by_machinist_job", ["machinistJobId"])
    .index("by_state", ["state"]),

  /** Gate results per run (design §4.3, §4.7, §4.8). */
  gates: defineTable({
    runId: v.optional(v.id("runs")), // absent for adopted projects whose PR predates the control plane
    projectId: v.id("projects"),
    pr: v.optional(v.number()),
    headSha: v.optional(v.string()),
    ci: v.optional(
      v.array(
        v.object({
          name: v.string(),
          conclusion: v.string(), // success | failure | neutral | pending | ...
        }),
      ),
    ),
    review: v.optional(
      v.object({
        score: v.union(v.number(), v.null()),
        threshold: v.number(),
        unresolvedComments: v.number(),
        round: v.number(),
        reviewedAt: v.optional(v.number()),
      }),
    ),
    assessment: v.optional(
      v.object({
        mode: v.union(v.literal("fresh"), v.literal("reassessment")),
        newCritical: v.number(),
        newHigh: v.number(),
        newMedium: v.number(),
        accepted: v.number(),
        reportPath: v.string(),
      }),
    ),
    forcedGray: v.optional(
      v.object({
        forced: v.boolean(),
        reasons: v.array(v.string()),
      }),
    ),
    verdict: v.union(v.literal("pending"), v.literal("pass"), v.literal("fail")),
    updatedAt: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_project_pr", ["projectId", "pr"]),

  /** Audit stream (design G4, §4.12 Audit screen). Append-only. */
  events: defineTable({
    projectId: v.optional(v.id("projects")),
    runId: v.optional(v.id("runs")),
    at: v.number(),
    actor: v.string(), // "user:<clerk id>" | "run:<machinist run id>" | "webhook:github" | "system"
    action: v.string(), // e.g. stage.transition, label.apply, decision.auto-merge, gate.update
    before: v.optional(v.any()),
    after: v.optional(v.any()),
    evidence: v.optional(v.string()), // URL to the PR, comment, run, or report
    note: v.optional(v.string()), // operator note from the decision drawer
  })
    .index("by_project", ["projectId", "at"])
    .index("by_run", ["runId", "at"]),

  /** Decisions a human must make (design §4.12 decision drawer). */
  decisions: defineTable({
    projectId: v.id("projects"),
    runId: v.optional(v.id("runs")),
    kind: v.union(
      v.literal("apply-auto-merge"),
      v.literal("send-back"),
      v.literal("accept-finding"),
      v.literal("unblock"),
      v.literal("provision"),
      v.literal("dark-mode-checklist"),
    ),
    title: v.string(), // plain language, e.g. "Merge PR #43 into main?"
    evidence: v.array(v.object({ label: v.string(), url: v.string() })),
    status: v.union(v.literal("open"), v.literal("resolved")),
    resolvedBy: v.optional(v.string()),
    resolvedAt: v.optional(v.number()),
    note: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_project_status", ["projectId", "status"])
    .index("by_status", ["status", "createdAt"]),

  /**
   * Side effects the control plane asks the bridge to perform with the worker machine's own
   * credentials (design §4.9, §5.0): the control plane never holds gh or provider tokens.
   */
  effects: defineTable({
    projectId: v.id("projects"),
    kind: v.union(
      v.literal("apply-label"),
      v.literal("remove-label"),
      v.literal("comment"),
      v.literal("create-phase-issues"),
      v.literal("register-repository"),
    ),
    args: v.any(),
    status: v.union(v.literal("queued"), v.literal("running"), v.literal("done"), v.literal("failed")),
    result: v.optional(v.any()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_status", ["status", "createdAt"])
    .index("by_project", ["projectId", "createdAt"]),
};
