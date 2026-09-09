import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { stageValidator } from "./factoryTables";

/**
 * Enqueue one stage run for a project identified by its GitHub repository.
 * The bridge process picks up `queued` runs and submits them to Machinist (design §5.0).
 */
export const enqueue = internalMutation({
  args: {
    projectRepo: v.string(),
    stage: stageValidator,
    command: v.string(),
    prompt: v.string(),
    ref: v.optional(v.string()),
    actor: v.string(),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_repo", (q) => q.eq("repo", args.projectRepo))
      .unique();
    if (!project) {
      throw new Error(`no project for repository ${args.projectRepo}`);
    }
    const now = Date.now();
    const runId = await ctx.db.insert("runs", {
      projectId: project._id,
      stage: args.stage,
      command: args.command,
      repository: project.name,
      prompt: args.prompt,
      state: "queued",
      attempt: 1,
      queuedAt: now,
      ...(args.ref === undefined ? {} : { ref: args.ref }),
    });
    await ctx.db.insert("events", {
      projectId: project._id,
      runId,
      at: now,
      actor: args.actor,
      action: "run.enqueue",
      after: { stage: args.stage, command: args.command },
      ...(args.ref === undefined ? {} : { evidence: args.ref }),
    });
    return runId;
  },
});

/**
 * Record that GitHub reported a check-suite conclusion or a reviewer verdict for a PR.
 * The gate row is created lazily; the review-loop scheduler evaluates it (design §4.7).
 */
export const gateUpdate = internalMutation({
  args: {
    repo: v.string(),
    pr: v.number(),
    headSha: v.optional(v.string()),
    ci: v.optional(v.array(v.object({ name: v.string(), conclusion: v.string() }))),
    reviewScore: v.optional(v.union(v.number(), v.null())),
    unresolvedComments: v.optional(v.number()),
    actor: v.string(),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_repo", (q) => q.eq("repo", args.repo))
      .unique();
    if (!project) {
      return null;
    }
    const existing = await ctx.db
      .query("gates")
      .withIndex("by_project_pr", (q) => q.eq("projectId", project._id).eq("pr", args.pr))
      .order("desc")
      .first();
    const now = Date.now();
    const review =
      args.reviewScore === undefined
        ? existing?.review
        : {
            score: args.reviewScore,
            threshold: project.greptileThreshold,
            unresolvedComments: args.unresolvedComments ?? existing?.review?.unresolvedComments ?? 0,
            round: existing?.review?.round ?? 0,
            reviewedAt: now,
          };
    const patch = {
      ...(args.headSha === undefined ? {} : { headSha: args.headSha }),
      ...(args.ci === undefined ? {} : { ci: args.ci }),
      ...(review === undefined ? {} : { review }),
      updatedAt: now,
    };
    let gateId;
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      gateId = existing._id;
    } else {
      const latestRun = await ctx.db
        .query("runs")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .order("desc")
        .first();
      gateId = await ctx.db.insert("gates", {
        ...(latestRun ? { runId: latestRun._id } : {}),
        projectId: project._id,
        pr: args.pr,
        verdict: "pending",
        ...patch,
      });
    }
    await ctx.db.insert("events", {
      projectId: project._id,
      at: now,
      actor: args.actor,
      action: "gate.update",
      after: patch,
      evidence: `https://github.com/${args.repo}/pull/${args.pr}`,
    });
    return gateId;
  },
});
