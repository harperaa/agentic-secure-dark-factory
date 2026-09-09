"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { ModeToggle } from "@/components/mode-toggle";

const NAV: Array<{ href: string; label: string; match: (p: string) => boolean }> = [
  { href: "/floor", label: "Floor", match: (p) => p === "/floor" },
  { href: "/floor#projects", label: "Projects", match: (p) => p.startsWith("/projects") || p.startsWith("/runs") },
  { href: "/decisions", label: "Decisions", match: (p) => p.startsWith("/decisions") },
  { href: "/audit", label: "Audit", match: (p) => p.startsWith("/audit") },
  { href: "/settings/providers", label: "Settings", match: (p) => p.startsWith("/settings") },
];

/** Station rail: fixed 240px on desktop, a top bar on mobile. Borders encode containment. */
export function Rail({ siteName }: { siteName: string }) {
  const pathname = usePathname() ?? "";
  return (
    <nav
      aria-label="Factory"
      className="flex shrink-0 items-center gap-2 border-b border-rule bg-panel px-4 py-2 md:w-[240px] md:flex-col md:items-stretch md:gap-0 md:border-b-0 md:border-r md:px-0 md:py-0"
    >
      <Link href="/floor" className="factory-focus block text-[length:var(--text-16)] font-medium md:border-b md:border-rule md:px-4 md:py-4">
        {siteName}
      </Link>
      <ul className="flex flex-1 gap-1 overflow-x-auto md:flex-col md:gap-0 md:overflow-visible md:py-2" role="list">
        {NAV.map((item) => {
          const active = item.match(pathname);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`factory-focus block whitespace-nowrap rounded-data px-3 py-1.5 text-[length:var(--text-14)] md:px-4 md:py-2 ${
                  active ? "bg-surface font-medium text-ink" : "text-ink-muted hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
        <li className="md:mt-2 md:border-t md:border-rule md:pt-2">
          <Link
            href="/spec/new"
            className="factory-focus block whitespace-nowrap rounded-data px-3 py-1.5 text-[length:var(--text-14)] text-brass md:px-4 md:py-2"
          >
            New spec
          </Link>
        </li>
      </ul>
      <div className="flex items-center gap-2 md:border-t md:border-rule md:px-4 md:py-3">
        <ModeToggle />
        <UserButton />
      </div>
    </nav>
  );
}
