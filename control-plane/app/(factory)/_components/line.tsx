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
 * The line is the hero (design §4.12 principle 1): stations left to right, each a small
 * instrument showing state, elapsed time, and the one number that matters there. The
 * work-in-progress marker moves only in response to real events, never on page load.
 */
export function Line({
  project,
  reviewScore,
  lastRunStage,
  compact = false,
}: {
  project: Doc<"projects">;
  reviewScore?: number | null;
  lastRunStage?: Doc<"runs">["stage"];
  compact?: boolean;
}) {
  const now = useNow();
  const stations = stationsFor(project, { reviewScore: reviewScore ?? null, ...(lastRunStage === undefined ? {} : { lastRunStage }) });
  const currentIndex = stations.findIndex((s) => s.state === "running" || s.state === "hold" || s.state === "stop");
  const stationWidth = compact ? 44 : 88;
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
              <span className={`${compact ? "text-[length:var(--text-12)]" : "text-[length:var(--text-14)]"} font-medium`}>
                {compact ? s.short : s.label}
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
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
