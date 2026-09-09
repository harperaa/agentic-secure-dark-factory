import type { Doc } from "@/convex/_generated/dataModel";

/** Operator-facing names for stages (design §4.12 copy rules). */
export function stageCopy(project: Pick<Doc<"projects">, "stage" | "phaseIndex">): string {
  switch (project.stage) {
    case "DRAFT":
      return "Not started";
    case "GENESIS":
      return "Creating the product";
    case "BUILD":
      return `Building phase ${project.phaseIndex + 1}`;
    case "ASSESS":
      return "Assessing";
    case "FIX":
      return "Fixing findings";
    case "REVIEW_LOOP":
      return "Waiting for review";
    case "DEPLOY_DEV":
      return "Deploying";
    case "HANDOFF":
      return "Handed off";
    case "MAINTAIN":
      return "Maintaining";
    case "TRIAGE":
      return "Triaging";
    case "NEEDS_HUMAN":
      return "Stopped: needs a decision";
    default:
      return String(project.stage);
  }
}

export function runStateCopy(state: Doc<"runs">["state"]): string {
  switch (state) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "succeeded":
      return "Passed";
    case "failed":
      return "Failed";
    case "timed_out":
      return "Timed out";
    case "cancelled":
      return "Cancelled";
    default:
      return String(state);
  }
}

export function decisionActions(kind: Doc<"decisions">["kind"]): { primary: string; secondary: string } {
  switch (kind) {
    case "apply-auto-merge":
      return { primary: "Apply auto-merge", secondary: "Send back to fix" };
    case "accept-finding":
      return { primary: "Mark as accepted finding", secondary: "Keep it open" };
    case "unblock":
      return { primary: "Retry the stage", secondary: "Leave stopped" };
    case "provision":
      return { primary: "Mark as provisioned", secondary: "Not yet" };
    case "send-back":
      return { primary: "Send back", secondary: "Keep" };
    default:
      return { primary: "Confirm", secondary: "Dismiss" };
  }
}

/** Message for an error thrown by a Convex function, in the operator's words. */
export function errorCopy(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/not the operator/.test(message)) {
    return "You are signed in, but not as this factory's operator. Sign in with the operator account.";
  }
  if (/not signed in/.test(message)) {
    return "Sign in to see the floor.";
  }
  if (/MISSING_ENV/.test(message)) {
    return `The control plane is missing configuration: ${message.replace(/.*MISSING_ENV\s*/, "")}. Set it on the Convex deployment.`;
  }
  if (/checklist/.test(message)) {
    return "Dark mode needs the dark-mode checklist decision resolved first. Resolve it under Decisions, then try again.";
  }
  return message.replace(/^.*Uncaught Error:\s*/, "").replace(/\s+at [\s\S]*$/, "");
}
