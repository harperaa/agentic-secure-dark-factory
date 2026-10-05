import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { modeValidator } from "./factoryTables";
import { requireOperator } from "./lib/factoryAuth";
import { readFactorySettings } from "./lib/factorySettings";

/**
 * Deployment configuration the factory depends on, reported as set or not set. Values are never
 * returned: the operator needs to know what is missing, not what the secret is.
 */
const INTEGRATIONS: Array<{ key: string; label: string; purpose: string }> = [
  { key: "ADMIN_EMAIL", label: "Operator", purpose: "Who may operate the factory." },
  { key: "FACTORY_BRIDGE_SECRET", label: "Bridge", purpose: "Lets the worker-machine bridge talk to the control plane." },
  { key: "FACTORY_WORKSPACE_REPOSITORY", label: "Workspace repository", purpose: "Where genesis runs are executed." },
  { key: "MACHINIST_REQUEST_LABEL", label: "Request label", purpose: "Issue label that sends maintenance work to triage." },
  { key: "GITHUB_WEBHOOK_SECRET", label: "GitHub webhook", purpose: "Verifies CI, review, and issue events from GitHub." },
  { key: "GREPTILE_BOT_LOGIN", label: "Reviewer bot", purpose: "Whose review scores the gate counts." },
  { key: "ALERT_WEBHOOK_URL", label: "Alerts", purpose: "Slack-compatible webhook for stops and decisions; without it the Floor is the alert." },
  { key: "ANTHROPIC_API_KEY", label: "Spec chat", purpose: "Drafts specs from conversation on the Spec screen." },
];

/** Factory settings plus which integrations are configured. */
export const get = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    const settings = await readFactorySettings(ctx);
    const integrations = INTEGRATIONS.map(({ key, label, purpose }) => ({ key, label, purpose, configured: Boolean(process.env[key]) }));
    return { settings, integrations };
  },
});

/** Save factory settings. Every change is an audit event with the before and after. */
export const update = mutation({
  args: {
    mode: modeValidator,
    greptileThreshold: v.number(),
    maxRepairRounds: v.number(),
    forcedGrayPaths: v.array(v.string()),
    providerProfile: v.union(v.literal("default"), v.literal("eu")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { note, ...next }) => {
    const actor = await requireOperator(ctx);
    if (!Number.isInteger(next.greptileThreshold) || next.greptileThreshold < 0 || next.greptileThreshold > 5) {
      throw new Error("review threshold must be a whole number from 0 to 5");
    }
    if (!Number.isInteger(next.maxRepairRounds) || next.maxRepairRounds < 0 || next.maxRepairRounds > 20) {
      throw new Error("repair rounds must be a whole number from 0 to 20");
    }
    const forcedGrayPaths = Array.from(new Set(next.forcedGrayPaths.map((p) => p.trim()).filter(Boolean)));
    if (forcedGrayPaths.length === 0) {
      throw new Error("keep at least one forced-gray path: they are what holds auth, payments, and CI changes for a human");
    }
    const settings = { ...next, forcedGrayPaths };

    const { saved, ...before } = await readFactorySettings(ctx);
    void saved;
    const now = Date.now();
    const row = await ctx.db.query("factorySettings").first();
    if (row) {
      await ctx.db.patch(row._id, { ...settings, updatedAt: now });
    } else {
      await ctx.db.insert("factorySettings", { ...settings, updatedAt: now });
    }
    await ctx.db.insert("events", {
      at: now,
      actor,
      action: before.mode === settings.mode ? "factory.settings" : "factory.mode.set",
      before,
      after: settings,
      ...(note === undefined ? {} : { note }),
    });
  },
});
