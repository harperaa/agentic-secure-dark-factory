import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

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

/** Operator cleared the blocker (CI fixed, review installed): re-evaluate or re-run. */
export const unblock = internalMutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const project = await ctx.db.query("projects").withIndex("by_name", (q) => q.eq("name", name)).unique();
    if (!project) {
      throw new Error(`no project named ${name}`);
    }
    await ctx.scheduler.runAfter(0, internal.stateMachine.unblock, { projectId: project._id, actor: "cli:operator" });
    return { scheduled: true, stage: project.stage };
  },
});

/** Change one provider on a project (e.g. review=none until Greptile is installed). Recorded in the audit trail. */
export const setProvider = internalMutation({
  args: { name: v.string(), kind: v.string(), value: v.string() },
  handler: async (ctx, { name, kind, value }) => {
    const project = await ctx.db.query("projects").withIndex("by_name", (q) => q.eq("name", name)).unique();
    if (!project) {
      throw new Error(`no project named ${name}`);
    }
    const allowed = ["hosting", "identity", "secrets", "backend", "payments", "sandbox", "llm", "review", "scm"];
    if (!allowed.includes(kind)) {
      throw new Error(`unknown provider kind ${kind}`);
    }
    const now = Date.now();
    const providers = { ...project.providers, [kind]: value };
    const spec = { ...(project.spec as Record<string, unknown>), providers: { ...((project.spec as { providers?: Record<string, unknown> }).providers ?? {}), [kind]: value } };
    await ctx.db.patch(project._id, { providers, spec, updatedAt: now });
    await ctx.db.insert("events", { projectId: project._id, at: now, actor: "cli:operator", action: "provider.set", before: { [kind]: (project.providers as Record<string, string | undefined>)[kind] ?? null }, after: { [kind]: value } });
    if (project.stage === "REVIEW_LOOP") {
      await ctx.scheduler.runAfter(0, internal.gates.evaluate, { projectId: project._id });
    }
    return { providers };
  },
});

/** Resolve an open decision from the CLI (same effects as the drawer; actor cli:operator). */
export const decide = internalMutation({
  args: { name: v.string(), choice: v.union(v.literal("primary"), v.literal("secondary")), note: v.optional(v.string()) },
  handler: async (ctx, { name, choice, note }) => {
    const project = await ctx.db.query("projects").withIndex("by_name", (q) => q.eq("name", name)).unique();
    if (!project) {
      throw new Error(`no project named ${name}`);
    }
    const decision = await ctx.db.query("decisions").withIndex("by_project_status", (q) => q.eq("projectId", project._id).eq("status", "open")).order("desc").first();
    if (!decision) {
      return { resolved: null };
    }
    const now = Date.now();
    const actor = "cli:operator";
    await ctx.db.patch(decision._id, { status: "resolved", resolvedBy: actor, resolvedAt: now, ...(note === undefined ? {} : { note }) });
    if (decision.kind === "apply-auto-merge" && project.repo && project.currentPr !== undefined) {
      if (choice === "primary") {
        await ctx.db.insert("effects", { projectId: project._id, kind: "apply-label", args: { repo: project.repo, number: project.currentPr, label: "machinist:auto-merge" }, status: "queued", createdAt: now });
      } else {
        await ctx.db.insert("effects", { projectId: project._id, kind: "comment", args: { repo: project.repo, number: project.currentPr, body: `Sent back by the operator.${note ? ` ${note}` : ""}` }, status: "queued", createdAt: now });
        await ctx.db.patch(project._id, { stage: "NEEDS_HUMAN", updatedAt: now });
      }
    }
    if (decision.kind === "unblock" && choice === "primary") {
      await ctx.scheduler.runAfter(0, internal.stateMachine.unblock, { projectId: project._id, actor });
    }
    await ctx.db.insert("events", { projectId: project._id, at: now, actor, action: `decision.${decision.kind}`, after: { choice }, ...(note === undefined ? {} : { note }) });
    return { resolved: decision.title, choice };
  },
});

/** Cancel duplicate queued runs of one command for a project (keeps running ones). */
export const cancelQueued = internalMutation({
  args: { name: v.string(), command: v.string() },
  handler: async (ctx, { name, command }) => {
    const project = await ctx.db.query("projects").withIndex("by_name", (q) => q.eq("name", name)).unique();
    if (!project) {
      throw new Error(`no project named ${name}`);
    }
    const runs = await ctx.db.query("runs").withIndex("by_project", (q) => q.eq("projectId", project._id)).order("desc").take(50);
    const now = Date.now();
    const cancelled: string[] = [];
    for (const r of runs) {
      if (r.command === command && r.state === "queued") {
        await ctx.db.patch(r._id, { state: "cancelled", completedAt: now, error: "cancelled by the operator (duplicate)" });
        cancelled.push(r.machinistJobId ?? r._id);
      }
    }
    await ctx.db.insert("events", { projectId: project._id, at: now, actor: "cli:operator", action: "run.cancel-queued", after: { command, cancelled } });
    return { cancelled };
  },
});

/** Mark a run cancelled by its Machinist job id (after the job was deleted from Machinist). */
export const cancelByJob = internalMutation({
  args: { machinistJobId: v.string() },
  handler: async (ctx, { machinistJobId }) => {
    const run = await ctx.db.query("runs").withIndex("by_machinist_job", (q) => q.eq("machinistJobId", machinistJobId)).unique();
    if (!run || (run.state !== "queued" && run.state !== "running")) {
      return { cancelled: false };
    }
    await ctx.db.patch(run._id, { state: "cancelled", completedAt: Date.now(), error: "cancelled by the operator (duplicate)" });
    await ctx.db.insert("events", { projectId: run.projectId, runId: run._id, at: Date.now(), actor: "cli:operator", action: "run.cancel", after: { machinistJobId } });
    return { cancelled: true };
  },
});

/** Re-attach a Machinist job to its run (state running) so the guard and the bridge track it again. */
export const retrackJob = internalMutation({
  args: { machinistJobId: v.string() },
  handler: async (ctx, { machinistJobId }) => {
    const run = await ctx.db.query("runs").withIndex("by_machinist_job", (q) => q.eq("machinistJobId", machinistJobId)).unique();
    if (!run) {
      throw new Error(`no run for job ${machinistJobId}`);
    }
    await ctx.db.patch(run._id, { state: "running", error: undefined, completedAt: undefined });
    await ctx.db.insert("events", { projectId: run.projectId, runId: run._id, at: Date.now(), actor: "cli:operator", action: "run.retrack", after: { machinistJobId } });
    return { runId: run._id, command: run.command };
  },
});
