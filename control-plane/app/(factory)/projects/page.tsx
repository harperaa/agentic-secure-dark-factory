"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ProjectList } from "../_components/project-list";
import { Panel } from "../_components/panel";

/** Every project on the floor, one live line each. */
export default function ProjectsPage() {
  const rows = useQuery(api.ui.floor);
  return (
    <div className="flex flex-col gap-4">
      <header className="border-b border-rule pb-3">
        <h1 className="text-[length:var(--text-20)] font-medium">Projects</h1>
        <p className="text-[length:var(--text-14)] text-ink-muted">Where each line is, and what it is waiting on.</p>
      </header>
      <Panel>
        <ProjectList rows={rows} />
      </Panel>
    </div>
  );
}
