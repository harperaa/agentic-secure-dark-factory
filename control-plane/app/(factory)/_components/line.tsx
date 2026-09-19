"use client";

import { useEffect, useRef, useState } from "react";
import type { Doc } from "@/convex/_generated/dataModel";
import { elapsed, stationsFor, type Station } from "@/lib/factory/stations";
import { Andon, andonLabel } from "./andon";
import { useNow } from "./use-now";

const STATE_BOX: Record<Station["state"], string> = {
  idle: "border-rule text-ink-muted",
  done: "border-andon-run text-ink",
  running: "border-brass text-ink",
  hold: "border-andon-hold text-ink",
  stop: "border-andon-stop text-ink",
};

/**
 * The step clock, in its own component and on its own tick.
 *
 * useNow() elsewhere ticks once a minute, which suits a stage clock reading in minutes but leaves
 * a seconds counter looking frozen: a step lasting 40s would never visibly move. This ticks every
 * second while the step is in flight, and stops once it has finished, when its duration is fixed.
 *
 * Separate component because the tick re-renders whatever reads it. Kept here, that is one span;
 * lifted into Line, it would be every station of every project on the floor, once a second.
 */
function StepClock({ since, live }: { since: number; live: boolean }) {
  const now = useNow(live ? 1_000 : 60_000);
  return (
    <span
      className="[font-variant-numeric:tabular-nums]"
      title={`This step started ${new Date(since).toLocaleTimeString()}`}
    >
      {elapsed(since, now)}
    </span>
  );
}

/**
 * The line is the hero (design §4.12 principle 1): stations left to right, each a small
 * instrument showing state, elapsed time, and the one number that matters there. The
 * work-in-progress marker moves only in response to real events, never on page load.
 */
export function Line({
  project,
  reviewScore,
  lastRunStage,
  progress,
  compact = false,
}: {
  project: Doc<"projects">;
  reviewScore?: number | null;
  lastRunStage?: Doc<"runs">["stage"];
  /** Step-level progress of the run at the current station; see runs.progress. */
  progress?: Doc<"runs">["progress"];
  compact?: boolean;
}) {
  const now = useNow();
  const stations = stationsFor(project, { reviewScore: reviewScore ?? null, ...(lastRunStage === undefined ? {} : { lastRunStage }) });
  const currentIndex = stations.findIndex((s) => s.state === "running" || s.state === "hold" || s.state === "stop");
  const stationWidth = compact ? 84 : 96;
  const gap = compact ? 6 : 8;

  // Announce station changes for screen readers; suppress the announcement on first paint.
  const mounted = useRef(false);
  const [announcement, setAnnouncement] = useState("");
  const current = currentIndex >= 0 ? stations[currentIndex] : undefined;
  const currentKey = current?.key ?? "";
  const currentState = current?.state ?? "idle";
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (current) {
      setAnnouncement(`${project.name}: ${current.label}, ${andonLabel(current.state)}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey, currentState]);

  return (
    <div className="relative overflow-x-auto pb-1" role="group" aria-label={`Production line for ${project.name}`}>
      <ol
        role="list"
        className="relative flex items-stretch"
        style={{ gap, ["--station-w" as string]: `${stationWidth}px`, minWidth: stations.length * (stationWidth + gap) }}
      >
        {currentIndex >= 0 && (
          <span
            aria-hidden="true"
            className="factory-line-wip pointer-events-none absolute -top-1 left-0 h-1.5 w-1.5 rounded-full bg-brass"
            style={{ transform: `translateX(calc(${currentIndex} * (var(--station-w) + ${gap}px) + var(--station-w) / 2 - 3px))` }}
          />
        )}
        {stations.map((s, i) => (
          <li
            key={s.key}
            className={`flex flex-col justify-between rounded-data border bg-panel ${STATE_BOX[s.state]} ${compact ? "px-1 py-1" : "px-2 py-1.5"}`}
            style={{ width: stationWidth, borderWidth: s.state === "running" || s.state === "hold" || s.state === "stop" ? 2 : 1 }}
            aria-current={i === currentIndex ? "step" : undefined}
          >
            <div className="flex items-center justify-between gap-1 leading-none">
              <span
                className={`${compact ? "text-[length:var(--text-12)]" : "text-[length:var(--text-14)]"} min-w-0 truncate font-medium`}
                title={s.label}
              >
                {s.label}
              </span>
              <Andon state={s.state} />
            </div>
            {!compact && (
              <div className="mt-1 flex items-baseline justify-between text-[length:var(--text-12)] text-ink-muted [font-variant-numeric:tabular-nums]">
                <span>{i === currentIndex ? elapsed(project.updatedAt, now) : ""}</span>
                <span className="text-ink">{s.figure ?? ""}</span>
              </div>
            )}
          </li>
        ))}
        {project.stage === "MAINTAIN" && (
          <li aria-hidden="true" className="flex items-center text-ink-muted" style={{ width: compact ? 16 : 24 }}>
            ↻
          </li>
        )}
      </ol>
      {progress && (
        // A station says which stage; this says where inside it. Without it a run looks identical
        // at minute one and minute twenty, which is the difference between waiting and intervening.
        <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-[length:var(--text-12)] text-ink-muted">
          <span className="text-ink">{progress.step}</span>
          <span aria-hidden="true">·</span>
          <span className="[font-variant-numeric:tabular-nums]">
            {progress.outcome === "started" ? "running" : progress.outcome}
          </span>
          {progress.done > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span className="[font-variant-numeric:tabular-nums]">{progress.done} steps done</span>
            </>
          )}
          <span aria-hidden="true">·</span>
          {/* How long on THIS step, not how long the run has been going: a step that stops
              advancing is the thing worth noticing, and the stage clock hides it. */}
          <StepClock since={progress.since ?? progress.at} live={progress.outcome === "started"} />
          {progress.note && (
            <span className="w-full text-andon-stop" title={progress.note}>
              {progress.note}
            </span>
          )}
        </p>
      )}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
