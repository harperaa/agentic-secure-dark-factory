import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireOperator } from "./lib/factoryAuth";

export const listByProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    await requireOperator(ctx);
    return ctx.db
      .query("runs")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .order("desc")
      .collect();
  },
});

export const get = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    await requireOperator(ctx);
    const run = await ctx.db.get(runId);
    if (!run) {
      return null;
    }
    const gate = await ctx.db
      .query("gates")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .first();
    return { run, gate };
  },
});

/** Floor header counts: running, waiting on a gate, stopped. */
export const summary = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    const projects = await ctx.db.query("projects").collect();
    let running = 0;
    let waiting = 0;
    let stopped = 0;
    for (const p of projects) {
      if (p.stage === "NEEDS_HUMAN") {
        stopped += 1;
      } else if (p.stage === "REVIEW_LOOP") {
        waiting += 1;
      } else if (p.stage !== "DRAFT" && p.stage !== "HANDOFF") {
        running += 1;
      }
    }
    return { running, waiting, stopped, total: projects.length };
  },
});
