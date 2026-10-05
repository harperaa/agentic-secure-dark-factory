"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorCopy } from "@/lib/factory/copy";
import { ButtonPrimary, ButtonSecondary, Panel } from "../../_components/panel";

type SpecDoc = Record<string, unknown>;
type Turn = { role: "user" | "assistant"; text: string };

const OPENER =
  "Describe the product you want built and I'll draft the spec. A sentence is enough to start.";

const inputClass =
  "factory-focus w-full rounded-data border border-rule bg-surface px-2 py-1 text-[length:var(--text-14)] text-ink";

/** One row of the drafted spec, so the operator reads a document and not a blob of JSON. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-2 py-1 text-[length:var(--text-14)]">
      <span className="text-ink-muted">{label}</span>
      <span className="break-words">{children}</span>
    </div>
  );
}

function SpecSummary({ spec }: { spec: SpecDoc }) {
  const phases = Array.isArray(spec.phases) ? (spec.phases as Record<string, unknown>[]) : [];
  const providers = (spec.providers ?? {}) as Record<string, unknown>;
  const modules = Array.isArray(spec.modules) ? (spec.modules as string[]) : [];
  return (
    <div className="divide-y divide-rule">
      <Row label="Name">{String(spec.name ?? "")}</Row>
      <Row label="Pitch">{String(spec.pitch ?? "")}</Row>
      <Row label="Admin">{String(spec.admin_email ?? "")}</Row>
      <Row label="GitHub owner">{String(spec.github_owner ?? "")}</Row>
      {modules.length > 0 && <Row label="Modules">{modules.join(", ")}</Row>}
      <Row label="Mode">
        {String(spec.mode ?? "")}
        {spec.mode === "dark" && (
          <span className="ml-2 text-ink-muted">merges without a human</span>
        )}
      </Row>
      <Row label="Gates">
        reviewer score {String(spec.greptile_threshold ?? "")}/5 · {String(spec.max_repair_rounds ?? "")} repair rounds
      </Row>
      <Row label="Secrets">{String(spec.secrets_mode ?? "")}</Row>
      <Row label="Providers">
        {String(providers.profile ?? "")} profile · {String(providers.sandbox ?? "")} sandbox
      </Row>
      <div className="py-1">
        <span className="text-[length:var(--text-14)] text-ink-muted">Phases</span>
        <ol className="mt-1 flex flex-col gap-1">
          {phases.map((p, i) => {
            const acceptance = Array.isArray(p.acceptance) ? (p.acceptance as string[]) : [];
            return (
              <li key={i} className="rounded-data border border-rule px-2 py-1 text-[length:var(--text-14)]">
                <span className="[font-variant-numeric:tabular-nums] text-ink-muted">{i + 1}. </span>
                {String(p.title ?? "")}
                {acceptance.length > 0 && (
                  <ul role="list" className="mt-0.5 list-disc pl-6 text-[length:var(--text-12)] text-ink-muted">
                    {acceptance.map((a, j) => (
                      <li key={j}>{a}</li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

/**
 * Spec chat (design §4.12): the spec by conversation. The model drafts, the operator decides.
 *
 * Nothing here creates anything. A draft becomes a project only when the operator presses Save,
 * which calls the same createFromSpec mutation the Advanced form uses, and the line starts only
 * on a second, separate press.
 */
