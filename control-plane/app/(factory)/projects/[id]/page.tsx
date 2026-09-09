"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorCopy, runStateCopy, stageCopy } from "@/lib/factory/copy";
import { elapsed } from "@/lib/factory/stations";
import { Line } from "../../_components/line";
import { DecisionList } from "../../_components/decision-list";
import { ButtonPrimary, ButtonSecondary, Field, Panel } from "../../_components/panel";
import { useNow } from "../../_components/use-now";

/** Project: the line across the top, the current station's evidence, decisions, runs. */
export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const data = useQuery(api.ui.project, { projectId: id as Id<"projects"> });
  const startLine = useMutation(api.projects.startLine);
  const requestClaimUrl = useMutation(api.ui.requestClaimUrl);
  const clearClaimUrl = useMutation(api.ui.clearClaimUrl);
  const claim = useQuery(api.ui.claimUrl, { projectId: id as Id<"projects"> });
  const now = useNow();
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  if (data === undefined) {
    return <p className="text-[length:var(--text-14)] text-ink-muted">Loading…</p>;
  }
  if (data === null) {
    return (
      <p className="text-[length:var(--text-14)]">
        No such project.{" "}
        <Link href="/floor" className="factory-focus text-brass underline underline-offset-2">
          Back to the floor.
        </Link>
      </p>
    );
  }
  const { project, runs, gate, decisions } = data;
  const latest = runs[0];

  async function start() {
    setStarting(true);
    setError(null);
    try {
      await startLine({ projectId: project._id });
    } catch (err) {
      setError(errorCopy(err));
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="border-b border-rule pb-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-[length:var(--text-20)] font-medium">{project.name}</h1>
          <p className="text-[length:var(--text-14)] text-ink-muted">
            {stageCopy(project)} · {project.mode} mode
            {project.repo && (
              <>
                {" "}
                ·{" "}
                <a href={`https://github.com/${project.repo}`} target="_blank" rel="noreferrer" className="factory-focus underline underline-offset-2">
                  {project.repo}
                </a>
              </>
            )}
            {project.devUrl && (
              <>
                {" "}
                ·{" "}
                <a href={project.devUrl} target="_blank" rel="noreferrer" className="factory-focus underline underline-offset-2">
                  dev site
                </a>
              </>
            )}
          </p>
        </div>
        <div className="mt-3">
          <Line project={project} reviewScore={gate?.review?.score ?? null} {...(latest ? { lastRunStage: latest.stage } : {})} />
        </div>
      </header>

      {project.stage === "DRAFT" && (
        <Panel title="Ready to start">
          <p className="mb-3 max-w-[72ch] text-[length:var(--text-14)] text-ink-muted">
            Starting the line creates the repository, provider resources, and a dev URL, then builds each phase in turn.
          </p>
          {error && (
            <p role="alert" className="mb-2 text-[length:var(--text-14)] text-andon-stop">
              {error}
            </p>
          )}
          <ButtonPrimary disabled={starting} onClick={start}>
            Start the line
          </ButtonPrimary>
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Current station">
          {latest ? (
            <dl className="grid grid-cols-1 sm:grid-cols-2">
              <Field label="Run">
                <Link href={`/runs/${latest._id}`} className="factory-focus underline underline-offset-2">
                  {latest.command}
                </Link>{" "}
                <span className="text-ink-muted">{runStateCopy(latest.state)}</span>
              </Field>
              <Field label="Elapsed">{elapsed(latest.startedAt ?? latest.queuedAt, latest.completedAt ?? now)}</Field>
              <Field label="Exit code">{latest.exitCode ?? "—"}</Field>
              <Field label="Tokens">
                {latest.tokenUsage ? `${latest.tokenUsage.input.toLocaleString()} in / ${latest.tokenUsage.output.toLocaleString()} out` : "—"}
              </Field>
              {latest.resultLine && (
                <div className="sm:col-span-2">
                  <Field label="Result">
                    <code className="font-log text-[length:var(--text-12)]">{latest.resultLine}</code>
                  </Field>
                </div>
              )}
              {project.currentPr !== undefined && project.repo && (
                <Field label="Pull request">
                  <a href={`https://github.com/${project.repo}/pull/${project.currentPr}`} target="_blank" rel="noreferrer" className="factory-focus underline underline-offset-2">
                    #{project.currentPr}
                  </a>
                  {gate?.review && gate.review.score !== null && (
                    <span className="ml-2 text-ink-muted">
                      review {gate.review.score}/{5} of {project.greptileThreshold} needed
                    </span>
                  )}
                </Field>
              )}
              <div className="sm:col-span-2">
                <details className="text-[length:var(--text-14)]">
                  <summary className="factory-focus cursor-pointer text-ink-muted">Prompt</summary>
                  <pre className="mt-1 max-h-64 overflow-auto rounded-data bg-surface p-2 font-log text-[length:var(--text-12)] whitespace-pre-wrap">{latest.prompt}</pre>
                </details>
              </div>
            </dl>
          ) : (
            <p className="text-[length:var(--text-14)] text-ink-muted">No runs yet.</p>
          )}
        </Panel>

        <Panel title={`Decisions (${decisions.length})`}>
          <DecisionList items={decisions.map((decision) => ({ decision, projectName: project.name }))} />
        </Panel>
      </div>

      <Panel title="Clerk application">
        <p className="text-[var(--ink-muted)] text-[length:var(--text-14)]">
          The accountless Clerk app created at genesis stays unclaimed until you open its claim link. The link lives only in the product&apos;s Doppler dev config; reveal it here when you need it, then clear it.
        </p>
        {claim?.url ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <a className="underline break-all" href={claim.url} target="_blank" rel="noreferrer">Open the claim link</a>
            <ButtonSecondary onClick={() => void clearClaimUrl({ effectId: claim.effectId })}>Clear</ButtonSecondary>
          </div>
        ) : claim?.status === "queued" || claim?.status === "running" ? (
          <p className="mt-2" aria-live="polite">Reading it from Doppler on the worker machine…</p>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ButtonSecondary onClick={() => void requestClaimUrl({ projectId: id as Id<"projects"> })}>Reveal claim link</ButtonSecondary>
            {claim?.error ? <span className="text-[var(--andon-stop)]">{claim.error}</span> : null}
          </div>
        )}
      </Panel>
      <Panel title={`Runs (${runs.length})`}>
        {runs.length === 0 ? (
          <p className="text-[length:var(--text-14)] text-ink-muted">No runs yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[length:var(--text-14)] [font-variant-numeric:tabular-nums]">
              <thead className="text-[length:var(--text-12)] text-ink-muted">
                <tr>
                  <th className="py-1 pr-3 font-normal">Stage</th>
                  <th className="py-1 pr-3 font-normal">Command</th>
                  <th className="py-1 pr-3 font-normal">State</th>
                  <th className="py-1 pr-3 font-normal">Attempt</th>
                  <th className="py-1 pr-3 font-normal">Queued</th>
                  <th className="py-1 pr-3 font-normal">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {runs.map((run) => (
                  <tr key={run._id}>
                    <td className="py-1 pr-3">{stageCopy({ stage: run.stage, phaseIndex: project.phaseIndex })}</td>
                    <td className="py-1 pr-3">
                      <Link href={`/runs/${run._id}`} className="factory-focus underline underline-offset-2">
                        {run.command}
                      </Link>
                    </td>
                    <td className="py-1 pr-3">{runStateCopy(run.state)}</td>
                    <td className="py-1 pr-3">{run.attempt}</td>
                    <td className="py-1 pr-3 whitespace-nowrap">{new Date(run.queuedAt).toLocaleString()}</td>
                    <td className="py-1 pr-3">{run.startedAt ? elapsed(run.startedAt, run.completedAt ?? now) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
