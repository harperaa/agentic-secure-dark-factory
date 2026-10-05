"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ProjectList } from "../_components/project-list";
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
        <ProjectList rows={rows} />
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
