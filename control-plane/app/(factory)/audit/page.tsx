"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ButtonSecondary } from "../_components/panel";

function compact(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s.length > 120 ? `${s.slice(0, 117)}…` : s;
}

function csvCell(value: unknown): string {
  const s = value === undefined || value === null ? "" : typeof value === "string" ? value : JSON.stringify(value);
  return `"${s.replace(/"/g, '""')}"`;
}

/** Audit (design §4.12): a flat, dense table; exportable. */
export default function AuditPage() {
  const rows = useQuery(api.ui.audit, { limit: 500 });

  function exportCsv() {
    if (!rows) {
      return;
    }
    const header = ["time", "project", "actor", "action", "before", "after", "evidence", "note"];
    const lines = rows.map(({ event, projectName }) =>
      [new Date(event.at).toISOString(), projectName, event.actor, event.action, event.before, event.after, event.evidence ?? "", event.note ?? ""].map(csvCell).join(","),
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `factory-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule pb-3">
        <div>
          <h1 className="text-[length:var(--text-20)] font-medium">Audit</h1>
          <p className="text-[length:var(--text-14)] text-ink-muted">Every label, decision, gate verdict, and stage change, with who did it.</p>
        </div>
        <ButtonSecondary onClick={exportCsv} disabled={!rows || rows.length === 0}>
          Export CSV
        </ButtonSecondary>
      </header>
      {rows === undefined ? (
        <p className="text-[length:var(--text-14)] text-ink-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-[length:var(--text-14)] text-ink-muted">Nothing recorded yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-data border border-rule bg-panel">
          <table className="w-full text-left text-[length:var(--text-12)] [font-variant-numeric:tabular-nums]">
            <thead className="border-b border-rule text-ink-muted">
              <tr>
                <th className="px-2 py-1 font-normal">Time</th>
                <th className="px-2 py-1 font-normal">Project</th>
                <th className="px-2 py-1 font-normal">Actor</th>
                <th className="px-2 py-1 font-normal">Action</th>
                <th className="px-2 py-1 font-normal">Before</th>
                <th className="px-2 py-1 font-normal">After</th>
                <th className="px-2 py-1 font-normal">Evidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {rows.map(({ event, projectName }) => (
                <tr key={event._id}>
                  <td className="whitespace-nowrap px-2 py-1">{new Date(event.at).toLocaleString()}</td>
                  <td className="px-2 py-1">{projectName}</td>
                  <td className="px-2 py-1">{event.actor}</td>
                  <td className="px-2 py-1">{event.action}</td>
                  <td className="max-w-[24ch] truncate px-2 py-1 font-log" title={compact(event.before)}>
                    {compact(event.before)}
                  </td>
                  <td className="max-w-[32ch] truncate px-2 py-1 font-log" title={compact(event.after)}>
                    {compact(event.after)}
                    {event.note && <span className="ml-1 text-ink-muted">note: {event.note}</span>}
                  </td>
                  <td className="px-2 py-1">
                    {event.evidence && (
                      <a href={event.evidence} target="_blank" rel="noreferrer" className="factory-focus underline underline-offset-2">
                        link
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
