import { query } from "./_generated/server";
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
