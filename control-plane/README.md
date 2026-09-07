# control-plane

The factory's control plane is itself a Secure Vibe Coding OS install (design §4.2):
Next.js, Convex, Clerk, hardened by construction. The full application scaffold is
produced by SVCOS's headless install in M3 (design §13.5 step 4). Until then this
directory holds the factory-owned code that will be dropped into that scaffold:

| Path | Purpose |
|---|---|
| `convex/schema.ts` | `projects`, `runs`, `gates`, `events` tables (design §4.3) |
| `convex/factory.ts` | `enqueue` and `gateUpdate` mutations the webhook and bridge call |
| `convex/http.ts` | GitHub App webhook receiver with signature verification (appendix C) |
| `factory/policy/forcedGray.ts` | forced-gray classifier over changed paths (design §4.9) |
| `factory/ui/tokens.css` | design tokens from §4.12 |
| `scripts/validate-spec.mjs` | JSON Schema validation used by `factory/scripts/validate-spec.sh` |

Type-check with `npm ci && npx tsc --noEmit` (Convex's `_generated` types are produced by
`npx convex codegen`; the type-check target runs it first). Do not start dev servers from
here; the operator runs those.
