import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireBridge } from "./lib/factoryAuth";
import { runStateValidator } from "./factoryTables";

/**
 * Bridge protocol (design §5.0): a small process on the worker machine polls these functions,
 * submits queued runs to the local Machinist control plane, mirrors run state back, and executes
 * effects with the machine's own credentials. Every call carries the shared bridge secret.
 */

export const pollQueued = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    requireBridge(secret);
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_state", (q) => q.eq("state", "queued"))
      .take(10);
    const effects = await ctx.db
      .query("effects")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .take(10);
    return { runs, effects };
  },
});

/** Bridge submitted the run to Machinist. */
export const markSubmitted = mutation({
  args: { secret: v.string(), runId: v.id("runs"), machinistJobId: v.string() },
  handler: async (ctx, { secret, runId, machinistJobId }) => {
    const actor = requireBridge(secret);
    const run = await ctx.db.get(runId);
    if (!run || run.state !== "queued") {
      return;
    }
    const now = Date.now();
    await ctx.db.patch(runId, { machinistJobId, state: "running", startedAt: now });
    await ctx.db.insert("events", {
      projectId: run.projectId,
      runId,
      at: now,
      actor,
      action: "run.submit",
      after: { machinistJobId, command: run.command },
    });
  },
});

/** Bridge mirrors a Machinist run's current details while it is running. */
export const mirror = mutation({
  args: {
    secret: v.string(),
    runId: v.id("runs"),
    machinistRunId: v.optional(v.string()),
    commandHash: v.optional(v.string()),
    executor: v.optional(v.string()),
    model: v.optional(v.string()),
  },
  handler: async (ctx, { secret, runId, ...fields }) => {
    requireBridge(secret);
    const patch = Object.fromEntries(Object.entries(fields).filter(([, val]) => val !== undefined));
    await ctx.db.patch(runId, patch);
  },
});

/** Bridge reports a terminal state; the state machine decides what happens next. */
export const complete = mutation({
  args: {
    secret: v.string(),
    runId: v.id("runs"),
    state: runStateValidator,
    exitCode: v.optional(v.number()),
    error: v.optional(v.string()),
    resultLine: v.optional(v.string()),
    tokenUsage: v.optional(
      v.object({
        input: v.number(),
        output: v.number(),
        cacheRead: v.optional(v.number()),
        cacheWrite: v.optional(v.number()),
      }),
    ),
    headSha: v.optional(v.string()),
    pr: v.optional(v.number()),
  },
  handler: async (ctx, { secret, runId, state, exitCode, error, resultLine, tokenUsage, headSha, pr }) => {
    const actor = requireBridge(secret);
    const run = await ctx.db.get(runId);
    if (!run || run.state !== "running") {
      return;
    }
    const now = Date.now();
    await ctx.db.patch(runId, {
      state,
      completedAt: now,
      ...(exitCode === undefined ? {} : { exitCode }),
      ...(error === undefined ? {} : { error }),
      ...(resultLine === undefined ? {} : { resultLine }),
      ...(tokenUsage === undefined ? {} : { tokenUsage }),
      ...(headSha === undefined ? {} : { headSha }),
    });
    await ctx.db.insert("events", {
      projectId: run.projectId,
      runId,
      at: now,
      actor,
      action: "run.complete",
      after: { state, exitCode: exitCode ?? null, resultLine: resultLine ?? null },
    });
    await ctx.scheduler.runAfter(0, internal.stateMachine.onRunCompleted, {
      runId,
      ...(pr === undefined ? {} : { pr }),
    });
  },
});

/** Bridge took an effect and executed it. */
export const effectResult = mutation({
  args: {
    secret: v.string(),
    effectId: v.id("effects"),
    ok: v.boolean(),
    result: v.optional(v.any()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { secret, effectId, ok, result, error }) => {
    const actor = requireBridge(secret);
    const effect = await ctx.db.get(effectId);
    if (!effect) {
      return;
    }
    const now = Date.now();
    await ctx.db.patch(effectId, {
      status: ok ? "done" : "failed",
      completedAt: now,
      ...(result === undefined ? {} : { result }),
      ...(error === undefined ? {} : { error }),
    });
    await ctx.db.insert("events", {
      projectId: effect.projectId,
      at: now,
      actor,
      action: `effect.${effect.kind}`,
      after: { ok, result: result ?? null, error: error ?? null },
    });
    if (ok) {
      await ctx.scheduler.runAfter(0, internal.stateMachine.onEffectDone, { effectId });
    }
  },
});

/**
 * Adopt a product that already exists (created by the CLI before the control plane did), so the
 * webhook, gates, and decisions apply to it. Idempotent by name.
 */
export const adoptProject = mutation({
  args: {
    secret: v.string(),
    spec: v.any(),
    repo: v.string(),
    devUrl: v.optional(v.string()),
    phaseIssues: v.optional(v.array(v.string())),
    phaseIndex: v.optional(v.number()),
    currentPr: v.optional(v.number()),
    stage: v.optional(v.union(v.literal("BUILD"), v.literal("REVIEW_LOOP"), v.literal("MAINTAIN"))),
  },
  handler: async (ctx, { secret, spec, repo, devUrl, phaseIssues, phaseIndex, currentPr, stage }) => {
    const actor = requireBridge(secret);
    const s = spec as {
      name: string;
      mode: "dark" | "gray";
      greptile_threshold: number;
      max_repair_rounds: number;
      forced_gray_paths: string[];
      providers: { profile: "default" | "eu"; sandbox: string };
    };
    const existing = await ctx.db.query("projects").withIndex("by_name", (q) => q.eq("name", s.name)).unique();
    const now = Date.now();
    const fields = {
      repo,
      ...(devUrl === undefined ? {} : { devUrl }),
      ...(phaseIssues === undefined ? {} : { phaseIssues }),
      ...(phaseIndex === undefined ? {} : { phaseIndex }),
      ...(currentPr === undefined ? {} : { currentPr }),
      stage: stage ?? "MAINTAIN",
      updatedAt: now,
    } as const;
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return existing._id;
    }
    const projectId = await ctx.db.insert("projects", {
      name: s.name,
      spec,
      mode: s.mode,
      greptileThreshold: s.greptile_threshold,
      maxRepairRounds: s.max_repair_rounds,
      forcedGrayPaths: s.forced_gray_paths,
      providers: { profile: s.providers.profile, sandbox: s.providers.sandbox },
      phaseIndex: phaseIndex ?? 0,
      createdBy: actor,
      ...fields,
    });
    await ctx.db.insert("events", { projectId, at: now, actor, action: "project.adopt", after: { repo, stage: fields.stage } });
    return projectId;
  },
});

