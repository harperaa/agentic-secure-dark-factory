"use client";

import { useState } from "react";
import { AdvancedSpecForm } from "./advanced-form";
import { SpecChat } from "./chat";

type SpecDoc = Record<string, unknown>;
type Tab = "chat" | "advanced";

/**
 * New spec (design §4.12). Chat is the way in: the operator describes the product and the
 * factory drafts the document. Advanced is the same form as before, unchanged — every field of
 * factory-spec.json, validated against the repository's schema.
 *
 * "Open in Advanced" carries a chat draft into the form, so the two are one workflow rather
 * than two. The form is keyed on the handed-off draft: a second hand-off remounts it so the
 * newer draft becomes the form's initial state.
 */
export default function NewSpecPage() {
  const [tab, setTab] = useState<Tab>("chat");
  const [handOff, setHandOff] = useState<SpecDoc | undefined>(undefined);
  const [handOffCount, setHandOffCount] = useState(0);

  function openInAdvanced(spec: SpecDoc) {
    setHandOff(spec);
    setHandOffCount((n) => n + 1);
    setTab("advanced");
  }

  const tabClass = (active: boolean) =>
    `factory-focus -mb-px border-b-2 px-3 py-1.5 text-[length:var(--text-14)] ${
      active ? "border-brass font-medium text-ink" : "border-transparent text-ink-muted"
    }`;

  return (
    <div className="flex flex-col gap-4">
      <header className="border-b border-rule pb-3">
        <h1 className="text-[length:var(--text-20)] font-medium">New spec</h1>
        <p className="text-[length:var(--text-14)] text-ink-muted">
          The spec is the artifact. Phases become issues; everything else becomes policy.
        </p>
      </header>

      <div role="tablist" aria-label="How to write the spec" className="flex gap-1 border-b border-rule">
        <button
          type="button"
          role="tab"
          id="spec-tab-chat"
          aria-selected={tab === "chat"}
          aria-controls="spec-panel-chat"
          className={tabClass(tab === "chat")}
          onClick={() => setTab("chat")}
        >
          Chat
        </button>
        <button
          type="button"
          role="tab"
          id="spec-tab-advanced"
          aria-selected={tab === "advanced"}
          aria-controls="spec-panel-advanced"
          className={tabClass(tab === "advanced")}
          onClick={() => setTab("advanced")}
        >
          Advanced
        </button>
      </div>

      {tab === "chat" ? (
        <div role="tabpanel" id="spec-panel-chat" aria-labelledby="spec-tab-chat">
          <SpecChat onHandOff={openInAdvanced} />
        </div>
      ) : (
        <div
          role="tabpanel"
          id="spec-panel-advanced"
          aria-labelledby="spec-tab-advanced"
          className="max-w-[72ch]"
        >
          <AdvancedSpecForm key={handOffCount} initial={handOff} />
        </div>
      )}
    </div>
  );
}
