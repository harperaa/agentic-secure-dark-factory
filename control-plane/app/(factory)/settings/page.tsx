"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { Switch } from "@/components/ui/switch";
import { PROFILE_DEFAULTS, PROVIDER_KINDS, capabilityNote } from "@/lib/factory/capabilities";
import { errorCopy } from "@/lib/factory/copy";
import { ButtonPrimary, Panel } from "../_components/panel";

type Settings = FunctionReturnType<typeof api.settings.get>["settings"];

const inputClass = "factory-focus w-full rounded-data border border-rule bg-surface px-2 py-1 text-[length:var(--text-14)] text-ink";
const labelClass = "flex flex-col gap-1 text-[length:var(--text-12)] text-ink-muted";

/**
 * Settings: how the whole factory runs. The mode is the master switch over every project; the
 * rest are the defaults a new spec starts from. Per-project settings live behind each project's
 * gear on the Floor and Projects screens.
 */
export default function FactorySettingsPage() {
  const data = useQuery(api.settings.get);
  const projects = useQuery(api.projects.list);

  return (
    <div className="flex flex-col gap-4">
      <header className="border-b border-rule pb-3">
        <h1 className="text-[length:var(--text-20)] font-medium">Settings</h1>
        <p className="text-[length:var(--text-14)] text-ink-muted">How the whole factory runs. Each project&apos;s own settings are behind the gear beside it on the Floor.</p>
      </header>
      {data === undefined ? (
        <p className="text-[length:var(--text-14)] text-ink-muted">Loading…</p>
      ) : (
        <>
          <ModePanel settings={data.settings} darkProjects={projects?.filter((p) => p.mode === "dark").map((p) => p.name) ?? []} />
          {/* Keyed on the saved values so a save elsewhere resets the form to what is stored. */}
          <DefaultsPanel key={JSON.stringify(data.settings)} settings={data.settings} />
          <Panel title="Integrations">
            <p className="mb-2 text-[length:var(--text-12)] text-ink-muted">
              Set on the Convex deployment with <code className="font-log">npx convex env set</code>. Only whether each is set is shown, never the value.
            </p>
            <table className="w-full text-left text-[length:var(--text-14)]">
              <thead className="text-[length:var(--text-12)] text-ink-muted">
                <tr>
                  <th className="py-1 pr-3 font-normal">Integration</th>
                  <th className="py-1 pr-3 font-normal">What it is for</th>
                  <th className="py-1 font-normal">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {data.integrations.map((item) => (
                  <tr key={item.key}>
                    <td className="py-1 pr-3 align-top">
                      {item.label}
                      <div className="font-log text-[length:var(--text-12)] text-ink-muted">{item.key}</div>
                    </td>
                    <td className="py-1 pr-3 align-top text-ink-muted">{item.purpose}</td>
                    <td className={`py-1 align-top whitespace-nowrap ${item.configured ? "text-ink" : "text-andon-stop"}`}>{item.configured ? "Set" : "Not set"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </>
      )}
    </div>
  );
}

function ModePanel({ settings, darkProjects }: { settings: Settings; darkProjects: string[] }) {
  const update = useMutation(api.settings.update);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { saved, ...current } = settings;
  void saved;

  async function toggle(dark: boolean) {
    setBusy(true);
    setError(null);
    try {
      await update({ ...current, mode: dark ? "dark" : "gray" });
    } catch (err) {
      setError(errorCopy(err));
    } finally {
      setBusy(false);
    }
  }

  const dark = settings.mode === "dark";
  return (
    <Panel
      title="Mode"
      action={
        <label className="flex items-center gap-2 text-[length:var(--text-14)]">
          <span className="text-ink-muted">{dark ? "Dark" : "Gray"}</span>
          <Switch checked={dark} disabled={busy} onCheckedChange={toggle} aria-label="Factory dark mode" className="factory-focus" />
        </label>
      }
    >
      {error && (
        <p role="alert" className="mb-2 text-[length:var(--text-14)] text-andon-stop">
          {error}
        </p>
      )}
      <p className="max-w-[72ch] text-[length:var(--text-14)]">
        {dark
          ? "Dark: a project that has passed its own dark-mode checklist merges without a human. Every other project still waits for you."
          : "Gray: nothing merges without a human, whatever each project is set to. Use this to hold the whole line."}
      </p>
      <p className="mt-1 text-[length:var(--text-12)] text-ink-muted">
        {darkProjects.length === 0
          ? "No project is set to dark."
          : dark
            ? `Running dark: ${darkProjects.join(", ")}.`
            : `Held gray by this switch: ${darkProjects.join(", ")}.`}
      </p>
    </Panel>
  );
}

function DefaultsPanel({ settings }: { settings: Settings }) {
  const update = useMutation(api.settings.update);
  const [threshold, setThreshold] = useState(settings.greptileThreshold);
  const [rounds, setRounds] = useState(settings.maxRepairRounds);
  const [forcedGray, setForcedGray] = useState(settings.forcedGrayPaths.join("\n"));
  const [profile, setProfile] = useState(settings.providerProfile);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await update({
        mode: settings.mode,
        greptileThreshold: threshold,
        maxRepairRounds: rounds,
        forcedGrayPaths: forcedGray.split(/[\n,]/),
        providerProfile: profile,
      });
      setSavedAt(Date.now());
    } catch (err) {
      setError(errorCopy(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Defaults for new specs">
      <p className="mb-3 max-w-[72ch] text-[length:var(--text-12)] text-ink-muted">
        A new spec starts from these, in the form and in spec chat. Projects that already exist keep what their spec says.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className={labelClass}>
          Reviewer score needed (0–5)
          <input className={inputClass} type="number" min={0} max={5} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
        </label>
        <label className={labelClass}>
          Repair rounds before stopping
          <input className={inputClass} type="number" min={0} max={20} value={rounds} onChange={(e) => setRounds(Number(e.target.value))} />
        </label>
        <label className={labelClass}>
          Provider profile
          <select className={inputClass} value={profile} onChange={(e) => setProfile(e.target.value as "default" | "eu")}>
            <option value="default">default</option>
            <option value="eu">eu</option>
          </select>
        </label>
        <label className={`${labelClass} sm:col-span-3`}>
          Forced-gray paths (one glob per line): changes here always wait for a human, in any mode
          <textarea className={`${inputClass} font-log`} rows={6} value={forcedGray} onChange={(e) => setForcedGray(e.target.value)} />
        </label>
      </div>

      <table className="mt-3 w-full text-left text-[length:var(--text-14)]">
        <thead className="text-[length:var(--text-12)] text-ink-muted">
          <tr>
            <th className="py-1 pr-3 font-normal">Kind</th>
            <th className="py-1 pr-3 font-normal">Adapter ({profile})</th>
            <th className="py-1 font-normal">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-rule">
          {PROVIDER_KINDS.map((kind) => {
            const name = PROFILE_DEFAULTS[profile][kind];
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

      {error && (
        <p role="alert" className="mt-2 text-[length:var(--text-14)] text-andon-stop">
          {error}
        </p>
      )}
      <div className="mt-3 flex items-center gap-3">
        <ButtonPrimary disabled={busy} onClick={save}>
          Save defaults
        </ButtonPrimary>
        {savedAt !== null && !busy && !error && (
          <span aria-live="polite" className="text-[length:var(--text-12)] text-ink-muted">
            Saved.
          </span>
        )}
      </div>
    </Panel>
  );
}
