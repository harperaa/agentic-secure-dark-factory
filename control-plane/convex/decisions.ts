import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOperator } from "./lib/factoryAuth";

export const listOpen = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    return ctx.db
      .query("decisions")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .order("desc")
      .collect();
  },
});

export const listByProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    await requireOperator(ctx);
    return ctx.db
      .query("decisions")
      .withIndex("by_project_status", (q) => q.eq("projectId", projectId))
      .order("desc")
      .collect();
  },
});

/**
 * Decision drawer primary/secondary action. Each choice becomes an audit event and, where a
 * GitHub mutation is needed, an effect for the bridge (the control plane never holds tokens).
 */
export const resolve = mutation({
  args: {
    decisionId: v.id("decisions"),
    choice: v.union(v.literal("primary"), v.literal("secondary")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { decisionId, choice, note }) => {
    const actor = await requireOperator(ctx);
    const decision = await ctx.db.get(decisionId);
    if (!decision || decision.status !== "open") {
      throw new Error("decision is not open");
    }
    const project = await ctx.db.get(decision.projectId);
    if (!project) {
      throw new Error("no such project");
    }
    const now = Date.now();
    await ctx.db.patch(decisionId, {
      status: "resolved",
      resolvedBy: actor,
      resolvedAt: now,
      ...(note === undefined ? {} : { note }),
    });

    if (decision.kind === "apply-auto-merge" && project.repo && project.currentPr !== undefined) {
      if (choice === "primary") {
        await ctx.db.insert("effects", {
          projectId: project._id,
          kind: "apply-label",
          args: { repo: project.repo, number: project.currentPr, label: "machinist:auto-merge" },
          status: "queued",
          createdAt: now,
        });
      } else {
        await ctx.db.insert("effects", {
          projectId: project._id,
          kind: "comment",
          args: {
            repo: project.repo,
            number: project.currentPr,
            body: `Sent back by the operator.${note ? ` ${note}` : ""}`,
          },
          status: "queued",
          createdAt: now,
        });
        await ctx.db.patch(project._id, { stage: "NEEDS_HUMAN", updatedAt: now });
      }
    }
    if (decision.kind === "unblock" && choice === "primary") {
      // Operator says the blocker is cleared: return to the stage the run belonged to and retry.
      const run = decision.runId ? await ctx.db.get(decision.runId) : null;
      if (run) {
        await ctx.db.insert("runs", {
          projectId: project._id,
          stage: run.stage,
          command: run.command,
          repository: run.repository,
          prompt: run.prompt,
          state: "queued",
          attempt: 1,
          queuedAt: now,
          ...(run.ref === undefined ? {} : { ref: run.ref }),
        });
        await ctx.db.patch(project._id, { stage: run.stage, retryCount: 0, updatedAt: now });
      }
    }
    await ctx.db.insert("events", {
      projectId: project._id,
      ...(decision.runId === undefined ? {} : { runId: decision.runId }),
      at: now,
      actor,
      action: `decision.${decision.kind}`,
      after: { choice },
      ...(note === undefined ? {} : { note }),
    });
  },
});
