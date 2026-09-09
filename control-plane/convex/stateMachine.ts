import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

/**
 * Stage state machine (design §4.3, §11). Every transition is an `events` row. Every stage is
 * exactly one Machinist run; a failed run is retried once, then stops as NEEDS_HUMAN with a
 * decision the operator can act on.
 */

type Project = Doc<"projects">;

function parseResultLine(line: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!line) {
    return out;
  }
  for (const token of line.split(/\s+/).slice(1)) {
    const eq = token.indexOf("=");
    if (eq > 0) {
      out[token.slice(0, eq)] = token.slice(eq + 1);
    }
  }
  return out;
}

async function transition(ctx: MutationCtx, project: Project, stage: Project["stage"], runId?: Id<"runs">, extra?: Record<string, unknown>) {
  const now = Date.now();
  await ctx.db.patch(project._id, { stage, updatedAt: now });
  await ctx.db.insert("events", {
    projectId: project._id,
    ...(runId === undefined ? {} : { runId }),
    at: now,
    actor: "system",
    action: "stage.transition",
    before: { stage: project.stage },
    after: { stage, ...(extra ?? {}) },
  });
}

async function enqueue(ctx: MutationCtx, project: Project, stage: Project["stage"], command: string, prompt: string, ref?: string, attempt = 1) {
  const now = Date.now();
  return ctx.db.insert("runs", {
    projectId: project._id,
    stage,
    command,
    repository: stage === "GENESIS" ? (process.env.FACTORY_WORKSPACE_REPOSITORY ?? "factory-workspace") : project.name,
    prompt,
    state: "queued",
    attempt,
    queuedAt: now,
    ...(ref === undefined ? {} : { ref }),
  });
}

async function stop(ctx: MutationCtx, project: Project, run: Doc<"runs">, title: string, kind: "unblock" | "provision" | "accept-finding" = "unblock") {
  await transition(ctx, project, "NEEDS_HUMAN", run._id, { reason: title });
  await ctx.scheduler.runAfter(0, internal.alerts.notify, { title: `${project.name}: stopped`, text: title, ...(run.ref ? { url: run.ref } : {}) });
  await ctx.db.insert("decisions", {
    projectId: project._id,
    runId: run._id,
    kind,
    title,
    evidence: [
      ...(run.ref ? [{ label: "Work item", url: run.ref }] : []),
      ...(project.repo ? [{ label: "Repository", url: `https://github.com/${project.repo}` }] : []),
    ],
    status: "open",
    createdAt: Date.now(),
  });
}

const spec = (project: Project) => project.spec as { phases: Array<{ title: string }>; assessment?: { deepsec?: string; max_new_medium?: number; baseline_path?: string } };

