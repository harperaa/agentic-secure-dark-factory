import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { classifyForcedGray, mayAutoMerge } from "../factory/policy/forcedGray";

/**
 * Review-loop gate (design §4.7, §4.9). Runs after a foreman hand-off and after every reviewer or
 * check-suite webhook. Decides: pass → auto-merge (dark) or decision (gray); fail → repair round
 * or NEEDS_HUMAN at the round cap; pending → re-check later.
 */
export const evaluate = internalMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    if (!project || project.stage !== "REVIEW_LOOP" || project.currentPr === undefined || !project.repo) {
      return;
    }
    const gate = await ctx.db
      .query("gates")
      .withIndex("by_project_pr", (q) => q.eq("projectId", projectId).eq("pr", project.currentPr))
      .order("desc")
      .first();
    const now = Date.now();
    const reviewerRequired = (project.providers.review ?? "greptile") !== "none";
    const ciConclusions = gate?.ci?.map((c) => c.conclusion) ?? [];
    const ciFailed = ciConclusions.some((c) => c === "failure" || c === "timed_out" || c === "cancelled");
    const ciPassed = ciConclusions.length > 0 && ciConclusions.every((c) => c === "success" || c === "neutral" || c === "skipped");
    const review = gate?.review;
    const forcedGray = gate?.forcedGray ?? { forced: false, reasons: [] };
    // No AI reviewer means no independent review: never auto-merge, whatever the mode.
    const forced = forcedGray.forced || !reviewerRequired;
    if (!reviewerRequired && !forcedGray.reasons.includes("no reviewer configured")) {
      forcedGray.reasons = [...forcedGray.reasons, "no reviewer configured"];
    }

    const open = await ctx.db
      .query("decisions")
      .withIndex("by_project_status", (q) => q.eq("projectId", projectId).eq("status", "open"))
      .first();
    if (open) {
      return; // waiting on the operator
    }

    // A CI failure is a verdict on its own; do not wait for the reviewer to confirm it.
    const waitingOnReviewer = !ciFailed && reviewerRequired && (review === undefined || review.score === null);
    // Pending: no CI verdict yet, or reviewer has not spoken.
    if ((!ciPassed && !ciFailed) || waitingOnReviewer) {
      const waited = now - (gate?.updatedAt ?? project.updatedAt);
      if (waited > 20 * 60_000) {
        await ctx.db.insert("decisions", {
          projectId,
          kind: "unblock",
          title: waitingOnReviewer
            ? `The reviewer has not reviewed PR #${project.currentPr} after 20 minutes. Re-check, or send back to fix.`
            : `CI has not reported on PR #${project.currentPr} after 20 minutes.`,
          evidence: [{ label: `PR #${project.currentPr}`, url: `https://github.com/${project.repo}/pull/${project.currentPr}` }],
          status: "open",
          createdAt: now,
        });
        return;
      }
      await ctx.scheduler.runAfter(30_000, internal.gates.evaluate, { projectId });
      return;
    }

    const reviewPassed = !reviewerRequired || (review !== undefined && review.score !== null && review.score >= project.greptileThreshold && review.unresolvedComments === 0);
    const verdict: "pass" | "fail" = ciPassed && reviewPassed ? "pass" : "fail";
    if (gate) {
      await ctx.db.patch(gate._id, { verdict, forcedGray: { forced, reasons: forcedGray.reasons }, updatedAt: now });
    }
    await ctx.db.insert("events", { projectId, at: now, actor: "system", action: "gate.verdict", after: { verdict, ci: ciPassed, review: review?.score ?? null, forced } });

    if (verdict === "pass") {
      if (mayAutoMerge({ mode: project.mode, forcedGray: { forced, reasons: forcedGray.reasons }, gateVerdict: "pass" })) {
        await ctx.db.insert("effects", {
          projectId,
          kind: "apply-label",
          args: { repo: project.repo, number: project.currentPr, label: "machinist:auto-merge" },
          status: "queued",
          createdAt: now,
        });
        await ctx.db.insert("events", { projectId, at: now, actor: "system", action: "decision.auto-merge", after: { pr: project.currentPr, mode: "dark" } });
      } else {
        await ctx.db.insert("decisions", {
          projectId,
          kind: "apply-auto-merge",
          title: `Merge PR #${project.currentPr} into main?`,
          evidence: [
            { label: `PR #${project.currentPr}`, url: `https://github.com/${project.repo}/pull/${project.currentPr}` },
            ...(review ? [{ label: `Reviewer score ${review.score}/5, ${review.unresolvedComments} unresolved`, url: `https://github.com/${project.repo}/pull/${project.currentPr}` }] : []),
            ...(forced ? [{ label: `Forced gray: ${forcedGray.reasons.join("; ") || "policy"}`, url: `https://github.com/${project.repo}/pull/${project.currentPr}/files` }] : []),
          ],
          status: "open",
          createdAt: now,
        });
      }
      return;
    }

    // Fail: repair round or stop.
    const round = (project.repairRound ?? 0) + 1;
    if (round > project.maxRepairRounds || ciFailed) {
      await ctx.db.patch(projectId, { stage: "NEEDS_HUMAN", updatedAt: now });
      await ctx.scheduler.runAfter(0, internal.alerts.notify, {
        title: `${project.name}: stopped`,
        text: ciFailed ? `CI failed on PR #${project.currentPr}` : `PR #${project.currentPr} did not reach ${project.greptileThreshold}/5 after ${project.maxRepairRounds} rounds`,
        url: `https://github.com/${project.repo}/pull/${project.currentPr}`,
      });
      await ctx.db.insert("decisions", {
        projectId,
        kind: "unblock",
        title: ciFailed
          ? `CI failed on PR #${project.currentPr}. Fix it, then unblock.`
          : `PR #${project.currentPr} did not reach ${project.greptileThreshold}/5 after ${project.maxRepairRounds} repair rounds.`,
        evidence: [{ label: `PR #${project.currentPr}`, url: `https://github.com/${project.repo}/pull/${project.currentPr}` }],
        status: "open",
        createdAt: now,
      });
      return;
    }
    await ctx.db.patch(projectId, { repairRound: round, updatedAt: now });
    const bot = process.env.GREPTILE_BOT_LOGIN;
    if (!bot) {
      throw new Error("MISSING_ENV GREPTILE_BOT_LOGIN");
    }
    await ctx.db.insert("runs", {
      projectId,
      stage: "REVIEW_LOOP",
      command: "greptile-fix",
      repository: project.name,
      prompt: `--pr=https://github.com/${project.repo}/pull/${project.currentPr} --round=${round} --threshold=${project.greptileThreshold} --bot=${bot}`,
      state: "queued",
      attempt: 1,
      queuedAt: now,
      ref: `https://github.com/${project.repo}/pull/${project.currentPr}`,
    });
  },
});

/** Webhook entry point: find the project by repository and evaluate. */
export const evaluateForRepo = internalMutation({
  args: { repo: v.string() },
  handler: async (ctx, { repo }) => {
    const project = await ctx.db.query("projects").withIndex("by_repo", (q) => q.eq("repo", repo)).unique();
    if (project) {
      await ctx.scheduler.runAfter(0, internal.gates.evaluate, { projectId: project._id });
    }
  },
});

/** Forced-gray classification from the bridge's observed changed paths and labels. */
export const classify = internalMutation({
  args: { projectId: v.id("projects"), pr: v.number(), changedPaths: v.array(v.string()), labels: v.array(v.string()) },
  handler: async (ctx, { projectId, pr, changedPaths, labels }) => {
    const project = await ctx.db.get(projectId);
    if (!project) {
      return;
    }
    const gate = await ctx.db
      .query("gates")
      .withIndex("by_project_pr", (q) => q.eq("projectId", projectId).eq("pr", pr))
      .order("desc")
      .first();
    if (!gate) {
      return;
    }
    const result = classifyForcedGray({ changedPaths, forcedGrayPaths: project.forcedGrayPaths, labels });
    await ctx.db.patch(gate._id, { forcedGray: result, updatedAt: Date.now() });
  },
});
