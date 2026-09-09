import type { Doc } from "@/convex/_generated/dataModel";

export type StationState = "idle" | "done" | "running" | "hold" | "stop";

export type Station = {
  key: string;
  label: string;
  short: string;
  state: StationState;
  /** The one number that matters at this station, if any. */
  figure?: string;
};

type ProjectSpec = { phases?: Array<{ title: string }> };

/** Stations on the line, in order (design §4.12 principle 1). */
export function stationsFor(
  project: Doc<"projects">,
  opts: { reviewScore?: number | null; lastRunStage?: Doc<"runs">["stage"] } = {},
): Station[] {
  const phases = ((project.spec as ProjectSpec).phases ?? []).length || 1;
  const keys: Array<{ key: string; label: string; short: string }> = [
    { key: "genesis", label: "Genesis", short: "G" },
    ...Array.from({ length: phases }, (_, i) => ({ key: `build-${i}`, label: `Build ${i + 1}`, short: `B${i + 1}` })),
    { key: "assess", label: "Assess", short: "A" },
    { key: "fix", label: "Fix", short: "F" },
    { key: "review", label: "Review", short: "R" },
    { key: "deploy", label: "Deploy", short: "D" },
    { key: "handoff", label: "Handoff", short: "H" },
    { key: "maintain", label: "Maintain", short: "M" },
  ];
  const stage = project.stage === "NEEDS_HUMAN" ? (opts.lastRunStage ?? "GENESIS") : project.stage;
  const currentKey: string | null =
    stage === "DRAFT" ? null
    : stage === "GENESIS" ? "genesis"
    : stage === "BUILD" ? `build-${project.phaseIndex}`
    : stage === "ASSESS" ? "assess"
    : stage === "FIX" ? "fix"
    : stage === "REVIEW_LOOP" ? "review"
    : stage === "DEPLOY_DEV" ? "deploy"
    : stage === "HANDOFF" ? "handoff"
    : stage === "MAINTAIN" || stage === "TRIAGE" ? "maintain"
    : null;
  const currentIndex = currentKey ? keys.findIndex((k) => k.key === currentKey) : -1;
  const currentState: StationState =
    project.stage === "NEEDS_HUMAN" ? "stop" : project.stage === "REVIEW_LOOP" ? "hold" : "running";
  return keys.map((k, i) => {
    let state: StationState = "idle";
    if (currentIndex >= 0) {
      if (i < currentIndex) state = "done";
      else if (i === currentIndex) state = currentState;
    }
    if (project.stage === "MAINTAIN" && k.key !== "maintain") state = "done";
    let figure: string | undefined;
    if (k.key === "review" && opts.reviewScore !== undefined && opts.reviewScore !== null) figure = `${opts.reviewScore}/5`;
    if (k.key.startsWith("build-") && i === currentIndex) figure = `phase ${project.phaseIndex + 1}`;
    return { ...k, state, ...(figure === undefined ? {} : { figure }) };
  });
}

/** Elapsed time in a short human form. */
export function elapsed(sinceMs: number, nowMs = Date.now()): string {
  const s = Math.max(0, Math.floor((nowMs - sinceMs) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d`;
}
