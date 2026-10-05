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
    /**
     * Step-level progress read from the run's events; see runs.progress. `since` is absent here
     * on purpose -- the bridge re-reads the whole log each poll and restarts freely, so it is
     * the stored row, not the bridge, that knows when a step began.
     */
    progress: v.optional(
      v.object({
        step: v.string(),
        outcome: v.string(),
        done: v.number(),
        at: v.number(),
        note: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { secret, runId, progress, ...fields }) => {
    requireBridge(secret);
    const patch: Record<string, unknown> = Object.fromEntries(
      Object.entries(fields).filter(([, val]) => val !== undefined),
    );
    if (progress) {
      const previous = (await ctx.db.get(runId))?.progress;
      // A step keeps its start time for as long as it is the same step. Comparing the name is
      // what makes the clock mean "how long on this step" rather than "how long since the last
      // poll", which would always read as a few seconds.
      patch.progress = {
        ...progress,
        since: previous?.step === progress.step ? (previous.since ?? progress.at) : progress.at,
      };
    }
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
    tokenUsage: v.optional(v.number()), // Machinist result.json token_usage: one total
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
    const targets = [...inReview, ...stopped].filter((p) => p.repo !== undefined && p.currentPr !== undefined);
    const out: Array<{ projectId: typeof targets[number]["_id"]; repo: string; pr: number; reviewRequestedHead: string | null }> = [];
    for (const p of targets) {
      const gate = await ctx.db
        .query("gates")
        .withIndex("by_project_pr", (q) => q.eq("projectId", p._id).eq("pr", p.currentPr as number))
        .order("desc")
        .first();
      out.push({ projectId: p._id, repo: p.repo as string, pr: p.currentPr as number, reviewRequestedHead: gate?.reviewRequestedHead ?? null });
    }
    return out;
  },
});

/** Bridge-observed gate state for a PR: CI check conclusions and the reviewer's verdict. */
export const gateSync = mutation({
  args: {
    secret: v.string(),
    projectId: v.id("projects"),
    pr: v.number(),
    headSha: v.optional(v.string()),
    ci: v.array(v.object({ name: v.string(), conclusion: v.string(), required: v.optional(v.boolean()), url: v.optional(v.string()) })),
    reviewScore: v.union(v.number(), v.null()),
    reviewSummary: v.optional(v.string()),
    unresolvedComments: v.number(),
    changedPaths: v.array(v.string()),
    labels: v.array(v.string()),
    reviewRequestedHead: v.optional(v.string()),
    dependencyCooldown: v.optional(v.object({ ok: v.boolean(), checked: v.number(), violations: v.array(v.string()) })),
  },
  handler: async (ctx, { secret, projectId, pr, headSha, ci, reviewScore, reviewSummary, unresolvedComments, changedPaths, labels, reviewRequestedHead, dependencyCooldown }) => {
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
      ...(reviewSummary ? { summary: reviewSummary.slice(0, 1200) } : {}),
    };
    const patch = { ...(headSha === undefined ? {} : { headSha }), ...(reviewRequestedHead === undefined ? {} : { reviewRequestedHead }), ci, review, updatedAt: now };
    if (existing) {
      const norm = (list: Array<{ name: string; conclusion: string; required?: boolean }> | undefined) =>
        [...(list ?? [])].sort((a, b) => a.name.localeCompare(b.name)).map((c) => `${c.name}:${c.conclusion}:${c.required === true}`).join("|");
      const changed = JSON.stringify({ ci: norm(existing.ci), s: existing.review?.score, u: existing.review?.unresolvedComments, h: existing.headSha, r: existing.review?.summary }) !== JSON.stringify({ ci: norm(ci), s: reviewScore, u: unresolvedComments, h: headSha ?? existing.headSha, r: reviewSummary ? reviewSummary.slice(0, 1200) : existing.review?.summary });
      await ctx.db.patch(existing._id, changed ? patch : { updatedAt: existing.updatedAt, ...(reviewRequestedHead === undefined ? {} : { reviewRequestedHead }) });
      if (changed) {
        await ctx.scheduler.runAfter(0, internal.gates.evaluate, { projectId });
      }
    } else {
      const latestRun = await ctx.db.query("runs").withIndex("by_project", (q) => q.eq("projectId", projectId)).order("desc").first();
      await ctx.db.insert("gates", { ...(latestRun ? { runId: latestRun._id } : {}), projectId, pr, verdict: "pending", ...patch });
      await ctx.scheduler.runAfter(0, internal.gates.evaluate, { projectId });
    }
    // Record the changed paths, labels, and lockfile cooldown for the forced-gray classifier.
    await ctx.scheduler.runAfter(0, internal.gates.classify, { projectId, pr, changedPaths, labels, ...(dependencyCooldown ? { dependencyCooldown } : {}) });
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

/**
 * Projects the bridge should keep a local dev server running for: every product that genesis
 * has created a repository for. Newest activity first, so a cap on concurrent servers keeps the
 * ones the operator is most likely looking at.
 */
export const localTargets = query({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    requireBridge(secret);
    const projects = await ctx.db.query("projects").collect();
    const out = [];
    for (const p of projects) {
      if (p.repo === undefined || p.stage === "DRAFT" || p.stage === "GENESIS") continue;
      const row = await ctx.db.query("localServers").withIndex("by_project", (q) => q.eq("projectId", p._id)).unique();
      // A run in flight may be working in the same checkout (deploy-dev commits there), so the
      // bridge must not install or pull under it.
      const lastRun = await ctx.db.query("runs").withIndex("by_project", (q) => q.eq("projectId", p._id)).order("desc").first();
      const busy = lastRun?.state === "queued" || lastRun?.state === "running";
      out.push({ projectId: p._id, name: p.name, updatedAt: p.updatedAt, port: row?.port ?? null, secrets: p.providers.secrets ?? "doppler", busy });
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

const localStatusValidator = v.union(
  v.literal("installing"),
  v.literal("starting"),
  v.literal("running"),
  v.literal("failed"),
  v.literal("stopped"),
);

/** Bridge reports the local dev server it is supervising for a project; one row per project. */
export const localServerReport = mutation({
  args: {
    secret: v.string(),
    projectId: v.id("projects"),
    status: localStatusValidator,
    port: v.number(),
    url: v.string(),
    pid: v.optional(v.number()),
    command: v.string(),
    checkout: v.string(),
    head: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { secret, projectId, ...report }) => {
    const actor = requireBridge(secret);
    const existing = await ctx.db.query("localServers").withIndex("by_project", (q) => q.eq("projectId", projectId)).unique();
    const now = Date.now();
    // replace, not patch: optional fields are cleared when absent -- a stopped server has no pid,
    // a healthy one no note.
    const row = {
      projectId,
      ...Object.fromEntries(Object.entries(report).filter(([, val]) => val !== undefined)),
      checkedAt: now,
    } as typeof report & { projectId: typeof projectId; checkedAt: number };
    if (existing) {
      await ctx.db.replace(existing._id, row);
    } else {
      await ctx.db.insert("localServers", row);
    }
    // Audit transitions only; the every-poll heartbeat would drown the stream.
    if (existing?.status !== report.status) {
      await ctx.db.insert("events", {
        projectId,
        at: now,
        actor,
        action: "local.server",
        before: existing ? { status: existing.status } : undefined,
        after: { status: report.status, url: report.url, pid: report.pid ?? null, ...(report.note ? { note: report.note } : {}) },
      });
    }
  },
});
