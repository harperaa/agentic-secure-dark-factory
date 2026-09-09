"use client";

import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import type { ReactNode } from "react";

/**
 * Clerk's SignedIn only says the browser has a session; Convex needs the Clerk token handed to its
 * client before any operator-gated query runs. Render the screens only once Convex reports
 * authenticated, so no query ever reaches the deployment unauthenticated.
 */
export function ConvexGate({ children }: { children: ReactNode }) {
  return (
    <>
      <AuthLoading>
        <p className="text-ink-muted" aria-live="polite">Connecting to the control plane…</p>
      </AuthLoading>
      <Unauthenticated>
        <p className="text-ink-muted" aria-live="polite">
          Signed in, but the control plane has not accepted the session yet. If this persists, the Clerk JWT template named
          &quot;convex&quot; or the deployment&apos;s issuer setting is missing.
        </p>
      </Unauthenticated>
      <Authenticated>{children}</Authenticated>
    </>
  );
}
