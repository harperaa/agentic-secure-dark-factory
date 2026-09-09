"use client";

import { Component, type ReactNode } from "react";
import { errorCopy } from "@/lib/factory/copy";

type State = { error: Error | null };

/**
 * Convex queries throw during render when a function rejects (for example "not the operator").
 * Show the operator what happened and what to do, in plain words, instead of a blank screen.
 */
export class OperatorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override render() {
    if (this.state.error) {
      return (
        <div role="alert" className="max-w-[72ch] rounded-data border border-andon-stop bg-panel p-4">
          <p className="text-[length:var(--text-16)] font-medium">Stopped: this screen could not load.</p>
          <p className="mt-2 text-[length:var(--text-14)] text-ink-muted">{errorCopy(this.state.error)}</p>
          <button
            type="button"
            className="factory-focus mt-4 rounded-data border border-rule bg-surface px-3 py-1.5 text-[length:var(--text-14)]"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
