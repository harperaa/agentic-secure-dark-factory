"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { DecisionList } from "../_components/decision-list";
import { Panel } from "../_components/panel";

/** Every open decision across the floor, newest first. */
export default function DecisionsPage() {
  const decisions = useQuery(api.ui.openDecisions);
  return (
    <div className="flex flex-col gap-4">
      <header className="border-b border-rule pb-3">
        <h1 className="text-[length:var(--text-20)] font-medium">Decisions</h1>
        <p className="text-[length:var(--text-14)] text-ink-muted">What the line is waiting on you for.</p>
      </header>
      <Panel>
        {decisions === undefined ? <p className="text-[length:var(--text-14)] text-ink-muted">Loading…</p> : <DecisionList items={decisions} emptyText="Nothing to decide. The line is running on its own." />}
      </Panel>
    </div>
  );
}
