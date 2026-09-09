# Agentic Secure Dark Factory

A lights-out software factory that will not ship what it cannot prove is safe.

Give it a product spec. It builds a hardened SaaS on Secure Vibe Coding OS,
runs security checks on every pull request, an AI reviewer to a score you set,
and a full security assessment before the first hand-off and on every major
release. Then it keeps the product maintained: issues are triaged, fixed,
tested, reviewed, and merged automatically (dark mode) or staged for your
decision (gray mode).

## Security first, by construction

- Nothing merges without security CI, an independent review, and, in gray
  mode, a human. Changes to auth, payments, headers, middleware, or
  dependencies are always staged for a human, whatever the mode.
- Agents run as an unprivileged user, in git worktrees, with no ability to
  bypass required reviews. They never hold long-lived credentials in cloud
  sandboxes and never reach the network beyond an allowlist.
- Every run is auditable: prompt, command hash, events, token usage, gates,
  and the exact commit it produced.
- Secrets live in Doppler or Infisical; the factory never displays them and
  rotates them on a named action.
- Runs locally by default. Cloud sandboxes and an EU provider profile
  (Scaleway, self-hosted Convex, Infisical, Keycloak/Zitadel, Mollie/PayOne)
  are opt-in, so your code and data stay where you decide.
- Built on, not into, its upstreams: Secure Vibe Coding OS and Machinist are
  used unmodified.

Read the threat model in [docs/security/threat-model.md](docs/security/threat-model.md)
before running it in dark mode.

## How it works

Two planes, one rule: hosted for humans and plugins, local for execution,
never hosted for credentials or shell.

| Plane | Runs on | Holds |
|---|---|---|
| Control plane | Convex + Clerk (the factory is itself an SVCOS install) plus Machinist's control plane on loopback | spec, stage state machine, dark/gray policy, audit trail, job queue |
| Execution plane | a local Machinist worker by default; Daytona, Cloudflare, or Scaleway sandboxes by choice | repo checkout, agent CLIs, provider CLIs, credentials |

Every stage of a project is exactly one Machinist run:

```
DRAFT → GENESIS → BUILD[1..n] → ASSESS → FIX → REVIEW_LOOP → DEPLOY_DEV → HANDOFF → MAINTAIN ↻
```

The full design, decisions, and risk register are in [docs/design.md](docs/design.md).

## Upstreams

| Component | Pinned at | Used as |
|---|---|---|
| [Secure Vibe Coding OS](https://github.com/harperaa/secure-vibe-coding-OS) | see `snapshots/versions.env` (`SVCOS_TEMPLATE_REF`) | product template; headless scripts and security agents, invoked unmodified |
| [Machinist](https://github.com/owainlewis/machinist) | see `snapshots/versions.env` (`MACHINIST_VERSION`) | execution substrate; foreman and shepherd prompts used verbatim |
| [Greptile](https://greptile.com) | GitHub App | AI reviewer and confidence score gate |

Neither upstream is forked or patched. Anything that only makes sense inside
them is written up under [docs/upstream/](docs/upstream/) as a proposal.

## Repository layout

```
docs/                    design, threat model, controls matrix, runtimes, providers, upstream proposals
spec/                    factory-spec.json schema and examples
factory/commands/        Machinist prompt templates owned by the factory (assess, greptile-fix, triage)
factory/config/          config.toml and worker.toml templates; factory.env.example
factory/scripts/         genesis.sh and the other repository-owned executors and helpers
factory/generated/       files written into every product repo (AGENTS.md, security workflow, baselines)
sandbox-exec/            Go wrapper executor: local passthrough today, cloud sandboxes later
snapshots/               Dockerfile for the svcos-factory image and pinned versions
control-plane/           Convex schema, policy, UI tokens (the SVCOS app scaffold lands in M3)
.github/workflows/       the factory's own security CI (the same controls it imposes on products)
```

## Getting started (local runtime, M0)

1. Install Machinist per its VM guide, or on your own machine as an unprivileged user.
2. Let the doctor discover the values you cannot guess (GitHub owner, Vercel scope, Convex
   team slug, Doppler workplace) and write a private env file; then choose where it left a
   blank and export it:

   ```bash
   factory/scripts/doctor.sh --write ~/.config/asdf/factory.env
   set -a; source ~/.config/asdf/factory.env; set +a
   ```

3. Render and install the Machinist configuration:

   ```bash
   make install-machinist-config
   ```

4. Register the product repository the worker may run in:

   ```bash
   factory/scripts/register-repository.sh <name> </absolute/path>
   ```

5. Start the control plane and worker, then submit a job:

   ```bash
   factory/scripts/submit-job.sh --command=foreman --repository=<name> --prompt="Implement issue 1"
   ```

Genesis (spec to dev URL) is driven the same way with `--command=genesis` and
the spec JSON as the prompt. See [docs/runtimes/local.md](docs/runtimes/local.md).

## Status

| Milestone | State |
|---|---|
| M-1 Repository, security CI, branch protection | done |
| M0 Local runtime; foreman on a real issue | done (foreman opened a PR on the first product; blocked on the product's own CI baseline) |
| M1 Genesis, headless prompts, phase issues | done (spec to dev URL proven end to end on the local runtime) |
| M2 Provider adapters, sandbox backends, snapshot | adapters PR in flight; `sandbox-exec` Docker backend proven against the built image; Daytona unit-tested only |
| M3 Control plane (Convex state machine, bridge, Web UI) | done and deployed to the factory's own Convex, Doppler, Clerk, and Vercel |
| M4 Gates (CI + reviewer + forced gray, repair rounds, assessment, alerts) | built; exercised through the first real decision; reviewer integration waits on the Greptile app install |
| M5 Gray GA, M6 Dark mode | policy and checklist gate built; operational tuning pending real runs |
| M7 EU profile | adapters written with honest `verified: false` capabilities; identity and payments refused until SVCOS modules exist |
| M8 Upstream proposals | six issues opened on Secure Vibe Coding OS; Machinist Runtime seam drafted in `docs/upstream/` |

Runtime pieces on the operator machine: `factory/scripts/start-local.sh` (Machinist), `factory/bridge/bridge.mjs` (bridge), `factory/scripts/doctor.sh` (onboarding discovery). See [docs/design.md](docs/design.md#14-milestones).

## License

MIT. See [LICENSE](LICENSE).
