"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import schema from "@/lib/factory/factory-spec.schema.json";
import { PROFILE_DEFAULTS, PROVIDER_KINDS, capabilityNote } from "@/lib/factory/capabilities";
import { errorCopy } from "@/lib/factory/copy";
import { ButtonPrimary, ButtonSecondary, Panel } from "../../_components/panel";

type Phase = { title: string; description: string; acceptance: string; touches: string };

const inputClass = "factory-focus w-full rounded-data border border-rule bg-surface px-2 py-1 text-[length:var(--text-14)] text-ink";
const labelClass = "flex flex-col gap-1 text-[length:var(--text-12)] text-ink-muted";

function lines(s: string): string[] {
  return s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function csv(s: string): string[] {
  return s
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Spec (design §4.12): a document-style editor for factory-spec.json. Phases are a numbered
 * sequence because they are one. Validated against the repository's schema before submission.
 */
export default function NewSpecPage() {
  const router = useRouter();
  const createFromSpec = useMutation(api.projects.createFromSpec);
  const startLine = useMutation(api.projects.startLine);
  const validate = useMemo(() => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    return ajv.compile(schema);
  }, []);

  const [name, setName] = useState("");
  const [pitch, setPitch] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [owner, setOwner] = useState("");
  const [modules, setModules] = useState("");
  const [secretsMode, setSecretsMode] = useState<"doppler" | "env">("doppler");
  const [phases, setPhases] = useState<Phase[]>([{ title: "", description: "", acceptance: "", touches: "" }]);
  const [mode, setMode] = useState<"gray" | "dark">("gray");
  const [threshold, setThreshold] = useState(5);
  const [rounds, setRounds] = useState(4);
  const [forcedGray, setForcedGray] = useState("middleware.ts, convex/auth*, app/api/**, lib/security/**, package.json, package-lock.json");
  const [profile, setProfile] = useState<"default" | "eu">("default");
  const [sandbox, setSandbox] = useState("local");
  const [errors, setErrors] = useState<string[]>([]);
  const [created, setCreated] = useState<Id<"projects"> | null>(null);
  const [busy, setBusy] = useState(false);

  function buildSpec() {
    return {
      spec_version: 0,
      name: name.trim(),
      pitch: pitch.trim(),
      admin_email: adminEmail.trim(),
      github_owner: owner.trim(),
      modules: csv(modules),
      secrets_mode: secretsMode,
      phases: phases.map((p) => ({
        title: p.title.trim(),
        ...(p.description.trim() ? { description: p.description.trim() } : {}),
        acceptance: lines(p.acceptance),
        ...(lines(p.touches).length ? { touches: lines(p.touches) } : {}),
      })),
      mode,
      greptile_threshold: threshold,
      max_repair_rounds: rounds,
      forced_gray_paths: csv(forcedGray),
      providers: { profile, sandbox },
    };
  }

  async function submit() {
    const spec = buildSpec();
    if (!validate(spec)) {
      setErrors((validate.errors ?? []).map((e) => `${e.instancePath || "spec"} ${e.message ?? ""}`.trim()));
      return;
    }
    setErrors([]);
    setBusy(true);
    try {
      const id = await createFromSpec({ spec });
      setCreated(id);
    } catch (err) {
      setErrors([errorCopy(err)]);
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (!created) {
      return;
    }
    setBusy(true);
    try {
      await startLine({ projectId: created });
      router.push(`/projects/${created}`);
    } catch (err) {
      setErrors([errorCopy(err)]);
      setBusy(false);
    }
  }

  function updatePhase(i: number, patch: Partial<Phase>) {
    setPhases((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  }

  return (
    <div className="flex max-w-[72ch] flex-col gap-4">
      <header className="border-b border-rule pb-3">
        <h1 className="text-[length:var(--text-20)] font-medium">New spec</h1>
        <p className="text-[length:var(--text-14)] text-ink-muted">The spec is the artifact. Phases become issues; everything else becomes policy.</p>
      </header>

      <Panel title="Product">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className={labelClass}>
            Name (slug)
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="acme-analytics" />
          </label>
          <label className={labelClass}>
            GitHub owner
            <input className={inputClass} value={owner} onChange={(e) => setOwner(e.target.value)} />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            Pitch
            <input className={inputClass} value={pitch} onChange={(e) => setPitch(e.target.value)} />
          </label>
          <label className={labelClass}>
            Admin email
            <input className={inputClass} type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
          </label>
          <label className={labelClass}>
            Modules (comma separated)
            <input className={inputClass} value={modules} onChange={(e) => setModules(e.target.value)} placeholder="homepage-content, dashboard-sample" />
          </label>
          <label className={labelClass}>
            Secrets mode
            <select className={inputClass} value={secretsMode} onChange={(e) => setSecretsMode(e.target.value as "doppler" | "env")}>
              <option value="doppler">doppler</option>
              <option value="env">env</option>
            </select>
          </label>
        </div>
      </Panel>

      <Panel
        title="Phases"
        action={
          <ButtonSecondary onClick={() => setPhases((ps) => [...ps, { title: "", description: "", acceptance: "", touches: "" }])}>
            Add phase
          </ButtonSecondary>
        }
      >
        <ol className="flex flex-col gap-3">
          {phases.map((p, i) => (
            <li key={i} className="rounded-data border border-rule p-2">
              <div className="mb-2 flex items-center justify-between text-[length:var(--text-14)]">
                <span className="font-medium [font-variant-numeric:tabular-nums]">Phase {i + 1}</span>
                <div className="flex gap-1">
                  <ButtonSecondary disabled={i === 0} onClick={() => setPhases((ps) => { const c = [...ps]; [c[i - 1], c[i]] = [c[i]!, c[i - 1]!]; return c; })} aria-label={`Move phase ${i + 1} up`}>
                    ↑
                  </ButtonSecondary>
                  <ButtonSecondary disabled={i === phases.length - 1} onClick={() => setPhases((ps) => { const c = [...ps]; [c[i + 1], c[i]] = [c[i]!, c[i + 1]!]; return c; })} aria-label={`Move phase ${i + 1} down`}>
                    ↓
                  </ButtonSecondary>
                  <ButtonSecondary disabled={phases.length === 1} onClick={() => setPhases((ps) => ps.filter((_, j) => j !== i))} aria-label={`Remove phase ${i + 1}`}>
                    Remove
                  </ButtonSecondary>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2">
                <label className={labelClass}>
                  Title
                  <input className={inputClass} value={p.title} onChange={(e) => updatePhase(i, { title: e.target.value })} />
                </label>
                <label className={labelClass}>
                  Description
                  <textarea className={inputClass} rows={2} value={p.description} onChange={(e) => updatePhase(i, { description: e.target.value })} />
                </label>
                <label className={labelClass}>
                  Acceptance criteria (one per line)
                  <textarea className={inputClass} rows={3} value={p.acceptance} onChange={(e) => updatePhase(i, { acceptance: e.target.value })} />
                </label>
                <label className={labelClass}>
                  Expected paths (one per line)
                  <textarea className={inputClass} rows={2} value={p.touches} onChange={(e) => updatePhase(i, { touches: e.target.value })} />
                </label>
              </div>
            </li>
          ))}
        </ol>
      </Panel>

      <Panel title="Policy">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className={labelClass}>
            Mode
            <select className={inputClass} value={mode} onChange={(e) => setMode(e.target.value as "gray" | "dark")}>
              <option value="gray">gray: a human applies auto-merge</option>
              <option value="dark">dark: merges without a human</option>
            </select>
          </label>
          <label className={labelClass}>
            Reviewer score needed (0–5)
            <input className={inputClass} type="number" min={0} max={5} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
          </label>
          <label className={labelClass}>
            Repair rounds before stopping
            <input className={inputClass} type="number" min={0} max={20} value={rounds} onChange={(e) => setRounds(Number(e.target.value))} />
          </label>
          <label className={`${labelClass} sm:col-span-3`}>
            Forced-gray paths (comma separated globs)
            <input className={inputClass} value={forcedGray} onChange={(e) => setForcedGray(e.target.value)} />
          </label>
        </div>
      </Panel>

      <Panel title="Providers">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className={labelClass}>
            Profile
            <select className={inputClass} value={profile} onChange={(e) => setProfile(e.target.value as "default" | "eu")}>
              <option value="default">default</option>
              <option value="eu">eu</option>
            </select>
          </label>
          <label className={labelClass}>
            Sandbox
            <select className={inputClass} value={sandbox} onChange={(e) => setSandbox(e.target.value)}>
              <option value="local">local</option>
              <option value="daytona">daytona</option>
              <option value="cloudflare">cloudflare</option>
              <option value="scaleway">scaleway</option>
            </select>
          </label>
        </div>
        <ul role="list" className="mt-3 divide-y divide-rule text-[length:var(--text-14)]">
          {PROVIDER_KINDS.map((kind) => {
            const chosen = kind === "sandbox" ? sandbox : PROFILE_DEFAULTS[profile][kind];
            return (
              <li key={kind} className="grid grid-cols-[6rem_8rem_1fr] gap-2 py-1">
                <span className="text-ink-muted">{kind}</span>
                <span>{chosen}</span>
                <span className="text-ink-muted">{capabilityNote(kind, chosen)}</span>
              </li>
            );
          })}
        </ul>
      </Panel>

      {errors.length > 0 && (
        <div role="alert" className="rounded-data border border-andon-stop bg-panel p-3 text-[length:var(--text-14)]">
          <p className="font-medium">The spec is not valid yet.</p>
          <ul role="list" className="mt-1 list-disc pl-5 text-ink-muted">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {created ? (
          <ButtonPrimary disabled={busy} onClick={start}>
            Start the line
          </ButtonPrimary>
        ) : (
          <ButtonPrimary disabled={busy} onClick={submit}>
            Save spec
          </ButtonPrimary>
        )}
        {created && <p className="self-center text-[length:var(--text-14)] text-ink-muted">Saved. Starting the line creates real provider resources.</p>}
      </div>
    </div>
  );
}
