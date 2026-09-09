import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireOperator } from "./lib/factoryAuth";

/** Audit screen: flat, dense, newest first. */
export const list = query({
  args: { projectId: v.optional(v.id("projects")), limit: v.optional(v.number()) },
  handler: async (ctx, { projectId, limit }) => {
    await requireOperator(ctx);
    const n = Math.min(limit ?? 200, 1000);
    if (projectId) {
      return ctx.db
        .query("events")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .order("desc")
        .take(n);
    }
    return ctx.db.query("events").order("desc").take(n);
  },
});