export const onRunCompleted = internalMutation({
  args: { runId: v.id("runs"), pr: v.optional(v.number()) },
  handler: async (ctx, { runId, pr }) => {
    const run = await ctx.db.get(runId);
    if (!run) {
      return;
    }
    const project = await ctx.db.get(run.projectId);
    if (!project) {
      return;
    }
    const result = parseResultLine(run.resultLine);

    // A run that completes after the project already left its stage (a duplicate retry, a
    // resubmission) must not drive transitions twice. Record it and stop.
    if (run.stage !== project.stage && !(run.stage === "BUILD" && project.stage === "REVIEW_LOOP") && !(run.stage === "MAINTAIN" && project.stage === "REVIEW_LOOP")) {
      await ctx.db.insert("events", { projectId: project._id, runId, at: Date.now(), actor: "system", action: "run.stale", after: { runStage: run.stage, projectStage: project.stage } });
      return;
    }

    // Failure handling (design §11): one automatic retry, then NEEDS_HUMAN.
    if (run.state !== "succeeded") {
      const credential = /credential|MISSING_ENV|auth/i.test(run.error ?? run.resultLine ?? "");
      if (run.attempt < 2 && !credential) {
        await enqueue(ctx, project, run.stage, run.command, run.prompt, run.ref, run.attempt + 1);
        await ctx.db.insert("events", { projectId: project._id, runId, at: Date.now(), actor: "system", action: "run.retry", after: { attempt: run.attempt + 1 } });
        return;
      }
      await stop(ctx, project, run, `${run.stage} stopped: ${run.error ?? result["reason"] ?? "run failed"}`);
      return;
    }

    switch (run.stage) {
      case "GENESIS": {
        await ctx.db.patch(project._id, {
          ...(result["repo"] === undefined ? {} : { repo: result["repo"] }),
          ...(result["url"] === undefined ? {} : { devUrl: result["url"] }),
          ...(result["clerk_claim_url"] === undefined ? {} : { clerkClaimUrl: result["clerk_claim_url"] }),
          updatedAt: Date.now(),
        });
        // Register the product with the worker, then create phase issues; the effect chain
        // continues in onEffectDone.
        await ctx.db.insert("effects", {
          projectId: project._id,
          kind: "register-repository",
          args: { name: project.name },
          status: "queued",
          createdAt: Date.now(),
        });
        await transition(ctx, project, "BUILD", runId, { phase: 1 });
        return;
      }
      case "BUILD":
      case "FIX": {
        // Foreman handed off a PR (ready-for-review). Wait for the gates.
        const fresh = (await ctx.db.get(project._id)) as Project;
        await ctx.db.patch(project._id, { ...(pr === undefined ? {} : { currentPr: pr }), repairRound: 0, updatedAt: Date.now() });
        await transition(ctx, fresh, "REVIEW_LOOP", runId, { pr: pr ?? null });
        await ctx.scheduler.runAfter(60_000, internal.gates.evaluate, { projectId: project._id });
        return;
      }
      case "REVIEW_LOOP": {
        // greptile-fix pushed; the reviewer's next verdict arrives by webhook, evaluate later.
        await ctx.scheduler.runAfter(120_000, internal.gates.evaluate, { projectId: project._id });
        return;
      }
      case "ASSESS": {
        const gate = result["gate"];
        await ctx.db.patch(project._id, { lastAssessmentAt: Date.now(), updatedAt: Date.now() });
        if (gate === "pass") {
          await transition(ctx, project, "DEPLOY_DEV", runId);
          await enqueue(ctx, project, "DEPLOY_DEV", "dev", JSON.stringify({ name: project.name, github_owner: project.repo?.split("/")[0], vercel_scope: process.env.VERCEL_SCOPE, admin_email: (project.spec as { admin_email: string }).admin_email }));
        } else {
          // Findings became issues labelled factory:security-finding; the operator decides which to fix.
          await stop(ctx, project, run, `Assessment found new findings: critical=${result["new_critical"]} high=${result["new_high"]} medium=${result["new_medium"]}`, "accept-finding");
        }
        return;
      }
      case "DEPLOY_DEV": {
        await ctx.db.patch(project._id, { ...(result["url"] === undefined ? {} : { devUrl: result["url"] }), updatedAt: Date.now() });
        await transition(ctx, project, "HANDOFF", runId, { url: result["url"] ?? null });
        const fresh = (await ctx.db.get(project._id)) as Project;
        await transition(ctx, fresh, "MAINTAIN", runId);
        return;
      }
      case "TRIAGE": {
        // TRIAGE ref=<url> kind=<kind> risk=<risk> forced_gray=<yes|no> action=<request|needs-human|ignore>
        if (result["action"] === "request" && run.ref) {
          await enqueue(ctx, project, "MAINTAIN", "foreman", `Implement ${run.ref}`, run.ref);
        }
        return;
      }
      case "MAINTAIN": {
        const fresh = (await ctx.db.get(project._id)) as Project;
        await ctx.db.patch(project._id, { ...(pr === undefined ? {} : { currentPr: pr }), repairRound: 0, updatedAt: Date.now() });
        await transition(ctx, fresh, "REVIEW_LOOP", runId, { pr: pr ?? null, from: "MAINTAIN" });
        await ctx.scheduler.runAfter(60_000, internal.gates.evaluate, { projectId: project._id });
        return;
      }
      default:
        return;
    }
  },
});

/** Effects the bridge completed that continue the line. */
export const onEffectDone = internalMutation({
  args: { effectId: v.id("effects") },
  handler: async (ctx, { effectId }) => {
    const effect = await ctx.db.get(effectId);
    if (!effect) {
      return;
    }
    const project = await ctx.db.get(effect.projectId);
    if (!project) {
      return;
    }
    if (effect.kind === "register-repository") {
      await ctx.db.insert("effects", {
        projectId: project._id,
        kind: "create-phase-issues",
        args: { spec: project.spec },
        status: "queued",
        createdAt: Date.now(),
      });
      return;
    }
    if (effect.kind === "create-phase-issues") {
      const issues = (effect.result as { issues?: string[] } | undefined)?.issues ?? [];
      await ctx.db.patch(project._id, { phaseIssues: issues, phaseIndex: 0, updatedAt: Date.now() });
      const first = issues[0];
      if (first) {
        await enqueue(ctx, project, "BUILD", "foreman", `Implement ${first}`, first);
      }
    }
  },
});

