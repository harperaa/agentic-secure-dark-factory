"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { decisionActions, errorCopy } from "@/lib/factory/copy";
import { ButtonPrimary, ButtonSecondary } from "./panel";
import { useMediaQuery } from "./use-now";

export type DecisionItem = { decision: Doc<"decisions">; projectName: string };

/**
 * Decision drawer (design §4.12 principle 3): slides from the right on desktop, up on mobile.
 * States the decision in plain language, lists the evidence, offers one primary action named
 * for what it does and one secondary, and takes a note that lands in the audit log.
 */
export function DecisionDrawer({ item, onClose }: { item: DecisionItem | null; onClose: () => void }) {
  const desktop = useMediaQuery("(min-width: 768px)");
  const open = item !== null;
  const body = item ? <DecisionBody item={item} onDone={onClose} /> : null;
  if (desktop) {
    return (
      <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
        <SheetContent side="right" className="w-full max-w-[480px] rounded-l-drawer bg-panel text-ink sm:max-w-[480px]">
          <SheetHeader>
            <SheetTitle className="text-[length:var(--text-20)] font-medium text-ink">{item?.decision.title}</SheetTitle>
            <SheetDescription className="text-ink-muted">{item?.projectName}</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">{body}</div>
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="rounded-t-drawer bg-panel text-ink">
        <DrawerHeader className="text-left">
          <DrawerTitle className="text-[length:var(--text-20)] font-medium text-ink">{item?.decision.title}</DrawerTitle>
          <DrawerDescription className="text-ink-muted">{item?.projectName}</DrawerDescription>
        </DrawerHeader>
        <div className="px-4 pb-6">{body}</div>
      </DrawerContent>
    </Drawer>
  );
}

function DecisionBody({ item, onDone }: { item: DecisionItem; onDone: () => void }) {
  const resolve = useMutation(api.decisions.resolve);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actions = decisionActions(item.decision.kind);

  async function choose(choice: "primary" | "secondary") {
    setBusy(true);
    setError(null);
    try {
      await resolve({ decisionId: item.decision._id, choice, ...(note.trim() ? { note: note.trim() } : {}) });
      onDone();
    } catch (err) {
      setError(errorCopy(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {item.decision.evidence.length > 0 && (
        <div>
          <h3 className="text-[length:var(--text-12)] text-ink-muted">Evidence</h3>
          <ul role="list" className="mt-1 flex flex-col gap-1 text-[length:var(--text-14)]">
            {item.decision.evidence.map((e, i) => (
              <li key={i}>
                <a href={e.url} target="_blank" rel="noreferrer" className="factory-focus underline decoration-rule underline-offset-2 hover:decoration-ink">
                  {e.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      <label className="flex flex-col gap-1 text-[length:var(--text-14)]">
        <span className="text-[length:var(--text-12)] text-ink-muted">Note for the audit log</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className="factory-focus rounded-data border border-rule bg-surface px-2 py-1 text-ink"
        />
      </label>
      {error && (
        <p role="alert" className="text-[length:var(--text-14)] text-andon-stop">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <ButtonPrimary disabled={busy} onClick={() => choose("primary")}>
          {actions.primary}
        </ButtonPrimary>
        <ButtonSecondary disabled={busy} onClick={() => choose("secondary")}>
          {actions.secondary}
        </ButtonSecondary>
      </div>
    </div>
  );
}