export function SpecChat({ onHandOff }: { onHandOff: (spec: SpecDoc) => void }) {
  const router = useRouter();
  const draft = useAction(api.specChat.draft);
  // What this operator's last spec used. The chat gets it so it can fill admin_email and
  // github_owner instead of opening with two questions it already knows the answers to.
  const defaults = useQuery(api.operator.specDefaults);
  const createFromSpec = useMutation(api.projects.createFromSpec);
  const startLine = useMutation(api.projects.startLine);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [spec, setSpec] = useState<SpecDoc | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Id<"projects"> | null>(null);
  const liveRef = useRef<HTMLDivElement>(null);

  // Keep the newest turn in view without stealing focus from the composer.
  useEffect(() => {
    liveRef.current?.scrollTo({ top: liveRef.current.scrollHeight });
  }, [turns, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy) {
      return;
    }
    const next: Turn[] = [...turns, { role: "user", text }];
    setTurns(next);
    setInput("");
    setErrors([]);
    setBusy(true);
    try {
      const result = await draft({
        messages: next.map((t) => ({ role: t.role, text: t.text })),
        current: spec ?? undefined,
        ...(defaults ? { defaults } : {}),
      });
      setTurns((ts) => [...ts, { role: "assistant", text: result.reply }]);
      if (result.spec) {
        setSpec(result.spec as SpecDoc);
        setCreated(null); // the draft moved on; the saved project no longer matches it
      }
      if (result.errors.length > 0) {
        setErrors(result.errors);
      }
    } catch (err) {
      setErrors([errorCopy(err)]);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!spec) {
      return;
    }
    setBusy(true);
    setErrors([]);
    try {
      setCreated(await createFromSpec({ spec }));
    } catch (err) {
      setErrors([errorCopy(err)]);
    } finally {
      setBusy(false);
    }
  }

  async function saveAndRun() {
    if (!spec) {
      return;
    }
    setBusy(true);
    setErrors([]);
    try {
      const id = await createFromSpec({ spec });
      setCreated(id);
      await startLine({ projectId: id });
      router.push(`/projects/${id}`);
    } catch (err) {
      setErrors([errorCopy(err)]);
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

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Panel title="Conversation" className="flex flex-col">
        <div
          ref={liveRef}
          className="flex max-h-[28rem] flex-col gap-3 overflow-y-auto"
          aria-live="polite"
          aria-busy={busy}
        >
          <p className="text-[length:var(--text-14)] text-ink-muted">{OPENER}</p>
          {turns.map((t, i) => (
            <div key={i} className="flex flex-col gap-0.5">
              <span className="text-[length:var(--text-12)] text-ink-muted">
                {t.role === "user" ? "You" : "Factory"}
              </span>
              <p className="whitespace-pre-wrap text-[length:var(--text-14)]">{t.text}</p>
            </div>
          ))}
          {busy && (
            <p className="text-[length:var(--text-14)] text-ink-muted">Drafting…</p>
          )}
        </div>

        <div className="mt-3 flex flex-col gap-2 border-t border-rule pt-3">
          <label className="flex flex-col gap-1 text-[length:var(--text-12)] text-ink-muted">
            <span className="sr-only">Describe the product</span>
            <textarea
              className={inputClass}
              rows={3}
              value={input}
              disabled={busy}
              placeholder="A CRM for a small sales team — contacts and deals."
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
          </label>
          <div className="flex items-center gap-2">
            <ButtonPrimary disabled={busy || !input.trim()} onClick={() => void send()}>
              Send
            </ButtonPrimary>
            <span className="text-[length:var(--text-12)] text-ink-muted">⌘↵ to send</span>
          </div>
        </div>
      </Panel>

      <div className="flex flex-col gap-4">
        <Panel
          title="Drafted spec"
          action={
            spec && (
              <ButtonSecondary onClick={() => onHandOff(spec)}>Open in Advanced</ButtonSecondary>
            )
          }
        >
          {spec ? (
            <SpecSummary spec={spec} />
          ) : (
            <p className="text-[length:var(--text-14)] text-ink-muted">
              No draft yet. The spec appears here as it takes shape, and you can edit every field
              of it on the Advanced tab.
            </p>
          )}
        </Panel>

        {errors.length > 0 && (
          <div role="alert" className="rounded-data border border-andon-stop bg-panel p-3 text-[length:var(--text-14)]">
            <p className="font-medium">The draft is not valid yet.</p>
            <ul role="list" className="mt-1 list-disc pl-5 text-ink-muted">
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )}

        {spec && (
          <div className="flex flex-wrap items-center gap-2">
            {created ? (
              <ButtonPrimary disabled={busy} onClick={() => void start()}>
                Start the line
              </ButtonPrimary>
            ) : (
              <>
                <ButtonPrimary disabled={busy} onClick={() => void saveAndRun()}>
                  Save and run
                </ButtonPrimary>
                <ButtonSecondary disabled={busy} onClick={() => void save()}>
                  Save only
                </ButtonSecondary>
              </>
            )}
            <p className="text-[length:var(--text-14)] text-ink-muted">
              {created
                ? "Saved as a draft. Starting the line creates real provider resources."
                : "Save and run starts the line now, which creates real provider resources."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
