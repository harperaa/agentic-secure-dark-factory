"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { Switch } from "@/components/ui/switch";
import { PROFILE_DEFAULTS, PROVIDER_KINDS, capabilityNote } from "@/lib/factory/capabilities";
import { errorCopy } from "@/lib/factory/copy";
import { Panel } from "../../_components/panel";

/** Settings › Providers: profile per project, adapter status, the mode switch. Credentials never shown. */
export default function ProvidersPage() {
  const projects = useQuery(api.projects.list);
  return (
    <div className="flex flex-col gap-4">
      <header className="border-b border-rule pb-3">
        <h1 className="text-[length:var(--text-20)] font-medium">Providers</h1>
        <p className="text-[length:var(--text-14)] text-ink-muted">The provider profile and mode of each project. Credentials live in the secrets broker and are never displayed here.</p>
      </header>
      {projects === undefined ? (
        <p className="text-[length:var(--text-14)] text-ink-muted">Loading…</p>
      ) : projects.length === 0 ? (
        <p className="text-[length:var(--text-14)] text-ink-muted">No projects yet.</p>
      ) : (
        projects.map((project) => <ProjectProviders key={project._id} project={project} />)
      )}
    </div>
  );
}

function ProjectProviders({ project }: { project: Doc<"projects"> }) {
  const setMode = useMutation(api.projects.setMode);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const profile = project.providers.profile;
  const chosen = project.providers as Record<string, string | undefined>;

  async function toggle(dark: boolean) {
    setBusy(true);
    setError(null);
    try {
      await setMode({ projectId: project._id, mode: dark ? "dark" : "gray" });
    } catch (err) {
      setError(errorCopy(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title={project.name}
      action={
        <label className="flex items-center gap-2 text-[length:var(--text-14)]">
          <span className="text-ink-muted">{project.mode === "dark" ? "Dark mode: merges without a human" : "Gray mode: a human applies auto-merge"}</span>
          <Switch checked={project.mode === "dark"} disabled={busy} onCheckedChange={toggle} aria-label={`Dark mode for ${project.name}`} className="factory-focus" />
        </label>
      }
    >
      {error && (
        <p role="alert" className="mb-2 text-[length:var(--text-14)] text-andon-stop">
          {error}
        </p>
      )}
      <p className="mb-2 text-[length:var(--text-12)] text-ink-muted">Profile: {profile}</p>
      <table className="w-full text-left text-[length:var(--text-14)]">
        <thead className="text-[length:var(--text-12)] text-ink-muted">
          <tr>
            <th className="py-1 pr-3 font-normal">Kind</th>
            <th className="py-1 pr-3 font-normal">Adapter</th>
            <th className="py-1 font-normal">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-rule">
          {PROVIDER_KINDS.map((kind) => {
            const name = chosen[kind] ?? PROFILE_DEFAULTS[profile][kind];
            return (
              <tr key={kind}>
                <td className="py-1 pr-3">{kind}</td>
                <td className="py-1 pr-3">{name}</td>
                <td className="py-1 text-ink-muted">{capabilityNote(kind, name)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}
