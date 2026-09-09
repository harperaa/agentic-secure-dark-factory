import type { Metadata } from "next";
import { Schibsted_Grotesk } from "next/font/google";
import { SignedIn, SignedOut, RedirectToSignIn } from "@clerk/nextjs";
import { Rail } from "./_components/rail";
import { OperatorBoundary } from "./_components/error-boundary";
import { ConvexGate } from "./_components/convex-gate";

const schibsted = Schibsted_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-schibsted",
  display: "swap",
});

export const metadata: Metadata = {
  title: process.env.NEXT_PUBLIC_SITE_NAME || "Factory",
};

/**
 * The operator's window onto the line (design §4.12): a fixed 240px station rail on desktop,
 * a single column on mobile, one type family on the surface.
 */
export default function FactoryLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
      <SignedIn>
        <div
          className={`${schibsted.variable} font-ui min-h-screen bg-surface text-ink`}
          style={{ ["--font-ui" as string]: 'var(--font-schibsted), system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' }}
        >
          <a
            href="#factory-main"
            className="factory-focus sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-panel focus:px-3 focus:py-2"
          >
            Skip to content
          </a>
          <div className="flex min-h-screen flex-col md:flex-row">
            <Rail siteName={process.env.NEXT_PUBLIC_SITE_NAME || "Factory"} />
            <main id="factory-main" className="min-w-0 flex-1 px-4 py-4 md:px-8 md:py-6">
              <OperatorBoundary>
                <ConvexGate>{children}</ConvexGate>
              </OperatorBoundary>
            </main>
          </div>
        </div>
      </SignedIn>
    </>
  );
}
