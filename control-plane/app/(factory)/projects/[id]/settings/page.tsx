"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Switch } from "@/components/ui/switch";
import { PROFILE_DEFAULTS, PROVIDER_KINDS, capabilityNote } from "@/lib/factory/capabilities";
import { errorCopy } from "@/lib/factory/copy";
import { ButtonSecondary, Field, Panel } from "../../../_components/panel";

/** Project settings: this project's mode, the policy its spec set, and its providers. Credentials never shown. */
export default function ProjectSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const project = useQuery(api.projects.get, { projectId: id as Id<"projects"> });
  const factory = useQuery(api.settings.get);

  if (project === undefined) {
    return <p className="text-[length:var(--text-14)] text-ink-muted">Loading…</p>;
  }
  if (project === null) {
    return (
      <p className="text-[length:var(--text-14)]">
        No such project.{" "}
        <Link href="/projects" className="factory-focus text-brass underline underline-offset-2">
          Back to projects.
        </Link>
      </p>
    );
  }

  const profile = project.providers.profile;
  const chosen = project.providers as Record<string, string | undefined>;

  return (
    <div className="flex flex-col gap-4">
      <header className="border-b border-rule pb-3">
        <p className="text-[length:var(--text-12)] text-ink-muted">
          <Link href={`/projects/${project._id}`} className="factory-focus underline-offset-2 hover:underline">
            {project.name}
          </Link>{" "}
          / Settings
        </p>
        <h1 className="text-[length:var(--text-20)] font-medium">{project.name} settings</h1>
        <p className="text-[length:var(--text-14)] text-ink-muted">Credentials live in the secrets broker and are never displayed here.</p>
      </header>

      <ModePanel project={project} factoryMode={factory?.settings.mode} />

      <Panel title="Policy">
        <p className="mb-1 text-[length:var(--text-12)] text-ink-muted">Set by this project&apos;s spec.</p>
        <dl className="grid grid-cols-1 sm:grid-cols-2">
          <Field label="Reviewer score needed">{project.greptileThreshold}/5</Field>
          <Field label="Repair rounds before stopping">{project.maxRepairRounds}</Field>
          <div className="sm:col-span-2">
            <Field label="Forced-gray paths">
              <span className="font-log text-[length:var(--text-12)]">{project.forcedGrayPaths.join(", ") || "none"}</span>
            </Field>
          </div>
        </dl>
      </Panel>

      <Panel title="Providers">
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
    </div>
  );
}

function ModePanel({ project, factoryMode }: { project: Doc<"projects">; factoryMode: "dark" | "gray" | undefined }) {
  const setMode = useMutation(api.projects.setMode);
  const requestDarkMode = useMutation(api.projects.requestDarkMode);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checklistOpened, setChecklistOpened] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorCopy(err));
    } finally {
      setBusy(false);
    }
  }

  const dark = project.mode === "dark";
  const held = dark && factoryMode === "gray";
  return (
    <Panel
      title="Mode"
      action={
        <label className="flex items-center gap-2 text-[length:var(--text-14)]">
          <span className="text-ink-muted">{dark ? "Dark" : "Gray"}</span>
          <Switch
            checked={dark}
            disabled={busy}
            onCheckedChange={(next) => void run(() => setMode({ projectId: project._id, mode: next ? "dark" : "gray" }))}
            aria-label={`Dark mode for ${project.name}`}
            className="factory-focus"
          />
        </label>
      }
    >
      <p className="max-w-[72ch] text-[length:var(--text-14)]">
        {dark ? "Dark: merges without a human once every gate passes and nothing forced gray." : "Gray: a human applies auto-merge on every pull request."}
      </p>
      {held && (
        <p className="mt-1 text-[length:var(--text-14)] text-andon-hold">
          Held gray: the factory is in gray mode, so this project waits for a human until{" "}
          <Link href="/settings" className="factory-focus underline underline-offset-2">
            factory mode
          </Link>{" "}
          is dark again.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-[length:var(--text-14)] text-andon-stop">
          {error}
        </p>
      )}
      {!dark && project.repo && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ButtonSecondary
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await requestDarkMode({ projectId: project._id });
                setChecklistOpened(true);
              })
            }
          >
            Open the dark-mode checklist
          </ButtonSecondary>
          <span className="text-[length:var(--text-12)] text-ink-muted">
            {checklistOpened ? (
              <>
                Opened. Resolve it with a note under{" "}
                <Link href="/decisions" className="factory-focus underline underline-offset-2">
                  Decisions
                </Link>
                , then switch this project to dark.
              </>
            ) : (
              "Dark mode needs the checklist resolved with a note first."
            )}
          </span>
        </div>
      )}
    </Panel>
  );
}
