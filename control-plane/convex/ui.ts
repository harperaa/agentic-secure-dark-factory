import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOperator } from "./lib/factoryAuth";

/** Floor: projects with what each station needs (latest run stage, latest gate, open decisions). */
export const floor = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    const projects = await ctx.db.query("projects").order("desc").collect();
    const rows = [];
    for (const project of projects) {
      const lastRun = await ctx.db
        .query("runs")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .order("desc")
        .first();
      const gate =
        project.currentPr === undefined
          ? null
          : await ctx.db
              .query("gates")
              .withIndex("by_project_pr", (q) => q.eq("projectId", project._id).eq("pr", project.currentPr))
              .order("desc")
              .first();
      const openDecisions = await ctx.db
        .query("decisions")
        .withIndex("by_project_status", (q) => q.eq("projectId", project._id).eq("status", "open"))
        .collect();
      rows.push({ project, lastRun, gate, openDecisions: openDecisions.length });
    }
    return rows;
  },
});

/** Project screen bundle. */
export const project = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    await requireOperator(ctx);
    const project = await ctx.db.get(projectId);
    if (!project) {
      return null;
    }
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .order("desc")
      .collect();
    const gate =
      project.currentPr === undefined
        ? null
        : await ctx.db
            .query("gates")
            .withIndex("by_project_pr", (q) => q.eq("projectId", projectId).eq("pr", project.currentPr))
            .order("desc")
            .first();
    const decisions = await ctx.db
      .query("decisions")
      .withIndex("by_project_status", (q) => q.eq("projectId", projectId).eq("status", "open"))
      .order("desc")
      .collect();
    return { project, runs, gate, decisions };
  },
});

/** Run screen: the run, its project, its gate, and its events oldest first so the log follows the tail. */
export const run = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    await requireOperator(ctx);
    const run = await ctx.db.get(runId);
    if (!run) {
      return null;
    }
    const project = await ctx.db.get(run.projectId);
    const gate = await ctx.db
      .query("gates")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .first();
    const events = await ctx.db
      .query("events")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .order("asc")
      .collect();
    return { run, project, gate, events };
  },
});

/** Open decisions with their project names, for the drawer and the /decisions list. */
export const openDecisions = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    const decisions = await ctx.db
      .query("decisions")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .order("desc")
      .collect();
    const out = [];
    for (const decision of decisions) {
      const project = await ctx.db.get(decision.projectId);
      out.push({ decision, projectName: project?.name ?? "" });
    }
    return out;
  },
});

/** Audit rows with project names resolved. */
export const audit = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await requireOperator(ctx);
    const events = await ctx.db.query("events").order("desc").take(Math.min(limit ?? 300, 1000));
    const names = new Map<string, string>();
    const rows = [];
    for (const event of events) {
      let projectName = "";
      if (event.projectId) {
        const cached = names.get(event.projectId);
        if (cached !== undefined) {
          projectName = cached;
        } else {
          const p = await ctx.db.get(event.projectId);
          projectName = p?.name ?? "";
          names.set(event.projectId, projectName);
        }
      }
      rows.push({ event, projectName });
    }
    return rows;
  },
});

/**
 * Clerk claim URL: kept only in the product's Doppler dev config (FACTORY_CLERK_CLAIM_URL).
 * The operator asks for it; the bridge reads it with the worker machine's Doppler login and
 * returns it in the effect result; the operator clears it after use.
 */
export const requestClaimUrl = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const actor = await requireOperator(ctx);
    const project = await ctx.db.get(projectId);
    if (!project) {
      throw new Error("no such project");
    }
    const now = Date.now();
    const id = await ctx.db.insert("effects", {
      projectId,
      kind: "reveal-claim-url",
      args: { name: project.name },
      status: "queued",
      createdAt: now,
    });
    await ctx.db.insert("events", { projectId, at: now, actor, action: "clerk.claim-url.request" });
    return id;
  },
});

export const claimUrl = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    await requireOperator(ctx);
    const effects = await ctx.db
      .query("effects")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .order("desc")
      .take(20);
    const latest = effects.find((e) => e.kind === "reveal-claim-url");
    if (!latest) {
      return null;
    }
    const result = latest.result as { url?: string; cleared?: boolean } | undefined;
    return {
      effectId: latest._id,
      status: latest.status,
      url: latest.status === "done" && result?.url && !result.cleared ? result.url : null,
      error: latest.error ?? null,
      at: latest.completedAt ?? latest.createdAt,
    };
  },
});

export const clearClaimUrl = mutation({
  args: { effectId: v.id("effects") },
  handler: async (ctx, { effectId }) => {
    const actor = await requireOperator(ctx);
    const effect = await ctx.db.get(effectId);
    if (!effect || effect.kind !== "reveal-claim-url") {
      return;
    }
    await ctx.db.patch(effectId, { result: { cleared: true } });
    await ctx.db.insert("events", { projectId: effect.projectId, at: Date.now(), actor, action: "clerk.claim-url.clear" });
  },
});
