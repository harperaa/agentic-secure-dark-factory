"use client";

import { useState } from "react";
import { decisionActions } from "@/lib/factory/copy";
import { DecisionDrawer, type DecisionItem } from "./decision-drawer";
import { ButtonPrimary } from "./panel";

/** Decisions are first-class: exactly what a human must do, with one action named for what it does. */
export function DecisionList({ items, emptyText = "Nothing to decide." }: { items: DecisionItem[]; emptyText?: string }) {
  const [openItem, setOpenItem] = useState<DecisionItem | null>(null);
  if (items.length === 0) {
    return <p className="text-[length:var(--text-14)] text-ink-muted">{emptyText}</p>;
  }
  return (
    <>
      <ul role="list" className="divide-y divide-rule">
        {items.map((item) => (
          <li key={item.decision._id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-[length:var(--text-14)]">
              <span className="text-ink-muted">{item.projectName}</span>
              <span aria-hidden="true" className="text-ink-muted">
                {" "}
                ·{" "}
              </span>
              <span className="break-words">{item.decision.title}</span>
            </div>
            <ButtonPrimary onClick={() => setOpenItem(item)} aria-label={`${decisionActions(item.decision.kind).primary}: ${item.decision.title}`}>
              {decisionActions(item.decision.kind).primary}
            </ButtonPrimary>
          </li>
        ))}
      </ul>
      <DecisionDrawer item={openItem} onClose={() => setOpenItem(null)} />
    </>
  );
}
