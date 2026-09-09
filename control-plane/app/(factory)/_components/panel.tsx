import type { ReactNode } from "react";

/** Plain bordered panel: borders encode containment, never decoration (design §4.12). */
export function Panel({ title, action, children, className = "" }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-data border border-rule bg-panel ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-2 border-b border-rule px-3 py-2">
          {title && <h2 className="text-[length:var(--text-14)] font-medium">{title}</h2>}
          {action}
        </header>
      )}
      <div className="px-3 py-2">{children}</div>
    </section>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-1 text-[length:var(--text-14)]">
      <dt className="text-[length:var(--text-12)] text-ink-muted">{label}</dt>
      <dd className="break-all [font-variant-numeric:tabular-nums]">{children}</dd>
    </div>
  );
}

export function ButtonPrimary({ children, className = "", ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={`factory-focus inline-flex items-center gap-1 rounded-data bg-brass px-3 py-1.5 text-[length:var(--text-14)] font-medium text-white disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}

export function ButtonSecondary({ children, className = "", ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={`factory-focus inline-flex items-center gap-1 rounded-data border border-rule bg-surface px-3 py-1.5 text-[length:var(--text-14)] text-ink disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}
