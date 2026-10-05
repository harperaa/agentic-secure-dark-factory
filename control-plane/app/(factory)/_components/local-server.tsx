"use client";

import type { Doc } from "@/convex/_generated/dataModel";
import { elapsed } from "@/lib/factory/stations";
import { Field, Panel } from "./panel";
import { useNow } from "./use-now";

type LocalServer = Doc<"localServers">;

// The bridge reports every poll (10s by default). Three missed polls and the row is the last
// thing it said, not what is true now.
const STALE_MS = 45_000;

const STATUS_COPY: Record<LocalServer["status"], string> = {
  installing: "Installing dependencies",
  starting: "Starting",
  running: "Running",
  failed: "Stopped with an error",
  stopped: "Stopped",
};

const STATUS_TONE: Record<LocalServer["status"], string> = {
  installing: "text-andon-hold",
  starting: "text-andon-hold",
  running: "text-andon-run",
  failed: "text-andon-stop",
  stopped: "text-ink-muted",
};

function isLive(server: LocalServer, now: number) {
  return server.status === "running" && now - server.checkedAt < STALE_MS;
}

/** The header link: live only while the bridge says the server answers. */
export function LocalSiteLink({ server }: { server: LocalServer | null }) {
  const now = useNow(10_000);
  if (!server) return null;
  return isLive(server, now) ? (
    <a href={server.url} target="_blank" rel="noreferrer" className="factory-focus underline underline-offset-2">
      local site
    </a>
  ) : (
    <span title={STATUS_COPY[server.status]}>local site ({STATUS_COPY[server.status].toLowerCase()})</span>
  );
}

/** The process the bridge runs on the worker machine for this product. */
export function LocalServerPanel({ server }: { server: LocalServer | null }) {
  const now = useNow(10_000);
  return (
    <Panel title="Local server">
      {server === null ? (
        <p className="text-[length:var(--text-14)] text-ink-muted">
          The bridge starts a local dev server once genesis has created the repository.
        </p>
      ) : (
        <>
          {now - server.checkedAt >= STALE_MS && (
            <p role="status" className="mb-2 text-[length:var(--text-14)] text-andon-hold">
              The bridge last reported {elapsed(server.checkedAt, now)} ago; this may no longer be true.
            </p>
          )}
          <dl className="grid grid-cols-1 sm:grid-cols-3">
            <Field label="Status">
              <span className={STATUS_TONE[server.status]}>{STATUS_COPY[server.status]}</span>
            </Field>
            <Field label="URL">
              {isLive(server, now) ? (
                <a href={server.url} target="_blank" rel="noreferrer" className="factory-focus underline underline-offset-2">
                  {server.url}
                </a>
              ) : (
                server.url
              )}
            </Field>
            <Field label="Up">{server.startedAt && server.status === "running" ? elapsed(server.startedAt, now) : "—"}</Field>
            <Field label="Process">{server.pid ?? "—"}</Field>
            <Field label="Commit">{server.head ?? "—"}</Field>
            <Field label="Command">
              <code className="font-log text-[length:var(--text-12)]">{server.command}</code>
            </Field>
            <div className="sm:col-span-3">
              <Field label="Checkout">
                <code className="font-log text-[length:var(--text-12)]">{server.checkout}</code>
              </Field>
            </div>
            {server.note && (
              <div className="sm:col-span-3">
                <Field label="Last error">
                  <code className="font-log text-[length:var(--text-12)] text-andon-stop">{server.note}</code>
                </Field>
              </div>
            )}
          </dl>
          <p className="mt-1 text-[length:var(--text-12)] text-ink-muted">
            Bound to loopback on the worker machine, with the product&apos;s Doppler dev secrets. It follows main as phases merge.
          </p>
        </>
      )}
    </Panel>
  );
}
