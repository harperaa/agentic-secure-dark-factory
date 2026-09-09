import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Operator CLI path (design §13.1 `sdf`): the same actions the Spec screen performs, callable
 * with the deployment's admin key (`npx convex run cli:createProject`) from the operator's
 * machine. Internal, so the browser cannot reach them; the audit actor records the CLI.
 */
export const createProject = internalMutation({
  args: { spec: v.any(), start: v.optional(v.boolean()) },
  handler: async (ctx, { spec, start }) => {
    const s = spec as {
      name: string;
      mode: "dark" | "gray";
      greptile_threshold: number;
      max_repair_rounds: number;
      forced_gray_paths: string[];
      providers: { profile: "default" | "eu"; sandbox: string } & Record<string, string | undefined>;
    };
    for (const key of ["name", "mode", "greptile_threshold", "max_repair_rounds", "forced_gray_paths", "providers"] as const) {
      if (s[key] === undefined) {
        throw new Error(`MISSING_ARG ${key}`);
      }
    }
    const existing = await ctx.db.query("projects").withIndex("by_name", (q) => q.eq("name", s.name)).unique();
    if (existing) {
      throw new Error(`project ${s.name} already exists`);
    }
    const now = Date.now();
    const actor = "cli:operator";
    const projectId = await ctx.db.insert("projects", {
      name: s.name,
      spec,
      mode: s.mode,
      greptileThreshold: s.greptile_threshold,
      maxRepairRounds: s.max_repair_rounds,
      forcedGrayPaths: s.forced_gray_paths,
      providers: {
        profile: s.providers.profile,
        sandbox: s.providers.sandbox,
        ...Object.fromEntries(
          (["hosting", "identity", "secrets", "backend", "payments", "llm", "review", "scm"] as const)
            .filter((k) => s.providers[k] !== undefined)
            .map((k) => [k, s.providers[k]]),
        ),
      },
      stage: "DRAFT",
      phaseIndex: 0,
      createdBy: actor,
      updatedAt: now,
    });
    await ctx.db.insert("events", { projectId, at: now, actor, action: "project.create", after: { name: s.name, mode: s.mode } });
    if (!start) {
      return { projectId, stage: "DRAFT" };
    }
    await ctx.db.patch(projectId, { stage: "GENESIS", updatedAt: now });
    const runId = await ctx.db.insert("runs", {
      projectId,
      stage: "GENESIS",
      command: "genesis",
      repository: process.env.FACTORY_WORKSPACE_REPOSITORY ?? "factory-workspace",
      prompt: JSON.stringify(spec),
      state: "queued",
      attempt: 1,
      queuedAt: now,
    });
    await ctx.db.insert("events", { projectId, runId, at: now, actor, action: "stage.transition", before: { stage: "DRAFT" }, after: { stage: "GENESIS" } });
    return { projectId, runId, stage: "GENESIS" };
  },
});

/** Read a project's line state from the CLI (mirrors what the Floor shows). */
export const status = internalMutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const project = await ctx.db.query("projects").withIndex("by_name", (q) => q.eq("name", name)).unique();
    if (!project) {
      return null;
    }
    const runs = await ctx.db.query("runs").withIndex("by_project", (q) => q.eq("projectId", project._id)).order("desc").take(5);
    const decisions = await ctx.db.query("decisions").withIndex("by_project_status", (q) => q.eq("projectId", project._id).eq("status", "open")).collect();
    return {
      stage: project.stage,
      phaseIndex: project.phaseIndex,
      repo: project.repo ?? null,
      devUrl: project.devUrl ?? null,
      currentPr: project.currentPr ?? null,
      runs: runs.map((r) => ({ stage: r.stage, command: r.command, state: r.state, resultLine: r.resultLine ?? null })),
      decisions: decisions.map((d) => d.title),
    };
  },
});

/** Retry the last failed stage of a project after the operator fixed the cause (resolves open unblock decisions). */
export const retryStage = internalMutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const project = await ctx.db.query("projects").withIndex("by_name", (q) => q.eq("name", name)).unique();
    if (!project) {
      throw new Error(`no project named ${name}`);
    }
    const last = await ctx.db.query("runs").withIndex("by_project", (q) => q.eq("projectId", project._id)).order("desc").first();
    if (!last || last.state === "queued" || last.state === "running") {
      throw new Error("nothing to retry: no terminal run");
    }
    const now = Date.now();
    const open = await ctx.db.query("decisions").withIndex("by_project_status", (q) => q.eq("projectId", project._id).eq("status", "open")).collect();
    for (const d of open) {
      if (d.kind === "unblock") {
        await ctx.db.patch(d._id, { status: "resolved", resolvedBy: "cli:operator", resolvedAt: now, note: "retried from the CLI" });
      }
    }
    const runId = await ctx.db.insert("runs", {
      projectId: project._id,
      stage: last.stage,
      command: last.command,
      repository: last.repository,
      prompt: last.prompt,
      state: "queued",
      attempt: 1,
      queuedAt: now,
      ...(last.ref === undefined ? {} : { ref: last.ref }),
    });
    await ctx.db.patch(project._id, { stage: last.stage, retryCount: 0, updatedAt: now });
    await ctx.db.insert("events", { projectId: project._id, runId, at: now, actor: "cli:operator", action: "run.retry", after: { stage: last.stage } });
    return { runId, stage: last.stage };
  },
});

/** Correct the tracked pull request for a project in review (e.g. after a mis-parsed hand-off). */
export const setPullRequest = internalMutation({
  args: { name: v.string(), pr: v.number() },
  handler: async (ctx, { name, pr }) => {
    const project = await ctx.db.query("projects").withIndex("by_name", (q) => q.eq("name", name)).unique();
    if (!project) {
      throw new Error(`no project named ${name}`);
    }
    const now = Date.now();
    const open = await ctx.db.query("decisions").withIndex("by_project_status", (q) => q.eq("projectId", project._id).eq("status", "open")).collect();
    for (const d of open) {
      await ctx.db.patch(d._id, { status: "resolved", resolvedBy: "cli:operator", resolvedAt: now, note: `superseded: tracked PR corrected to #${pr}` });
    }
    await ctx.db.patch(project._id, { currentPr: pr, stage: "REVIEW_LOOP", repairRound: 0, updatedAt: now });
    await ctx.db.insert("events", { projectId: project._id, at: now, actor: "cli:operator", action: "pr.set", before: { pr: project.currentPr ?? null }, after: { pr } });
    return { pr };
  },
});
