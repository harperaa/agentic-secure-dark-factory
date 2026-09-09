"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { stageCopy } from "@/lib/factory/copy";
import { Line } from "../_components/line";
import { DecisionList } from "../_components/decision-list";
import { Panel } from "../_components/panel";

/**
 * Floor (design §4.12): is the line running, where is it stopped and why, what do I have to
 * decide. Counts in the header, one live line per project, decisions below.
 */
export default function FloorPage() {
  const summary = useQuery(api.runs.summary);
  const rows = useQuery(api.ui.floor);
  const decisions = useQuery(api.ui.openDecisions);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-rule pb-3">
        <h1 className="text-[length:var(--text-20)] font-medium">Floor</h1>
        {summary && (
          <ul role="list" className="flex flex-wrap gap-x-5 text-[length:var(--text-14)] [font-variant-numeric:tabular-nums]">
            <li className="text-brass">
              <span aria-hidden="true">● </span>
              {summary.running} running
            </li>
            <li className="text-andon-hold">
              <span aria-hidden="true">◐ </span>
              {summary.waiting} waiting on review
            </li>
            <li className="text-andon-stop">
              <span aria-hidden="true">■ </span>
              {summary.stopped} stopped
            </li>
          </ul>
        )}
      </header>

      <section id="projects" aria-labelledby="projects-heading">
        <h2 id="projects-heading" className="sr-only">
          Projects
        </h2>
        {rows === undefined ? (
          <p className="text-[length:var(--text-14)] text-ink-muted">Loading the line…</p>
        ) : rows.length === 0 ? (
          <p className="text-[length:var(--text-14)] text-ink-muted">
            No projects yet.{" "}
            <Link href="/spec/new" className="factory-focus text-brass underline underline-offset-2">
              Start with a spec.
            </Link>
          </p>
        ) : (
          <ul role="list" className="flex flex-col divide-y divide-rule">
            {rows.map(({ project, lastRun, gate, openDecisions }) => (
              <li key={project._id} className="grid grid-cols-1 items-center gap-2 py-3 md:grid-cols-[180px_1fr_160px]">
                <div className="min-w-0">
                  <Link href={`/projects/${project._id}`} className="factory-focus text-[length:var(--text-16)] font-medium underline-offset-2 hover:underline">
                    {project.name}
                  </Link>
                  <p className="text-[length:var(--text-12)] text-ink-muted">{stageCopy(project)}</p>
                </div>
                <Line project={project} reviewScore={gate?.review?.score ?? null} {...(lastRun ? { lastRunStage: lastRun.stage } : {})} compact />
                <div className="text-[length:var(--text-12)] text-ink-muted md:text-right [font-variant-numeric:tabular-nums]">
                  {gate?.review?.score !== undefined && gate.review.score !== null && (
                    <span className="text-ink">review {gate.review.score}/5</span>
                  )}
                  {openDecisions > 0 && (
                    <span className="ml-2 text-andon-stop">
                      {openDecisions} to decide
                    </span>
                  )}
                  {project.mode === "dark" && <span className="ml-2">dark</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Panel title={`Decisions${decisions ? ` (${decisions.length})` : ""}`}>
        {decisions === undefined ? (
          <p className="text-[length:var(--text-14)] text-ink-muted">Loading…</p>
        ) : (
          <DecisionList items={decisions} />
        )}
      </Panel>
    </div>
  );
}
