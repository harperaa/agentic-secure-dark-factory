"use client";

import Link from "next/link";
import { Settings } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { stageCopy } from "@/lib/factory/copy";
import { Line } from "./line";

type FloorRow = FunctionReturnType<typeof api.ui.floor>[number];

/** One live line per project: name and stage, the line itself, then review score and open decisions. */
export function ProjectList({ rows }: { rows: FloorRow[] | undefined }) {
  if (rows === undefined) {
    return <p className="text-[length:var(--text-14)] text-ink-muted">Loading the line…</p>;
  }
  if (rows.length === 0) {
    return (
      <p className="text-[length:var(--text-14)] text-ink-muted">
        No projects yet.{" "}
        <Link href="/spec/new" className="factory-focus text-brass underline underline-offset-2">
          Start with a spec.
        </Link>
      </p>
    );
  }
  return (
    <ul role="list" className="flex flex-col divide-y divide-rule">
      {rows.map(({ project, lastRun, gate, openDecisions }) => (
        <li key={project._id} className="grid grid-cols-1 items-center gap-2 py-3 md:grid-cols-[204px_1fr_160px]">
          <div className="flex min-w-0 items-start gap-2">
            <Link
              href={`/projects/${project._id}/settings`}
              aria-label={`Settings for ${project.name}`}
              title="Project settings"
              className="factory-focus mt-0.5 shrink-0 rounded-data p-0.5 text-ink-muted hover:text-ink"
            >
              <Settings aria-hidden="true" className="size-4" />
            </Link>
            <div className="min-w-0">
              <Link href={`/projects/${project._id}`} className="factory-focus text-[length:var(--text-16)] font-medium underline-offset-2 hover:underline">
                {project.name}
              </Link>
              <p className="text-[length:var(--text-12)] text-ink-muted">{stageCopy(project)}</p>
            </div>
          </div>
          <Line project={project} reviewScore={gate?.review?.score ?? null} {...(lastRun ? { lastRunStage: lastRun.stage } : {})} {...(lastRun?.progress && lastRun.state === "running" ? { progress: lastRun.progress } : {})} compact />
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
  );
}
