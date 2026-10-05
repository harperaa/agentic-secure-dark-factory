import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export type FactorySettings = Omit<Doc<"factorySettings">, "_id" | "_creationTime" | "updatedAt">;

/**
 * What the factory runs with before the operator first saves settings. These match the spec
 * defaults the Spec screen and spec chat used before factory settings existed, and `mode: "dark"`
 * leaves every project's own mode in force, so introducing the table changes nothing on the line.
 */
export const DEFAULT_FACTORY_SETTINGS: FactorySettings = {
  mode: "dark",
  greptileThreshold: 5,
  maxRepairRounds: 4,
  forcedGrayPaths: ["middleware.ts", "convex/auth*", "app/api/**", "lib/security/**", "package.json", "package-lock.json"],
  providerProfile: "default",
};

export async function readFactorySettings(ctx: QueryCtx | MutationCtx): Promise<FactorySettings & { saved: boolean }> {
  const row = await ctx.db.query("factorySettings").first();
  if (!row) {
    return { ...DEFAULT_FACTORY_SETTINGS, saved: false };
  }
  const { _id, _creationTime, updatedAt, ...settings } = row;
  void _id;
  void _creationTime;
  void updatedAt;
  return { ...settings, saved: true };
}

/**
 * The mode a project actually runs in. Factory gray is the master switch: nothing merges without
 * a human anywhere. Factory dark lets each project's own mode (and its checklist) decide.
 */
export function effectiveMode(factoryMode: "dark" | "gray", projectMode: "dark" | "gray"): "dark" | "gray" {
  return factoryMode === "gray" ? "gray" : projectMode;
}
