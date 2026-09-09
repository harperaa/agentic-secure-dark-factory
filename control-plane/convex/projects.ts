import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireOperator } from "./lib/factoryAuth";
import { modeValidator, providerProfileValidator } from "./factoryTables";

/** Floor: every project with its station state. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    return ctx.db.query("projects").order("desc").collect();
  },
});

export const get = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    await requireOperator(ctx);
    return ctx.db.get(projectId);
  },
});

/** Spec screen: create a project from a validated factory-spec document (DRAFT). */
export const createFromSpec = mutation({
  args: { spec: v.any() },
  handler: async (ctx, { spec }) => {
    const actor = await requireOperator(ctx);
    const s = spec as {
      name: string;
      mode: "dark" | "gray";
      greptile_threshold: number;
      max_repair_rounds: number;
      forced_gray_paths: string[];
      providers: { profile: "default" | "eu"; sandbox: string } & Record<string, string | undefined>;
    };
    const existing = await ctx.db
      .query("projects")
      .withIndex("by_name", (q) => q.eq("name", s.name))
      .unique();
    if (existing) {
      throw new Error(`project ${s.name} already exists`);
    }
    const now = Date.now();
    const providers = providerProfileValidator;
    void providers;
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
        ...(s.providers.hosting === undefined ? {} : { hosting: s.providers.hosting }),
        ...(s.providers.identity === undefined ? {} : { identity: s.providers.identity }),
        ...(s.providers.secrets === undefined ? {} : { secrets: s.providers.secrets }),
        ...(s.providers.backend === undefined ? {} : { backend: s.providers.backend }),
        ...(s.providers.payments === undefined ? {} : { payments: s.providers.payments }),
        ...(s.providers.llm === undefined ? {} : { llm: s.providers.llm }),
        ...(s.providers.review === undefined ? {} : { review: s.providers.review }),
        ...(s.providers.scm === undefined ? {} : { scm: s.providers.scm }),
      },
      stage: "DRAFT",
      phaseIndex: 0,
      createdBy: actor,
      updatedAt: now,
    });
    await ctx.db.insert("events", {
      projectId,
      at: now,
      actor,
      action: "project.create",
      after: { name: s.name, mode: s.mode },
    });
    return projectId;
  },
});

/** "Start the line": DRAFT → GENESIS by enqueueing the genesis run. */
export const startLine = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const actor = await requireOperator(ctx);
    const project = await ctx.db.get(projectId);
    if (!project) {
      throw new Error("no such project");
    }
    if (project.stage !== "DRAFT") {
      throw new Error(`project is at ${project.stage}, not DRAFT`);
    }
    const now = Date.now();
    await ctx.db.patch(projectId, { stage: "GENESIS", updatedAt: now });
    const runId = await ctx.db.insert("runs", {
      projectId,
      stage: "GENESIS",
      command: "genesis",
      repository: process.env.FACTORY_WORKSPACE_REPOSITORY ?? "factory-workspace",
      prompt: JSON.stringify(project.spec),
      state: "queued",
      attempt: 1,
      queuedAt: now,
    });
    await ctx.db.insert("events", {
      projectId,
      runId,
      at: now,
      actor,
      action: "stage.transition",
      before: { stage: "DRAFT" },
      after: { stage: "GENESIS" },
    });
    return runId;
  },
});

/** Settings: change mode. Dark requires the checklist decision to exist (design dark-mode checklist). */
export const setMode = mutation({
  args: { projectId: v.id("projects"), mode: modeValidator, note: v.optional(v.string()) },
  handler: async (ctx, { projectId, mode, note }) => {
    const actor = await requireOperator(ctx);
    const project = await ctx.db.get(projectId);
    if (!project) {
      throw new Error("no such project");
    }
    if (mode === "dark") {
      const checklist = await ctx.db
        .query("decisions")
        .withIndex("by_project_status", (q) => q.eq("projectId", projectId).eq("status", "resolved"))
        .filter((q) => q.eq(q.field("kind"), "provision"))
        .first();
      if (!checklist) {
        throw new Error("dark mode requires the dark-mode checklist decision to be resolved first");
      }
    }
    const now = Date.now();
    await ctx.db.patch(projectId, { mode, updatedAt: now });
    await ctx.db.insert("events", {
      projectId,
      at: now,
      actor,
      action: "mode.set",
      before: { mode: project.mode },
      after: { mode },
      ...(note === undefined ? {} : { note }),
    });
  },
});
