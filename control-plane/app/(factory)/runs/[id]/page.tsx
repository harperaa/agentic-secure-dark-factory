"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { runStateCopy, stageCopy } from "@/lib/factory/copy";
import { elapsed } from "@/lib/factory/stations";
import { Field, Panel } from "../../_components/panel";
import { useNow } from "../../_components/use-now";

/**
 * Run (design §4.12 principle 4): evidence over narration. Header, gate strip, then events on
 * the left (monospace, follows the tail) and the result and artifacts on the right.
 */
export default function RunPage() {
  const { id } = useParams<{ id: string }>();
  const data = useQuery(api.ui.run, { runId: id as Id<"runs"> });
  const now = useNow(15_000);
  const logRef = useRef<HTMLOListElement>(null);
  const eventCount = data?.events.length ?? 0;

  useEffect(() => {
    const el = logRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [eventCount]);

  if (data === undefined) {
    return <p className="text-[length:var(--text-14)] text-ink-muted">Loading…</p>;
  }
  if (data === null) {
    return (
      <p className="text-[length:var(--text-14)]">
        No such run.{" "}
        <Link href="/floor" className="factory-focus text-brass underline underline-offset-2">
          Back to the floor.
        </Link>
      </p>
    );
  }
  const { run, project, gate, events } = data;
  const prUrl = project?.repo && project.currentPr !== undefined ? `https://github.com/${project.repo}/pull/${project.currentPr}` : run.ref;

  return (
    <div className="flex flex-col gap-4">
      <header className="border-b border-rule pb-3">
        <h1 className="text-[length:var(--text-20)] font-medium">
          {project ? (
            <Link href={`/projects/${project._id}`} className="factory-focus underline-offset-2 hover:underline">
              {project.name}
            </Link>
          ) : (
            "Run"
          )}{" "}
          <span className="text-ink-muted">· {run.command}</span>
        </h1>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="Stage">{project ? stageCopy({ stage: run.stage, phaseIndex: project.phaseIndex }) : run.stage}</Field>
          <Field label="State">{runStateCopy(run.state)}</Field>
          <Field label="Runtime">{run.repository}</Field>
          <Field label="Model">{run.model ?? run.executor ?? "—"}</Field>
          <Field label="Elapsed">{run.startedAt ? elapsed(run.startedAt, run.completedAt ?? now) : "not started"}</Field>
          <Field label="Tokens">{run.tokenUsage ? `${run.tokenUsage.input.toLocaleString()} in / ${run.tokenUsage.output.toLocaleString()} out` : "—"}</Field>
        </dl>
      </header>

      <section aria-label="Gates" className="flex flex-wrap gap-2 text-[length:var(--text-14)] [font-variant-numeric:tabular-nums]">
        <GateChip label="CI" value={gate?.ci ? gate.ci.map((c) => `${c.name} ${c.conclusion}`).join(", ") : "no verdict yet"} tone={gate?.ci?.every((c) => c.conclusion === "success") ? "run" : gate?.ci?.some((c) => c.conclusion === "failure") ? "stop" : "hold"} />
        <GateChip
          label="Review"
          value={gate?.review ? `${gate.review.score ?? "—"}/5 of ${gate.review.threshold}, ${gate.review.unresolvedComments} unresolved, round ${gate.review.round}` : "no review yet"}
          tone={gate?.review && gate.review.score !== null ? (gate.review.score >= gate.review.threshold ? "run" : "stop") : "hold"}
        />
        <GateChip
          label="Assessment"
          value={gate?.assessment ? `${gate.assessment.mode}: ${gate.assessment.newCritical} critical, ${gate.assessment.newHigh} high, ${gate.assessment.newMedium} medium new` : "not run"}
          tone={gate?.assessment ? (gate.assessment.newCritical + gate.assessment.newHigh === 0 ? "run" : "stop") : "idle"}
        />
        <GateChip label="Forced gray" value={gate?.forcedGray?.forced ? gate.forcedGray.reasons.join("; ") : "no"} tone={gate?.forcedGray?.forced ? "hold" : "idle"} />
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[3fr_2fr]">
        <Panel title={`Events (${events.length})`}>
          <ol ref={logRef} role="list" className="max-h-[60vh] overflow-auto font-log text-[length:var(--text-12)] leading-5">
            {events.map((e) => (
              <li key={e._id} className="grid grid-cols-[auto_1fr] gap-x-3 border-b border-rule/50 py-0.5">
                <time dateTime={new Date(e.at).toISOString()} className="text-ink-muted">
                  {new Date(e.at).toLocaleTimeString()}
                </time>
                <span className="break-all">
                  <span className="text-ink-muted">{e.actor}</span> {e.action}
                  {e.after !== undefined && <span className="text-ink-muted"> {JSON.stringify(e.after)}</span>}
                </span>
              </li>
            ))}
            {events.length === 0 && <li className="text-ink-muted">No events yet.</li>}
          </ol>
        </Panel>
        <Panel title="Result and artifacts">
          <dl>
            <Field label="Result line">
              <code className="font-log text-[length:var(--text-12)]">{run.resultLine ?? "—"}</code>
            </Field>
            <Field label="Exit code">{run.exitCode ?? "—"}</Field>
            {run.error && <Field label="Error">{run.error}</Field>}
            <Field label="Machinist job">{run.machinistJobId ?? "—"}</Field>
            <Field label="Command hash">{run.commandHash ?? "—"}</Field>
            <Field label="Head SHA">{run.headSha ?? "—"}</Field>
            <Field label="Pull request">
              {prUrl ? (
                <a href={prUrl} target="_blank" rel="noreferrer" className="factory-focus underline underline-offset-2">
                  {prUrl.replace("https://github.com/", "")}
                </a>
              ) : (
                "—"
              )}
            </Field>
            <Field label="Dev URL">
              {project?.devUrl ? (
                <a href={project.devUrl} target="_blank" rel="noreferrer" className="factory-focus underline underline-offset-2">
                  {project.devUrl}
                </a>
              ) : (
                "—"
              )}
            </Field>
          </dl>
          <details className="mt-2 text-[length:var(--text-14)]">
            <summary className="factory-focus cursor-pointer text-ink-muted">Prompt</summary>
            <pre className="mt-1 max-h-64 overflow-auto rounded-data bg-surface p-2 font-log text-[length:var(--text-12)] whitespace-pre-wrap">{run.prompt}</pre>
          </details>
        </Panel>
      </div>
    </div>
  );
}

function GateChip({ label, value, tone }: { label: string; value: string; tone: "run" | "hold" | "stop" | "idle" }) {
  const border = tone === "run" ? "border-andon-run" : tone === "hold" ? "border-andon-hold" : tone === "stop" ? "border-andon-stop" : "border-rule";
  const glyph = tone === "run" ? "●" : tone === "hold" ? "◐" : tone === "stop" ? "■" : "○";
  const color = tone === "run" ? "text-andon-run" : tone === "hold" ? "text-andon-hold" : tone === "stop" ? "text-andon-stop" : "text-ink-muted";
  return (
    <div className={`flex items-center gap-2 rounded-data border bg-panel px-2 py-1 ${border}`}>
      <span aria-hidden="true" className={color}>
        {glyph}
      </span>
      <span className="text-ink-muted">{label}</span>
      <span>{value}</span>
    </div>
  );
}
