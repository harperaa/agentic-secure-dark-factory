import type { StationState } from "@/lib/factory/stations";

/**
 * Andon signal (design §4.12 principle 2): colour means exactly one thing, and it is always
 * paired with a shape and a label so state never relies on colour alone.
 */
const ANDON: Record<StationState, { glyph: string; label: string; className: string }> = {
  idle: { glyph: "○", label: "Not started", className: "text-ink-muted" },
  done: { glyph: "●", label: "Passed", className: "text-andon-run" },
  running: { glyph: "●", label: "Running", className: "text-brass" },
  hold: { glyph: "◐", label: "Waiting on a gate", className: "text-andon-hold" },
  stop: { glyph: "■", label: "Stopped", className: "text-andon-stop" },
};

export function Andon({ state, label, className = "" }: { state: StationState; label?: string; className?: string }) {
  const a = ANDON[state];
  return (
    <span className={`inline-flex items-center gap-1 ${a.className} ${className}`}>
      <span aria-hidden="true" className="text-[length:var(--text-12)] leading-none">
        {a.glyph}
      </span>
      <span className={label === undefined ? "sr-only" : ""}>{label ?? a.label}</span>
    </span>
  );
}

export function andonLabel(state: StationState): string {
  return ANDON[state].label;
}