/** Projects whose PR the bridge should poll for CI and reviewer state (webhook-independent). */
export const reviewTargets = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    requireBridge(secret);
    // Stopped projects keep their gate fresh too, so an unblock evaluates current CI, not the failure it stopped on.
    const inReview = await ctx.db.query("projects").withIndex("by_stage", (q) => q.eq("stage", "REVIEW_LOOP")).collect();
    const stopped = await ctx.db.query("projects").withIndex("by_stage", (q) => q.eq("stage", "NEEDS_HUMAN")).collect();
    return [...inReview, ...stopped]
      .filter((p) => p.repo !== undefined && p.currentPr !== undefined)
      .map((p) => ({ projectId: p._id, repo: p.repo as string, pr: p.currentPr as number }));
  },
});

/** Bridge-observed gate state for a PR: CI check conclusions and the reviewer's verdict. */
export const gateSync = mutation({
  args: {
    secret: v.string(),
    projectId: v.id("projects"),
    pr: v.number(),
    headSha: v.optional(v.string()),
    ci: v.array(v.object({ name: v.string(), conclusion: v.string(), required: v.optional(v.boolean()) })),
    reviewScore: v.union(v.number(), v.null()),
    unresolvedComments: v.number(),
    changedPaths: v.array(v.string()),
    labels: v.array(v.string()),
  },
  handler: async (ctx, { secret, projectId, pr, headSha, ci, reviewScore, unresolvedComments, changedPaths, labels }) => {
    requireBridge(secret);
    const project = await ctx.db.get(projectId);
    if (!project) {
      return;
    }
    const existing = await ctx.db
      .query("gates")
      .withIndex("by_project_pr", (q) => q.eq("projectId", projectId).eq("pr", pr))
      .order("desc")
      .first();
    const now = Date.now();
    const review = {
      score: reviewScore,
      threshold: project.greptileThreshold,
      unresolvedComments,
      round: existing?.review?.round ?? project.repairRound ?? 0,
      reviewedAt: now,
    };
    const patch = { ...(headSha === undefined ? {} : { headSha }), ci, review, updatedAt: now };
    if (existing) {
      const changed = JSON.stringify({ ci: existing.ci, s: existing.review?.score, u: existing.review?.unresolvedComments }) !== JSON.stringify({ ci, s: reviewScore, u: unresolvedComments });
      await ctx.db.patch(existing._id, changed ? patch : { updatedAt: existing.updatedAt });
      if (changed) {
        await ctx.scheduler.runAfter(0, internal.gates.evaluate, { projectId });
      }
    } else {
      const latestRun = await ctx.db.query("runs").withIndex("by_project", (q) => q.eq("projectId", projectId)).order("desc").first();
      await ctx.db.insert("gates", { ...(latestRun ? { runId: latestRun._id } : {}), projectId, pr, verdict: "pending", ...patch });
      await ctx.scheduler.runAfter(0, internal.gates.evaluate, { projectId });
    }
    // Record the changed paths and labels for the forced-gray classifier.
    await ctx.scheduler.runAfter(0, internal.gates.classify, { projectId, pr, changedPaths, labels });
  },
});

/** Runs the bridge already submitted (state running); re-tracked after a bridge restart. */
export const running = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    requireBridge(secret);
    const runs = await ctx.db.query("runs").withIndex("by_state", (q) => q.eq("state", "running")).take(50);
    return runs.filter((r) => r.machinistJobId !== undefined).map((r) => ({ runId: r._id, machinistJobId: r.machinistJobId as string }));
  },
});

/** One run, for the bridge to consult the foreman's state comment on completion. */
export const runById = query({
  args: { secret: v.string(), runId: v.id("runs") },
  handler: async (ctx, { secret, runId }) => {
    requireBridge(secret);
    const run = await ctx.db.get(runId);
    return run ? { command: run.command, ref: run.ref ?? null, stage: run.stage } : null;
  },
});
