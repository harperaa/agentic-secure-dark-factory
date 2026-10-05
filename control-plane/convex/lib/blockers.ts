import type { Doc } from "../_generated/dataModel";

type Evidence = { label: string; url: string };

const FAILED = new Set(["failure", "timed_out", "cancelled"]);
const DONE = new Set(["success", "neutral", "skipped", ...FAILED]);

/**
 * What is holding a pull request, in plain language, for a decision's `detail` (design §4.12).
 * The title says what is asked; these lines say why, so the operator can act without opening the
 * PR: which required checks failed, the score against the threshold, the reviewer's own reason,
 * what forces a human merge, and how many repair rounds the factory has already spent.
 */
export function describeGate(project: Doc<"projects">, gate: Doc<"gates"> | null, forcedReasons: string[]): { detail: string[]; evidence: Evidence[] } {
  const prUrl = `https://github.com/${project.repo}/pull/${project.currentPr}`;
  const detail: string[] = [];
  const evidence: Evidence[] = [{ label: `PR #${project.currentPr}`, url: prUrl }];

  // One entry per check name: older gate rows may hold the same check from two workflow runs.
  const ci = [...new Map((gate?.ci ?? []).map((c) => [c.name, c])).values()];
  const required = ci.filter((c) => c.required === true);
  const deciding = required.length > 0 ? required : ci;
  const failed = deciding.filter((c) => FAILED.has(c.conclusion));
  const pending = deciding.filter((c) => !DONE.has(c.conclusion));
  const optionalFailed = required.length > 0 ? ci.filter((c) => c.required !== true && FAILED.has(c.conclusion)) : [];

  if (failed.length > 0) {
    detail.push(`Required check${failed.length > 1 ? "s" : ""} failed: ${failed.map((c) => c.name).join(", ")}.`);
    for (const c of failed) {
      evidence.push({ label: `Check: ${c.name} (failed)`, url: c.url ?? `${prUrl}/checks` });
    }
  }
  if (pending.length > 0) {
    detail.push(`Still waiting on: ${pending.map((c) => c.name).join(", ")}.`);
  }
  if (deciding.length === 0) {
    detail.push("No CI result has been reported for this pull request yet.");
  }
  if (optionalFailed.length > 0) {
    detail.push(`Optional checks failing (these do not block the merge): ${optionalFailed.map((c) => c.name).join(", ")}.`);
  }

  const review = gate?.review;
  if ((project.providers.review ?? "greptile") === "none") {
    detail.push("No AI reviewer is configured for this project.");
  } else if (!review || review.score === null) {
    detail.push("The reviewer has not scored the latest commit yet.");
  } else {
    detail.push(
      review.score >= project.greptileThreshold
        ? `Reviewer scored ${review.score}/5 (${project.greptileThreshold}/5 needed).`
        : `Reviewer scored ${review.score}/5; ${project.greptileThreshold}/5 is needed.`,
    );
    if (review.unresolvedComments > 0) {
      detail.push(`${review.unresolvedComments} reviewer comment${review.unresolvedComments > 1 ? "s are" : " is"} still unresolved.`);
    }
    if (review.summary) {
      detail.push(`Reviewer's verdict: ${review.summary}`);
    }
  }

  if (gate?.dependencyCooldown?.ok) {
    detail.push(`Dependency changes cleared the supply-chain cooldown: ${gate.dependencyCooldown.checked} new package version${gate.dependencyCooldown.checked === 1 ? "" : "s"}, each public at least 7 days (14 for a major).`);
  }
  if (forcedReasons.length > 0) {
    detail.push(`A human must merge this whatever the mode: ${forcedReasons.join("; ")}.`);
  }
  if ((project.repairRound ?? 0) > 0) {
    detail.push(`Repair rounds used: ${project.repairRound} of ${project.maxRepairRounds}.`);
  }
  return { detail, evidence };
}