/** A pull request merged: next phase, or the full assessment after the last one (design §4.3). */
export const onPullRequestMerged = internalMutation({
  args: { repo: v.string(), pr: v.number() },
  handler: async (ctx, { repo, pr }) => {
    const project = await ctx.db.query("projects").withIndex("by_repo", (q) => q.eq("repo", repo)).unique();
    if (!project || project.currentPr !== pr) {
      return;
    }
    const now = Date.now();
    await ctx.db.insert("events", { projectId: project._id, at: now, actor: "webhook:github", action: "pr.merged", after: { pr }, evidence: `https://github.com/${repo}/pull/${pr}` });
    if (project.stage !== "REVIEW_LOOP") {
      return;
    }
    const phases = spec(project).phases;
    const nextIndex = project.phaseIndex + 1;
    const issues = project.phaseIssues ?? [];
    if (nextIndex < phases.length && issues[nextIndex]) {
      await ctx.db.patch(project._id, { phaseIndex: nextIndex, currentPr: undefined, updatedAt: now });
      await transition(ctx, project, "BUILD", undefined, { phase: nextIndex + 1 });
      await enqueue(ctx, project, "BUILD", "foreman", `Implement ${issues[nextIndex]}`, issues[nextIndex]);
      return;
    }
    if (project.lastAssessmentAt === undefined) {
      const a = spec(project).assessment ?? {};
      await transition(ctx, project, "ASSESS", undefined, { mode: "fresh" });
      await enqueue(ctx, project, "ASSESS", "assess", `--mode=fresh --deepsec=${a.deepsec ?? "auto"} --baseline=${a.baseline_path ?? "security_context/accepted.json"} --max-new-medium=${a.max_new_medium ?? 0}`);
      return;
    }
    // Maintenance merge: Vercel's git integration deploys main; stay in MAINTAIN.
    await ctx.db.patch(project._id, { currentPr: undefined, updatedAt: now });
    await transition(ctx, project, "MAINTAIN");
  },
});

/** GitHub issue opened (maintenance intake): triage it. */
export const onIssueOpened = internalMutation({
  args: { repo: v.string(), url: v.string() },
  handler: async (ctx, { repo, url }) => {
    const project = await ctx.db.query("projects").withIndex("by_repo", (q) => q.eq("repo", repo)).unique();
    if (!project || project.stage !== "MAINTAIN") {
      return;
    }
    const requestLabel = process.env.MACHINIST_REQUEST_LABEL;
    if (!requestLabel) {
      throw new Error("MISSING_ENV MACHINIST_REQUEST_LABEL");
    }
    await enqueue(ctx, project, "TRIAGE", "triage", `--ref=${url} --mode=${project.mode} --forced-gray-paths=${project.forcedGrayPaths.join(",")} --request-label=${requestLabel}`, url);
  },
});

/** A major release (tag matching the project's release policy, or the release label) re-runs the full assessment. */
export const onRelease = internalMutation({
  args: { repo: v.string(), tag: v.string(), labels: v.optional(v.array(v.string())) },
  handler: async (ctx, { repo, tag, labels }) => {
    const project = await ctx.db.query("projects").withIndex("by_repo", (q) => q.eq("repo", repo)).unique();
    if (!project || project.stage !== "MAINTAIN") {
      return;
    }
    const policy = (project.spec as { release_policy?: { major_tag_pattern?: string; label?: string } }).release_policy ?? {};
    const pattern = new RegExp(policy.major_tag_pattern ?? "^v[0-9]+\\.0\\.0$");
    const isMajor = pattern.test(tag) || (labels ?? []).includes(policy.label ?? "release:major");
    if (!isMajor) {
      return;
    }
    const a = spec(project).assessment ?? {};
    await transition(ctx, project, "ASSESS", undefined, { mode: "reassessment", tag });
    await enqueue(ctx, project, "ASSESS", "assess", `--mode=reassessment --deepsec=${a.deepsec ?? "auto"} --baseline=${a.baseline_path ?? "security_context/accepted.json"} --max-new-medium=${a.max_new_medium ?? 0}`, `https://github.com/${repo}/releases/tag/${tag}`);
  },
});
