import { minimatch } from "minimatch";

/**
 * Forced-gray classifier (design §4.9). A change is staged for a human regardless of mode when
 * it touches a sensitive path, changes dependencies, or triage marked it. Pure function so it can
 * run in a Convex mutation or a test.
 *
 * A dependency change is the exception that can clear itself: when the bridge has verified the
 * lockfile against the supply-chain cooldown (every new package version public for 7 days, 14 for
 * a major -- the product template's own policy), the dependency files no longer force gray, by
 * name or by path. A failed or missing check leaves them forced, with the reasons.
 */
export type ForcedGrayInput = {
  changedPaths: readonly string[];
  forcedGrayPaths: readonly string[];
  labels?: readonly string[];
  triageRisk?: "low" | "medium" | "high";
  dependencyCooldown?: { ok: boolean; checked: number; violations: readonly string[] };
};

export type ForcedGrayResult = {
  forced: boolean;
  reasons: string[];
};

const DEPENDENCY_FILES = new Set(["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"]);

export function classifyForcedGray(input: ForcedGrayInput): ForcedGrayResult {
  const reasons: string[] = [];

  const cooled = input.dependencyCooldown?.ok === true;
  for (const path of input.changedPaths) {
    const dependencyFile = DEPENDENCY_FILES.has(path.split("/").pop() ?? path);
    if (dependencyFile && cooled) {
      continue;
    }
    const pattern = input.forcedGrayPaths.find((glob) => minimatch(path, glob, { dot: true, matchBase: false }));
    if (pattern) {
      reasons.push(`path ${path} matches ${pattern}`);
    }
    if (dependencyFile) {
      reasons.push(`dependency change in ${path}`);
    }
  }
  for (const violation of input.dependencyCooldown?.violations ?? []) {
    reasons.push(`cooldown: ${violation}`);
  }

  if (input.labels?.includes("factory:forced-gray")) {
    reasons.push("label factory:forced-gray");
  }
  if (input.labels?.includes("factory:security-finding")) {
    reasons.push("label factory:security-finding");
  }
  if (input.triageRisk === "high") {
    reasons.push("triage risk high");
  }

  return { forced: reasons.length > 0, reasons: Array.from(new Set(reasons)) };
}

/**
 * Whether the control plane may apply `machinist:auto-merge` itself.
 * Only in dark mode, only when nothing forced gray, and only when every gate passed.
 */
export function mayAutoMerge(args: {
  mode: "dark" | "gray";
  forcedGray: ForcedGrayResult;
  gateVerdict: "pending" | "pass" | "fail";
}): boolean {
  return args.mode === "dark" && !args.forcedGray.forced && args.gateVerdict === "pass";
}
