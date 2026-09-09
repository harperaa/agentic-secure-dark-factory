# Agentic Secure Dark Factory — Design

**Status:** Draft v0.4 — 2026-09-07 (v0.4: project renamed Agentic Secure Dark Factory; §4.12 Web UI design). Repository copy; the upstream pins in §3 were re-verified on 2026-09-07 (SVCOS 7.0.0 at `be73ee5`, Machinist v0.4.0 at `fda16c2`).
**Author:** Allen (with Claude)
**Scope:** Architecture and UI design for Agentic Secure Dark Factory, an orchestrator that takes a product spec, builds a hardened SaaS end to end on Secure Vibe Coding OS, drives it to a 5/5 Greptile score, hands back a URL, and then autonomously (dark) or semi-autonomously (gray) maintains it.

---

## 1. Summary

Agentic Secure Dark Factory ("the factory") is a control plane that sits above two existing systems:

- **Secure Vibe Coding OS (SVCOS)** — the hardened Next.js / Convex / Clerk / Vercel / Doppler template with headless install, deploy, and security-assessment automation.
- **Machinist** — an open-source "software factory" that executes one agent process per job with leases, heartbeats, timeouts, durable event logs, and a human-gated PR handoff.

The design splits into two planes:

| Plane | Runs on | Holds |
|---|---|---|
| **Control plane** | Convex + Clerk (hosted by default; self-hosted Convex + Keycloak/Zitadel for EU/full-local), plus Machinist's control plane (local by default, optionally in a Cloudflare Container) | Spec, stage state machine, policy (dark/gray), audit trail, job queue |
| **Execution plane** | **Local by default** (a workstation or VM running Machinist's control plane + worker); optionally ephemeral cloud sandboxes (Daytona, Cloudflare, Scaleway) | Repo checkout, agent CLIs, provider CLIs, credentials |

Key decisions:

1. The "API" is **hosted for humans and plugins, local for execution, never hosted for credentials or shell**. Convex+Clerk is the API; execution happens in sandboxes that are destroyed after every run.
2. **Do not fork Machinist into an orchestrator.** Its author deliberately removed pipelines. Use it as the execution substrate (one job = one run = one stage), and keep the stage graph in Convex.
3. **Local execution is the default.** The author's VM shape runs on the operator's own machine or VM. Cloud sandboxes (Daytona, Cloudflare, Scaleway) are optional worker variants, implemented as wrapper executors so Machinist itself is unchanged.
4. **Dark vs. gray is a label** (`machinist:auto-merge`), applied by policy, with risk-based forced-gray for security-sensitive changes.
5. Sandbox compute is 1–3% of per-job cost; **LLM tokens dominate**. Choose backends on security model and architectural fit.
6. **Security runs at two cadences:** deterministic security CI on every PR (required checks); the full agentic `security-assessment` only after the initial build and on major releases.
7. **All edits happen in git worktrees on a PR branch; the PR is the durable state, worktrees are rebuilt on demand in ephemeral sandboxes.** Genesis is the only stage that writes to a fresh clone's `main`.
8. **No interactive prompts in the factory path.** The factory invokes SVCOS's scripts and agents directly with explicit arguments; it never drives an interactive slash command. Argument contracts live in factory wrappers first and are offered upstream second.
9. **Providers are pluggable.** Default stack is Vercel / Clerk / Doppler / Convex. Every provider sits behind an adapter so an **EU profile** can substitute Scaleway (hosting), Infisical (secrets), Keycloak or Zitadel (identity), Mollie or PayOne (payments), self-hosted Convex (backend), and EU LLM endpoints. Profiles are declared once per project.
10. **The repository is `agentic-secure-dark-factory` and enforces on itself every control it imposes on products** (security CI, branch protection, signed releases, self-maintenance in gray mode); the README leads with the security-first framing (§13).
11. **Do not modify SVCOS or Machinist.** Every integration point is a wrapper, a generated-repo file, a config profile, or an adapter in the factory. Changes that only make sense upstream are proposed as optional modules/PRs, never as factory-side patches to those repos.

---

## 2. Goals and non-goals

### Goals

- **G1. Spec → URL, unattended.** From a user's product description, produce a deployed dev URL on Vercel with Clerk auth, Convex backend, Doppler secrets, CI green, security assessment passed, Greptile score at threshold.
- **G2. Continuous dark/gray maintenance.** Issues and PRs pushed to GitHub are picked up, triaged, implemented, tested, reviewed, and merged (dark) or staged for human review (gray).
- **G3. Security by construction.** Every change routes through SVCOS security skills, `security-assessment`, and Greptile; agents run with no long-lived credentials and constrained egress.
- **G4. Auditable.** Every run has a durable record: prompt, command hash, events, token usage, exit state, resulting SHA/PR, reviewer decisions.
- **G5. Pluggable execution, local first.** Local (VM/workstation) is the default; Daytona, Cloudflare, and Scaleway shapes are optional and coexist.
- **G6. Pluggable providers and data residency.** Hosting, identity, secrets, backend, payments, sandboxes, and LLM endpoints are adapters. A project declares a provider profile (`default` or `eu`) and the factory honours it end to end.
- **G7. Upstream non-interference.** The factory works around SVCOS and Machinist; it does not require forks or patches of either.

### Non-goals (v1)

- Multi-tenant SaaS offering of the factory itself (single operator, many projects).
- Provisioning Clerk *production* instances, custom domains, Google OAuth, Stripe without a human. These remain gray steps (see §9).
- Replacing Machinist's foreman/shepherd prompts. Reuse them; extend via prompt templates only.
- Forking or patching SVCOS or Machinist. Where an EU variant needs template code (identity, payments), that is an *optional SVCOS module* proposed upstream, tracked here as a dependency, not built into the factory.
- Supporting application stacks other than SVCOS's Next.js + Convex shape. (Swapping *providers* within that shape is in scope; swapping the framework is not.)

---

## 3. Evaluation of the building blocks

### 3.1 Machinist (github.com/owainlewis/machinist)

**Facts (as of commit `fda16c2`, 2026-09-02; latest release v0.4.0, 2026-08-31):** Go, ~14.5k LOC, MIT, early access.

**Architecture** (`ARCHITECTURE.md`): "Machinist owns process execution, not orchestration."

- **Control plane** (`internal/controlplane`): SQLite, HTTP API, embedded Vite UI. Binds `127.0.0.1:7331`. Bearer-token worker auth (`worker.token`), CSRF for UI submissions. UI itself is unauthenticated.
- **Worker** (`internal/managedworker`): polls control plane advertising `executors`, `repositories`, `models`; receives a `RunSpec`; heartbeats; posts `Completion`.
- **Runner** (`internal/runner`): starts one process in one repository directory, writes the prompt to stdin, streams stdout/stderr, records artifacts and token usage (parses Claude/Codex `stream-json`), kills the process tree on timeout/cancel.
- **Config**: `config.toml` (portable commands, prompt templates, timeouts, triggers, server) and `worker.toml` (machine-local executor command arrays and repository paths). Executors are arbitrary command arrays; "any executable that accepts a prompt on stdin." Template parameters: `{{machinist.prompt}}`, `{{machinist.model}}`, `{{machinist.repository}}`.
- **Triggers**: GitHub label polling (1 min–24 h), interval, cron. **No webhooks.** Intake example: a GitHub Action validates collaborator permission and applies a label.
- **Invariants**: one job = one run (DB-enforced), terminal state only from process exit code, no stage model, no checkpoints, killed scripts restart from the beginning.

**API surface:**

```
GET  /api/v1/status
GET  /api/v1/catalog
GET  /api/v1/definitions
POST /api/v1/jobs                    (submit; CSRF or bearer) body {prompt, repository, command, model?}
DELETE /api/v1/jobs/{id}
POST /api/v1/workers/poll            (bearer)
POST /api/v1/runs/{id}/heartbeat     (bearer)
POST /api/v1/runs/{id}/complete      (bearer)
```

**Protocol** (`internal/protocol`): `PollRequest{instance_id,name,executors,repositories,models}` → `RunSpec{id,job_id,command,command_hash,executor,model,repository,rendered_prompt,timeout_millis,lease_token}`; `Completion{instance_id,lease_token,state,exit_code,error,result,events}`.

**Shipped prompts that matter:**

- **foreman** / **issue-to-pr**: issue → six state labels (`machinist:planning|building|verifying|ready-for-review|blocked|needs-human`) → planning subagent (optional) → build subagent in isolated worktree → independent read-only review subagent → repair loop (uncapped, numbered rounds) → foreman alone pushes the exact reviewer-approved SHA via immutable refspec → opens non-draft PR → waits for CI **and configured automated reviewers** to go terminal (30 s polls, 20 min budget) → `ready-for-review`. **Never merges.**
- **shepherd**: cron'd merge-queue advancer. Mutates only PRs carrying `machinist:auto-merge`; per-run `max_actions` budget; inventories all open PRs, builds branch-stack DAG, updates bases, delegates repairs, merges when every gate passes; audit comments carry `head/base/state/classification`. Never applies the permission label itself.
- **audit**: read-only code audit.

**Security posture:** local authority (repos, credentials, executor config stay on the worker), no arbitrary shell from the API, dedicated unprivileged `machinist` account, SHA-256-verified releases, untrusted-content rules baked into prompts.

**Constraints for this design:**

- Repositories must be pre-registered as local paths in `worker.toml`; a spec-born project has no repo yet.
- Control plane expects loopback; the client allows any `https://` non-loopback URL but rejects plaintext `http` to non-loopback hosts.
- One shared worker token for all workers.
- `Completion.events` is inline in one POST; very long runs produce large bodies.
- Executors run Codex/Claude with `--sandbox danger-full-access` / `--dangerously-skip-permissions`.

**Verdict:** Excellent execution substrate and prompt library. Not an orchestrator, and shouldn't be made into one.

### 3.2 Secure Vibe Coding OS (github.com/harperaa/secure-vibe-coding-OS)

**Facts (7.0.0 at `be73ee5`, 2026-08-19).** Two automation layers:

1. **Node scripts** — explicitly non-interactive, all input from CLI args:
   - `scripts/setup.mjs`: `init` (creates a Clerk **accountless** application if no keys are supplied, generates secrets, writes env; returns `claimUrl`), `convex-setup` (login check, team select via `--team=`, project create), `configure` (webhook + Convex env vars), `doppler-bootstrap`, `doppler-sync-env-local`, `doppler-create-ci-token`, `migrate-to-doppler`, `write-install-summary`.
   - `scripts/deploy.mjs`: `check-tools`, `gh-context`, `github-setup` (`--repo-name`, `--owner`; creates the private repo with `--source=. --push`), `convex-deploy-key`, `validate-keys`, `convex-deploy-functions`, `prod-webhook`, `convex-prod-env`, `vercel-env-dev` (Doppler-aware), `vercel-env`, `vercel-env-doppler`, `vercel-deploy`, `write-summary` (`--deploy-type=dev|prod`), `update-vercel-clerk-keys`.
   - `scripts/modules.mjs`: `list`, `status`, `install <modules> --apply-edits [--all] [--force] [--json]`. Modules shipped: `blog`, `dashboard-sample`, `homepage-content`, `pricing`.
2. **Claude Code slash commands** (`.claude/commands/*.md`) — interactive wrappers. `AskUserQuestion` counts: `install` 12, `deploy-to-dev` 6, `deploy-to-prod` 21, `security-assessment` 3, `create-new-site` 26.

**Headless install path (README "Headless / CLI Install"):**

```bash
npm install
node scripts/setup.mjs init --site-name="My Site" --admin-email="me@example.com" [--clerk-pk=... --clerk-sk=...]
node scripts/modules.mjs install homepage-content blog pricing --apply-edits
node scripts/setup.mjs convex-setup --project-name="My Site" [--team=slug]
node scripts/setup.mjs configure --admin-email="me@example.com"
node scripts/setup.mjs write-install-summary --modules-installed="..." --modules-skipped="..."
```

**Deploy-to-dev** is fully automated once `gh` and `vercel` are authenticated: creates the GitHub repo, links Vercel (`vercel project add`, `vercel link --yes`, `vercel git connect`), sets env (Doppler or legacy), deploys against dev Clerk + dev Convex, writes `docs/DEPLOYMENT-DEV.md`.

**Deploy-to-prod** requires humans for: Clerk production instance (dashboard only, needs a custom domain), Google OAuth, Stripe. Convex prod deploy, webhook, Vercel env, and deployment are scripted.

**Security assessment:** `security-orchestrator` agent runs strictly sequential sub-agents (threat-modeler, security-scanner with Semgrep + DeepSec + manual, security-tracer, security-reporter). `MODE: FRESH` archives everything; `MODE: REASSESSMENT` preserves DeepSec findings so it can `revalidate` and `process --diff` only changed files. Output in `security_context/` and `threat_modeling_output/`, reports in `security_reports/assessment_<ts>/`.

**CI:** `ci.yml` jobs `lint`, `test`, `security` (`npm audit --audit-level=high`, `npm ls`, Convex auth gate), `build`; `claude.yml` (`@claude` mentions), `claude-code-review.yml`, `sync-testing.yml`. No Greptile integration yet. `lockdown-main.sh` applies protection with contexts `lint, test, security, build`, `enforce_admins: true`, and `--solo` for zero required reviews.

**Conventions (CLAUDE.md):** branch from `main`; PRs to `main` only; Conventional Commits; one reviewer minimum; no secrets in code; no `@ts-ignore`; Doppler mode signalled by `.doppler.yaml`; `engines.node >=24.15.0 <26`.

**Verdict:** The genesis pipeline exists as scripts; the interactive layer is not a blocker. Remaining human gates are provider limitations (Clerk prod, OAuth, Stripe), not SVCOS limitations.

### 3.3 Greptile

- GitHub App; reviews on every push; posts a PR summary with a 0–5 confidence score plus inline comments with suggested fixes. Score reflects severity/quantity of issues, change complexity, and codebase-pattern alignment. Greptile's own scale: 5/5 production ready, 4/5 minor polish.
- No trigger API needed. Read reviews via `gh api /repos/{o}/{r}/pulls/{n}/reviews` and `/comments` filtered to the bot login. "Re-trigger Greptile" is available by comment.
- Configurable filters: labels, authors, branches, keywords. Use a label filter so Greptile only reviews factory PRs when desired.
- Separate metered REST API exists for codebase Q&A/search (`api.greptile.com/v2`), useful for triage context but not required.

---

## 4. Architecture

### 4.1 Layered view

```
┌──────────────────────────────────────────────────────────────────────┐
│  CLIENTS         Web UI (Next.js on SVCOS)   Hermes plugin   CLI     │
├──────────────────────────────────────────────────────────────────────┤
│  CONTROL PLANE   Convex + Clerk                                      │
│    • projects / runs / gates / events / decisions                    │
│    • GitHub App webhook receiver (httpAction)                        │
│    • scheduled functions, audit log                                  │
│    • PROVIDER ADAPTERS: hosting · identity · secrets · backend ·     │
│      payments · sandbox · llm · review · scm                         │
│    ── submits jobs to ──▶ Machinist control plane (Go, SQLite)       │
│                          default: local loopback via bridge/tunnel   │
│                          optional: Cloudflare Container + Litestream │
├──────────────────────────────────────────────────────────────────────┤
│  EXECUTION PLANE  Machinist workers (poll/heartbeat/complete)        │
│    DEFAULT : local worker on the operator's machine (author's shape) │
│    optional: sandbox-exec → Daytona | Cloudflare | Scaleway          │
│    inside each run: Claude Code / Codex · git · gh · SVCOS scripts   │
│    talks to: default: GitHub · Greptile · Vercel · Convex Cloud ·    │
│                       Clerk · Doppler · Clerk Billing/Stripe         │
│              eu:      GitHub · Scaleway · self-hosted Convex ·       │
│                       Keycloak/Zitadel* · Infisical · Mollie/PayOne* │
│              (* requires SVCOS optional module — upstream proposal)  │
└──────────────────────────────────────────────────────────────────────┘
```

### 4.2 Decision: what is the "API"?

| Option | Verdict |
|---|---|
| Public hosted multi-tenant API that also executes | Rejected: credentials and shell would live on a hosted box; contradicts Machinist's local-authority model and SVCOS's posture |
| Extend Machinist into the orchestrator | Rejected: maintainer removed pipelines on purpose; fork/merge tax |
| Modify SVCOS to be factory-aware | Rejected: SVCOS is a teaching template; the factory wraps, generates, and configures instead |
| **Convex+Clerk control plane, Machinist execution substrate, local execution by default** | **Chosen** |

Convex gives durable state, scheduled functions, real-time UI, and HTTP actions. Clerk gives auth for the Web UI and API keys for the Hermes plugin. The factory itself is an SVCOS install (dogfooding).

### 4.3 Stage state machine

```
DRAFT ──(spec accepted)──▶ GENESIS ──▶ BUILD[phase 1..n] ──▶ ASSESS(FRESH) ──▶ FIX ──▶ REVIEW_LOOP ──▶ DEPLOY_DEV ──▶ HANDOFF
                                        │  each phase: foreman → CI (incl. security CI) → Greptile → merge    ▲
                                        └──────────────── next phase ─────────────────────────────────────────┘
                                                                          └─(round cap hit / forced gray)──▶ NEEDS_HUMAN

MAINTAIN (post-handoff):
  GitHub event ──▶ TRIAGE ──▶ foreman ──▶ CI + Greptile ──▶ shepherd merge (dark) | human label (gray) ──▶ Vercel deploy
  major release ──▶ ASSESS(REASSESSMENT) ──▶ FIX ──▶ … ──▶ promote
```

**Assessment cadence.** The full `security-assessment` (orchestrator, DeepSec, Semgrep, threat model, tracing, report) runs **once after the initial build** and **on major releases** thereafter. It does **not** run per PR. Every PR instead runs the **security CI** job set (see §4.8), which is fast and deterministic. Rationale: the full assessment is 45–60 minutes of agent time and produces template-level findings that need baselining; per-PR value is low and cost/noise is high, while the CI checks catch the regressions that matter between assessments.

Each stage is **exactly one Machinist job**. Stage state, retries, and gate results live in Convex. A killed run restarts the stage cleanly; nothing depends on process memory. Convex tables (see `control-plane/convex/schema.ts`):

- `projects` — spec, repo, mode (dark/gray), thresholds, provider handles (Vercel project, Convex deployment, Doppler project), current stage, release policy (what counts as "major").
- `runs` — mirror of Machinist job/run ids, command, command hash, model, started/completed, state, exit code, token usage, result pointer.
- `gates` — per run: CI status (per job), Greptile score, security assessment verdict (when applicable), review findings count.
- `events` — audit stream (who/what/when, including label applications).
- `decisions` — what a human must decide, with evidence, for the decision drawer.

### 4.4 Stage → Machinist command mapping

| Stage | Command | Executor | Timeout | Notes |
|---|---|---|---|---|
| GENESIS | `genesis` | script (`genesis.sh`) | 45m | clones SVCOS template, runs headless install + `deploy-to-dev` chain, opens repo |
| BUILD[i] | `foreman` | claude/codex | 120m | one build phase from the plan; issue-per-phase |
| ASSESS | `assess` | claude | 60m | full assessment, FRESH after initial build, REASSESSMENT on major releases only; invoked via arguments (§4.10), never via interactive prompts |
| FIX | `foreman` | claude/codex | 120m | issue generated from assessment findings |
| REVIEW_LOOP | `greptile-fix` | claude/codex | 60m | reads bot comments, repairs, pushes; loop controlled by Convex |
| DEPLOY_DEV | `dev` | script (`deploy-dev.sh`) | 30m | `deploy.mjs` chain; idempotent |
| TRIAGE | `triage` | claude | 20m | classify issue/PR, set labels, decide gray/dark |
| MAINTAIN merge | `shepherd` | codex/claude | 120m | on webhook or cadence |

### 4.5 Genesis command

`factory/scripts/genesis.sh` (repository-owned script, Tier-0 executor) — inputs from `factory-spec.json` on stdin, operator settings from the environment (`factory/config/factory.env.example`). Step order:

1. clone template at `SVCOS_TEMPLATE_REF` into `$FACTORY_WORKSPACE/<name>` (skip if present)
2. `npm ci` (skip if warm)
3. `setup.mjs doppler-bootstrap --project-name` (skip if `.doppler.yaml`)
4. `setup.mjs init --site-name --admin-email [--clerk-pk --clerk-sk]` (skip if keys present; secret resolved through `resolve-secret.sh`, never from the spec)
5. `modules.mjs install <modules> --apply-edits --json`
6. `setup.mjs convex-setup --project-name [--team]` (skip if `NEXT_PUBLIC_CONVEX_URL` present)
7. `setup.mjs configure --admin-email`; `write-install-summary` with the claim URL
8. write factory-owned files (`AGENTS.md`, `factory-security.yml`, `.secrets.baseline`, `accepted.json`)
9. `deploy.mjs github-setup --repo-name --owner` (creates and pushes; skip if origin already correct)
10. `vercel project add`, `vercel link --yes`, `vercel git connect` (skip if `.vercel/project.json`)
11. commit and push remaining changes
12. `deploy-dev.sh` → `vercel-env-dev`, `vercel-deploy`, `write-summary --deploy-type=dev`
13. `lockdown-main.sh [--solo]` per mode, then `protect-main.sh` adds the factory contexts

Exit 0 = success (Machinist contract). Every step prints `GENESIS step=<name> outcome=<started|passed|skipped|failed>`; the final `RESULT status=ready repo=… url=… [clerk_claim_url=…]` line is parsed by Convex from events.

### 4.6 `factory-spec.json` (v0)

Schema: `spec/factory-spec.schema.json`. Example: `spec/examples/acme-analytics.json`.

```json
{
  "name": "acme-analytics",
  "pitch": "Team analytics for distributed engineering orgs",
  "admin_email": "owner@example.com",
  "github_owner": "acme",
  "modules": ["homepage-content", "dashboard-sample"],
  "secrets_mode": "doppler",
  "phases": [
    {"title": "Data model + Convex schema", "acceptance": ["schema typechecks", "seed script runs"]},
    {"title": "Team dashboard page", "acceptance": ["auth-gated", "renders seeded data"]}
  ],
  "mode": "gray",
  "greptile_threshold": 5,
  "max_repair_rounds": 4,
  "forced_gray_paths": ["middleware.ts", "convex/auth*", "app/api/**", "lib/security/**", "package.json"],
  "providers": {"profile": "default", "sandbox": "local"}
}
```

Spec elicitation (the conversational part of `/create-new-site`) moves into the Web UI / Hermes plugin; the spec is the artifact. Phases become GitHub issues so BUILD stages reuse the unmodified foreman prompt. Secrets are referenced (`clerk.secret_key_ref`), never embedded.

### 4.7 Review loop (Greptile)

```
push ──▶ wait for Greptile review on head SHA (poll ≤ every 30 s, ≤ 20 min)
      ──▶ parse score from review body; collect unresolved inline comments
      ──▶ score ≥ threshold AND no blocking comments ──▶ pass
      ──▶ else round += 1; if round > max_repair_rounds ──▶ NEEDS_HUMAN
      ──▶ submit `greptile-fix` job with comments as the prompt ──▶ push ──▶ loop
```

- Threshold is per-project. Greptile documents 4/5 as "minor polish" and 5/5 as production ready. Default 5 for dark-mode projects, with the round cap as the escape hatch.
- Machinist's foreman already waits for "configured automated reviewers" to go terminal, so Greptile also participates in foreman's own gate.
- Resolve review threads via `gh api` as part of the fix job so shepherd's inventory sees them as resolved.

### 4.8 Security: per-PR CI vs. periodic full assessment

Two different controls with two different cadences.

**Per PR — security CI (every PR, required checks).** Fast, deterministic, no agents:

| Check | Source | Exists today |
|---|---|---|
| `npm audit --audit-level=high` | `ci.yml` security job | yes |
| `npm ls --all` lockfile/tree consistency | `ci.yml` security job | yes |
| Convex auth gate (`scripts/check-convex-auth.mjs`) | `ci.yml` security job | yes |
| lint / typecheck / test / build | `ci.yml` | yes |
| `detect-secrets` scan | Husky pre-commit via `/setup-hooks`; `secrets` CI job | pre-commit only → added by factory |
| Semgrep (`--error` on ERROR severity) | `semgrep` CI job | added by factory |
| `scripts/security-check.sh` (audit + `npm ls`) | `security-check` CI job | added by factory |
| Dependency-change policy (new/upgraded packages → `factory:forced-gray`) | `security-check` job notice + Convex triage on `package.json`/lockfile diff | added by factory |

The additions live in a **factory-owned workflow file** written into each generated repo (`.github/workflows/factory-security.yml`, source in `factory/generated`), not in SVCOS's `ci.yml`. Branch protection is applied by the factory after `lockdown-main.sh` runs, adding `semgrep`, `secrets`, and `security-check` to the required contexts via a second `gh api` call (`factory/scripts/protect-main.sh`). Greptile runs in parallel as the AI reviewer.

**Periodic — full assessment (`ASSESS` stage).**

- Runs after the initial build (`MODE: FRESH`) and on **major releases** (`MODE: REASSESSMENT`, which preserves DeepSec findings for `revalidate` + `process --diff`). "Major" is a project policy: a semver major tag, a `release:major` label, or a manual trigger from the Web UI.
- Invoked headlessly with explicit arguments (§4.10): `assess --mode=fresh|reassessment|auto --deepsec=on|off|auto --baseline=<path> --max-new-medium=<n>`. The snapshot has `pnpm` and `.deepsec/` pre-initialized so the DeepSec prerequisites never prompt.
- **Baseline:** the first FRESH run on a fresh SVCOS install is stored as the template baseline. Subsequent runs open FIX issues only for findings that are new or elevated relative to the baseline; accepted findings are recorded in `security_context/accepted.json` (project-owned) and referenced in the audit log.
- Gate: zero new critical/high; new medium under project cap. Report artifacts attached to the run record and published to the Web UI.
- Findings → one GitHub issue per critical/high finding (file/line, skill reference, label `factory:security-finding`) → FIX foreman runs → normal PR path with per-PR security CI.

### 4.9 Dark vs. gray

- `machinist:auto-merge` is the switch. **Dark**: Convex applies the label once gates pass (`mayAutoMerge()` in `control-plane/factory/policy/forcedGray.ts`). **Gray**: only a human applies it.
- **Forced gray** regardless of mode when a PR touches `forced_gray_paths` (auth, payments, CSP/headers, middleware, dependencies) or when the risk classifier (triage job) marks it. Ties directly to the SVCOS skills map.
- Separation of duties: foreman never merges; shepherd merges; Convex never pushes code. Keep it — it is what an assessor will ask about.
- Post-handoff intake: GitHub App webhook → Convex → TRIAGE job → label `machinist:requested` → foreman. Replaces Machinist's label polling (instant, and no idle compute).

### 4.9a Worktree and checkout policy

All code changes happen in **git worktrees**, never in the registered checkout's working tree. This is Machinist's foreman contract (isolated worktree under `~/Code/.worktrees/<repo>/<task>`, `codex/`-prefixed branch, build/repair subagents confined to that worktree, only the foreman pushes an approved SHA) and the factory keeps it on every runtime.

Why it still matters when every run is a fresh sandbox:

- **Within a run** the foreman spawns build, review, and repair subagents; the worktree is what keeps the reviewer looking at exactly the SHA the builder produced and keeps repairs from contaminating the base checkout.
- **On the VM runtime** the registered checkout is shared across runs and across concurrent jobs; worktrees are the only isolation.
- **Foreman step 8** reviews the remote head "in a fresh isolated worktree" before handoff; that step is what catches a PR whose head moved after local review.

Rules by runtime:

| Runtime | Base checkout | Worktrees | Persistence across runs |
|---|---|---|---|
| VM | long-lived, registered in `worker.toml` | `~/Code/.worktrees/<repo>/<task>`; foreman keeps the worktree while its PR is open | yes; prune worktrees for merged/closed PRs on a schedule (`git worktree prune`) |
| Daytona | cloned per run from snapshot (or restored from a project volume) | same layout inside the sandbox | no by default; optional project volume for `node_modules`/DeepSec cache only, **not** for worktrees — every run re-creates its worktree from the remote |
| Cloudflare | cloned per run | same | no; ephemeral disk |

Consequences the state machine must respect:

- A repair round in a new sandbox cannot assume the previous run's worktree exists. `greptile-fix` and repair prompts start from `git fetch` + `git worktree add <path> <pr-head-branch>` and re-verify the head SHA against the PR before editing.
- Foreman's "keep the worktree while its PR is open" becomes "the PR branch on GitHub is the durable state; the worktree is rebuilt on demand." Nothing in Convex or Machinist stores a worktree path.
- Genesis is the one exception: it works in the sandbox root of a brand-new clone (there is no base branch to protect yet) and pushes `main` directly to create the repo. From the first phase issue onward, everything is worktree + PR.
- Shepherd never edits code itself; when it delegates a repair, the repair subagent follows the same worktree rules.
- `AGENTS.md` (§12.2 #5) states the worktree root and branch prefix so foreman and any human-run Claude Code session use the same layout.

### 4.10 Headless argument contract (no `AskUserQuestion` in the factory path)

An interactive question inside `claude --print` has no one to answer it; the run hangs until Machinist's timeout kills it or fails outright. The factory therefore **never drives an interactive SVCOS slash command**. It calls the layer underneath, which is already non-interactive:

- **Scripts** (`setup.mjs`, `deploy.mjs`, `modules.mjs`, `lockdown-main.sh`, `security-check.sh`) are invoked directly with flags.
- **Agents** (`security-orchestrator` and its sub-agents) are invoked from a factory-owned prompt that supplies `MODE:` and the DeepSec/pnpm decisions inline, exactly as the slash command would after its questions.
- **Factory wrappers** (`factory/commands/*.md` in the factory repo, rendered as Machinist prompts) own the argument contract below. They are the only place the factory needs to change when SVCOS evolves.

Three rules for the wrappers:

1. **Explicit argument wins.** If the argument is supplied, the wrapper never asks.
2. **Headless fails fast.** A missing required value prints `MISSING_ARG <name>` and exits non-zero. Never fall back to a prompt; never pick a default that changes security posture.
3. **Documented defaults for non-security choices only.** Module list and site-name derivation may default; auth, secrets mode, deployment targets, and provider profile must be explicit.

The same contracts are worth offering upstream to SVCOS as an `## Arguments` block on each command (so the interactive commands become argument-first for humans too), but the factory does not depend on that landing. See `docs/upstream/svcos-arguments.md`.

Wrapper contracts (factory-owned; each maps 1:1 to SVCOS scripts/agents, and mirrors what the interactive command would ask):

| Command | Arguments | Notes |
|---|---|---|
| `/install` | `--site-name`, `--admin-email`, `--secrets=doppler\|env`, `--modules=<csv\|none\|all>`, `--clerk-pk`, `--clerk-sk` (optional) | already fully covered by `setup.mjs`/`modules.mjs`; the markdown just needs to skip Phase 2 when args present |
| `/deploy-to-dev` | `--owner`, `--repo`, `--vercel-scope`, `--redeploy=yes\|no` | covers Step 0 "re-deploy?" and Step 1.5 owner/scope questions; `deploy.mjs github-setup`/`vercel-*` already take these |
| `/deploy-to-prod` | `--domain`, `--clerk-pk-live`, `--clerk-sk-live` (or `--from-doppler=prd`), `--stripe=now\|skip`, `--google-oauth=skip\|<client-id>`, `--confirm-prereqs=yes` | still a gray stage; args let a human pre-fill and the factory execute |
| `/security-assessment` | `--mode=fresh\|reassessment\|auto`, `--deepsec=on\|off\|auto`, `--install-pnpm=yes\|no`, `--baseline=<path>` | `auto` = fresh if no prior artifacts else reassessment; `--deepsec=auto` = on if `.deepsec/` exists |
| `/create-new-site` | `--spec=<factory-spec.json>`, `--phase=<n>`, `--auto-accept=yes` | factory uses foreman + phase issues instead; args exist for parity |
| `/add-module` | `<module ...> --apply-edits --no-confirm` | `modules.mjs` already non-interactive |
| `/rotate`, `/migrate-to-doppler` | `--yes`, `--phase=` | `--yes` patterns already exist |

Wrapper pattern (factory prompt, not an SVCOS file):

```markdown
## Arguments
Parse `$ARGUMENTS` for `--mode`, `--deepsec`, `--install-pnpm`, `--baseline`.
If `SVCOS_HEADLESS=1` or `--headless` is present: any question below whose value
was not supplied by an argument is an error — print `MISSING_ARG <name>` and stop.
Otherwise, ask only for values not supplied.
```

The Machinist command prompt renders, e.g., `assess --mode=reassessment --deepsec=on`, and the wrapper expands that into the orchestrator invocation SVCOS's `/security-assessment` would have produced after its questions, so SVCOS behaviour is identical whether a human or the factory drives it. A CI guard in the factory repo (`factory/scripts/check-no-askuserquestion.sh`) greps every wrapper for the interactive tool name and fails if found.

### 4.11 Provider abstraction and the EU profile

SVCOS ships against Vercel, Clerk, Doppler, Convex Cloud, and Clerk Billing/Stripe. Those stay the **default profile**. The factory never calls a provider directly; every stage goes through an adapter, and a project declares a profile in `factory-spec.json`:

```json
"providers": {
  "profile": "eu",
  "hosting": "scaleway",
  "identity": "zitadel",
  "secrets": "infisical",
  "backend": "convex-selfhosted",
  "payments": "mollie",
  "sandbox": "local",
  "llm": "anthropic-bedrock-eu"
}
```

#### Adapter contracts (factory repo, `control-plane/factory/providers/<kind>/<name>.ts`)

| Kind | Interface (minimal) | Default | EU variant(s) | How intrusive to SVCOS |
|---|---|---|---|---|
| **hosting** | `link(repo)`, `setEnv(env, kv)`, `deploy(env) → url`, `promote()` | Vercel (`deploy.mjs vercel-*`) | Scaleway Serverless Containers / Scaleway Cosmos for Next.js; Hetzner + Coolify as a second option | **none** — hosting is outside SVCOS code; the adapter replaces the `vercel-*` steps and writes `docs/DEPLOYMENT-*.md` in the same shape |
| **secrets** | `createProject`, `createConfig(env)`, `set(env, kv)`, `serviceToken(env)`, `exportEnv(env)` | Doppler (`.doppler.yaml` mode) | Infisical (EU cloud or self-hosted) | **none** — run SVCOS in its `env` (legacy) mode; the factory injects env from Infisical at build/deploy and into the sandbox. `sync-convex-env.mjs` is fed from `exportEnv` |
| **backend** | `createProject`, `deployKey(env)`, `deployFunctions(env)`, `setEnv(env, kv)`, `url(env)` | Convex Cloud (`setup.mjs convex-setup`, `deploy.mjs convex-*`) | **Convex self-hosted** (Docker) on Scaleway/Hetzner in an EU region, via `CONVEX_SELF_HOSTED_URL` + `CONVEX_SELF_HOSTED_ADMIN_KEY` | **none** — Convex CLI and app code are identical; only `convex-setup` is replaced by the adapter (it assumes Cloud) |
| **identity** | `createApp(env) → {publishableKey, secretKey, issuer}`, `webhook(env)`, `oidcConfig()` | Clerk (accountless dev app via `setup.mjs init`) | Keycloak or Zitadel (EU cloud or self-hosted) | **template code** — SVCOS's middleware, components, Convex `auth.config.ts`, and webhooks are Clerk-specific. Convex itself accepts any OIDC issuer, so the backend side is configuration; the frontend needs an **SVCOS optional module** (`auth-oidc`) |
| **payments** | `createProducts`, `checkoutUrl`, `webhook`, `entitlement(userId)` | Clerk Billing + Stripe | Mollie or PayOne | **template code** — same as identity; the pricing/subscription module is Clerk Billing-specific; needs an **SVCOS optional module** (`payments-mollie`, `payments-payone`) |
| **sandbox** | `create(snapshot, env)`, `exec`, `stream`, `destroy` | **local** (Machinist worker on the operator's machine) | Daytona (EU region), Cloudflare (EU jurisdiction hint), Scaleway Serverless Containers | none (Tier-0 wrapper executors) |
| **llm** | endpoint + credential per executor | Anthropic API / OpenAI API | Anthropic via AWS Bedrock (eu-central-1) or Google Vertex (europe-west), Mistral for Codex-compatible roles | none — Claude Code and Codex read endpoint/credential from env |
| **review** | `waitForReview(pr) → {score, comments}` | Greptile | Greptile (data-processing terms) or a self-hosted reviewer prompt run as a Machinist job | none |
| **scm** | webhooks, installation tokens, PR/labels | GitHub | GitHub (EU data residency for Enterprise) or self-hosted GitLab (would need a Machinist trigger shim) | none for GitHub; GitLab is out of scope v1 |

#### Rules

- Adapters are **pure functions over the provider's CLI/API** and produce the same artifacts SVCOS expects (`.env.local` shape, `docs/DEPLOYMENT-*.md`, Convex env vars), so SVCOS scripts downstream keep working unchanged.
- A profile is chosen at genesis and stored in Convex; changing a project's profile later is a migration stage, not a flag flip.
- Adapters expose `capabilities()` so the state machine can refuse a profile whose gaps aren't satisfied (e.g. `eu` with `identity: keycloak` before the `auth-oidc` module exists → `NEEDS_HUMAN` with an explicit reason).
- The two template-touching swaps (identity, payments) are tracked as **upstream SVCOS module proposals** (§12.5, `docs/upstream/svcos-modules.md`). Until they exist, the EU profile supports hosting, secrets, backend, sandbox, LLM, and review swaps with Clerk and Clerk Billing still in place; that is an honest "EU-hosted data plane, US identity" configuration and is labelled as such in the handoff.

#### Data-residency notes for the EU profile

- Local execution keeps repo contents and agent context on the operator's machine; only LLM prompts leave, to the configured EU endpoint.
- Convex control plane for the factory itself: use self-hosted Convex in the EU when the operator requires it; the state machine code is unchanged.
- Greptile processes repository content; verify its data-processing terms before enabling it in EU-profile projects, or use the self-hosted reviewer job.

### 4.12 Web UI design

The Web UI is the operator's window onto the line. It is built on SVCOS itself (Next.js, Tailwind, Clerk, Convex real-time queries), so the factory's own UI is a hardened SaaS by construction. Design work follows the frontend-design skill: plan tokens against the brief, review the plan for generic defaults, build, then critique with screenshots. Interactive mockups are produced in Claude Design; this section is the brief those mockups and the build follow. Tokens live in `control-plane/factory/ui/tokens.css`.

#### Brief

- **Subject:** a lights-out software factory. The vernacular is the manufacturing floor: stations, the line, work-in-progress, andon signals, stoppages, hand-off.
- **Audience:** one operator (Allen) and, later, security-minded engineers and GRC reviewers. They are expert; they do not need onboarding copy.
- **Primary job:** answer three questions at a glance. *Is the line running? Where is it stopped, and why? What do I have to decide?* Everything else (audit, spec drafting, provider settings) is secondary.
- **Constraint:** must read correctly on a phone (Hermes plugin and mobile use) and in a dark room.

#### Design plan (tokens)

**Color** — an instrument-panel palette, not a dashboard palette. Base surfaces are cool and calm; the only saturated colors are andon semantics and they mean exactly one thing each.

| Token | Hex | Role |
|---|---|---|
| `concrete` | `#E9ECEF` | page base (light mode) |
| `slate` | `#2B3440` | panel base (dark mode) and ink on light |
| `steel` | `#5B6B7C` | secondary text, rules, inactive stations |
| `brass` | `#B8863B` | brand accent: the single memorable color; used for the running indicator on the line and primary actions, nowhere else |
| `andon-run` | `#2F8F5B` | station passing / merged |
| `andon-hold` | `#D28B1E` | waiting on a gate, gray-mode review pending |
| `andon-stop` | `#B23A2E` | blocked, needs human, failed |

Light mode is the default (control rooms are lit; the *factory* is dark). Dark mode inverts `concrete`/`slate` and keeps andon colors identical. No gradients; no tinted near-blacks; shadows only on the one element that floats (the decision drawer).

**Type** — one family. **Schibsted Grotesk** for everything on the surface (UI, headings, tables), chosen for its slightly mechanical drawing and wide weight range; headlines set at 500, body at 400, data at 450 tabular figures. The only second face is a monospace inside log and diff panes, because that content *is* code; monospace is never used for labels or metadata. Type scale 12 / 14 / 16 / 20 / 28 / 40. Line length ≤ 72 characters in prose panels. Sentence case everywhere; no tracked-out caps, no eyebrows, no numbered markers except on the line itself (which *is* a sequence).

**Layout** — left-aligned, a fixed 240 px station rail on desktop, single column on mobile. Density is high but rhythm is strict: one 8 px grid, two radii only (2 px on data surfaces, 8 px on the decision drawer). Borders encode containment; they are not decoration.

**Principles**

1. **The line is the hero.** One element carries the design's boldness: a live horizontal production line across the top of every project screen, stations left to right (Genesis → Build 1..n → Assess → Fix → Review → Deploy → Handoff, then Maintain as a loop), each station a small instrument showing state, elapsed time, and the one number that matters there (Greptile score, findings, CI jobs). Work-in-progress moves along it. This is the one orchestrated motion; it responds to real events, never plays on page load.
2. **Andon, not alerts.** State is shown by color on the station and nowhere else; no toast storms, no badge counts. A stop turns the station red and opens the decision drawer.
3. **Decisions are first-class.** The decision drawer lists exactly what a human must do, with the evidence attached (foreman's blocked comment, Greptile comments, assessment findings) and one primary action named for what it does: "Apply auto-merge," "Send back to fix," "Mark as accepted finding." The action keeps its name through the flow.
4. **Evidence over narration.** Run pages show the prompt, command hash, events, token usage, artifacts, and the resulting SHA/PR. Agent chatter is collapsed; gate results are expanded.
5. **Quiet everywhere else.** Settings, spec editor, and audit are plain forms and tables. No cards-in-cards, no icon soup, no marketing copy.

#### Screens

**Floor** (home)

```
┌ Agentic Secure Dark Factory ───────────────────────────────────┐
│ ● 3 running   ◐ 2 waiting on review   ■ 1 stopped              │
├────────────────────────────────────────────────────────────────┤
│ acme-analytics    [G]━[B1]━[B2]━[A]━[F]━[R●]━[D]━[H]   review 4/5│
│ pulse-crm         [G]━[B1]━[B2■]                        stopped │
│ northwind-docs    maintain ↻  PR #41 merging · 2 issues queued  │
│ …                                                              │
├────────────────────────────────────────────────────────────────┤
│ Decisions (3)                                                  │
│  pulse-crm · Build 2 blocked — foreman could not resolve schema │
│  acme-analytics · Apply auto-merge? Greptile 5/5, CI green      │
│  northwind-docs · New dependency added; review required         │
└────────────────────────────────────────────────────────────────┘
```

**Project** — the line across the top, then the current station's evidence panel, then the project's open decisions. On mobile the line scrolls horizontally and the decision drawer becomes a bottom sheet.

**Run** — header (project, stage, runtime, model, elapsed, tokens), gate strip (CI jobs, Greptile, assessment), then a two-pane body: events/log (mono, filterable, follows tail) and artifacts/result. Cancel is the only destructive action and asks once.

**Decision drawer** — slides from the right on desktop, up on mobile. Title states the decision in plain language ("Merge PR #43 into main?"), evidence list, one primary action, one secondary ("Send back"), and a text field for a note that lands in the audit log.

**Spec** — a document-style editor for `factory-spec.json` fields with the phases as an editable sequence (numbered, because it is one), provider profile selection with `capabilities()` results shown inline, and a "Start the line" action.

**Audit** — a flat, dense table: time, project, actor (human or run id), action, before/after, evidence link. Exportable.

**Settings › Providers** — profile per project; each adapter shows its status and last verified time. Credentials are never displayed; rotation is a named action.

#### Copy rules

Name things by what the operator does, not how the system works: "Waiting for review," not "REVIEW_LOOP"; "Stopped: needs a decision," not "NEEDS_HUMAN". Errors say what happened and what to do: "Greptile has not reviewed this push after 20 minutes. Re-check, or send back to fix." Empty states point at the next action: "No projects yet. Start with a spec."

#### Quality floor

Responsive to 360 px; keyboard focus visible on every control; `prefers-reduced-motion` stops the line animation and shows static state; WCAG AA contrast on both modes; andon colors paired with shape/label so state never relies on color alone; live regions announce station changes for screen readers.

#### Generic-default check

Reviewed against the tells the frontend-design skill lists: not cream + serif + terracotta; not near-black + acid green (the obvious "dark factory" cliché, deliberately avoided; the *product* is dark, the *control room* is lit); no broadsheet hairlines; no identical rounded-card kit; no all-caps eyebrows, middle-dot meta strings, or monospace labels. The one bold choice is the live line; everything else is instrument-panel plain.

#### Process

1. Write the token system above into `control-plane/factory/ui/tokens.css` and a Tailwind theme.
2. Produce Floor, Project, Run, and Decision drawer as interactive mockups in Claude Design from this brief, with real project data from M1.
3. Build in the SVCOS app following the frontend-design skill; screenshot each screen in both modes at 360 px and 1440 px and critique against the principles before merging.
4. Copy review pass on every string before gray GA.

## 5. Execution plane: local by default, cloud optional

### 5.0 Default: local

The default runtime is the author's VM shape **on the operator's own hardware**: Machinist control plane bound to `127.0.0.1:7331`, one worker with `claude`/`codex` executors, the SVCOS template registered as a repository, agents running as an unprivileged user. On a Mac this is a `launchd`-supervised control plane + worker; on a home server or a cloud VM it is the author's `systemd` guide verbatim. Convex reaches it over an SSH tunnel or Tailscale from a bridge process on the same machine that polls Convex for stage requests and submits jobs locally, so the Machinist port is never exposed.

What "local" buys: no sandbox bill, no per-run credential injection plumbing (credentials are on the machine, as in the author's guide), full data residency, and the simplest possible M0/M1. What it costs: one long-lived box holding credentials, worktree pruning, and concurrency bounded by that machine.

Cloud sandboxes are opt-in per project (`providers.sandbox`) or per operator, and coexist with the local worker against the same control plane because Machinist workers advertise their own executors and repositories.

### 5.1 The seam

`internal/managedworker/worker.go::execute()` resolves repository and command, then makes one call:

```go
result, runErr := runner.Execute(ctx, runner.Options{RunID, ArtifactKey, Command, Repository, DataDirectory, Stdout, Stderr})
```

Everything above is transport/lease; everything below is "start one process in one directory." A sandbox variant replaces that call. Heartbeat ↔ sandbox alive; timeout/cancel ↔ delete sandbox. Control plane, UI, triggers, prompts are untouched.

### 5.2 Tier 0 — wrapper executor (chosen; zero changes to Machinist)

```toml
[executors.claude-sandbox]
command = ["<FACTORY_ROOT>/sandbox-exec/bin/sandbox-exec", "--backend=daytona", "--snapshot=svcos-factory", "--",
           "claude", "--print", "--verbose", "--output-format", "stream-json",
           "--model={{machinist.model}}", "--dangerously-skip-permissions"]
```

`sandbox-exec` (factory repo, one Go binary, backends `local|daytona|cloudflare|scaleway`): read prompt from stdin → create ephemeral sandbox → inject per-run env → run inner command with prompt piped → pump sandbox stdout to own stdout (Machinist's token parsing keeps working) → forward SIGTERM to destroy the sandbox → exit with inner exit code. Repository is a placeholder workspace dir; the real clone happens inside the sandbox. This is idiomatic Machinist ("repository-owned orchestration script") and requires no fork. The `local` backend is a passthrough, so the same executor definition works everywhere and the choice is a config value.

### 5.3 Tier 1 — `Runtime` interface (deferred; upstream-only)

A one-interface seam at the call site above would let Machinist own sandbox lifecycle natively:

```go
type Runtime interface {
    Execute(ctx context.Context, options runner.Options) (runner.Result, error)
}
```

Per G7 this is **not built in the factory**. It is worth proposing upstream with the Tier-0 wrapper as evidence, framed as "pluggable process location, not pluggable orchestration" (`docs/upstream/machinist-runtime-seam.md`). If it lands, `sandbox-exec` becomes redundant; if it doesn't, nothing here changes.

### 5.4 Tier 2 — Cloudflare-native worker (optional)

The Sandbox SDK runs only from Workers, so the Cloudflare variant is a Durable Object with an alarm loop polling the control plane over HTTPS. No host machine. Requires the control plane to be reachable over HTTPS (see §6). Also optional, and only relevant once an operator chooses Cloudflare.

### 5.5 Backend comparison

| | VM (author) | Daytona | Cloudflare Sandbox | E2B |
|---|---|---|---|---|
| Isolation | none beyond OS user | container (default) or VM class | VM per sandbox | Firecracker microVM |
| Credential model | long-lived on box | per-run env injection | per-run env **or egress-proxy injection (sandbox never sees secrets)** | per-run env |
| Egress control | host firewall | `networkBlockAll` / CIDR + domain allowlist | outbound Worker: allow/deny, TLS interception, per-instance policy | policy support (newer) |
| Persistence | disk | volumes, cold/hot snapshots, **forks** | snapshots; ephemeral disk | pause/resume (fs+mem) |
| Session cap | none | none (`autoStopInterval: 0`) | sleeps after timeout; no hard cap | 1 h Hobby / 24 h Pro |
| Max size | your VM | 4 vCPU / 8 GiB / 10 GB default (more on request) | standard-4: 4 vCPU / 12 GiB / 20 GB | plan-dependent |
| SDK | n/a | Python, TS, Go | TS (Workers only) | Python, TS (Go unofficial) |
| Control-plane coupling | none | none | Workers/DO | none |
| Fit | on-prem / regulated | Convex-centric control plane, volumes, forks | strongest security story; already-on-Cloudflare | short tasks |

**Ranking for this workload (when an operator opts into cloud):** Cloudflare (credential story) > Daytona (fit + volumes + forks) > E2B (session cap). For the EU profile, Daytona's EU region, Cloudflare's EU jurisdiction hint, or Scaleway Serverless Containers (French-hosted, Docker-based, no SDK-level sandbox primitives, so it uses the plain `docker run` path of `sandbox-exec`) are the candidates; the local default already satisfies residency.

### 5.6 Sandbox image (`svcos-factory` snapshot)

Base: `node:24-bookworm`. Installed: `git`, `gh`, `claude`, `codex`, `machinist`, `vercel`, `convex`, `doppler`, `pnpm`, `semgrep`, `detect-secrets`, `jq`. Pre-cloned SVCOS template with `node_modules` warmed (or on a Daytona volume). No credentials baked in. Agents run as `machinist`. Versions pinned in `snapshots/versions.env`; rebuild on SVCOS releases; tag by SVCOS commit.

---

## 6. Machinist control plane on Cloudflare (optional)

By default the Machinist control plane runs locally (§5.0). This section applies only when an operator wants no local machine at all.

### Option A — Go binary unchanged in a Cloudflare Container (chosen first step)

- **Persistence:** container disk is ephemeral. Run under **Litestream** replicating `machinist.db` to **R2**; restore on boot.
- **Front door:** a Worker with a Durable Object (`Container` class, `defaultPort = 7331`, `sleepAfter = "10m"`) forwards to the container. **Cloudflare Access** gates humans (UI is unauthenticated by design); workers use the bearer token (+ optional Access service token).
- **Config change:** `listen = "0.0.0.0:7331"` inside the container (port reachable only from its DO). Worker token injected as a Worker secret and written to `worker.token` by the entrypoint.
- **Sleep:** any polling worker keeps it awake; if it sleeps, next poll wakes it and Litestream restores; leases expire and requeue as designed.
- **Cost:** `lite` instance (1/16 vCPU, 256 MiB) ≈ $2–3/month awake 24/7 + $5 Workers Paid.
- **Trade-offs:** unchanged upstream; inline events body limit unchanged; one extra subrequest per API call (use WebSocket transport if the executor lives in the same Worker).

```dockerfile
FROM debian:bookworm-slim
COPY --from=build /machinist /usr/local/bin/machinist
COPY --from=litestream /litestream /usr/local/bin/litestream
COPY entrypoint.sh litestream.yml config.toml /
ENTRYPOINT ["/entrypoint.sh"]
```

```bash
#!/bin/sh
set -e
mkdir -p /data/server
printf '%s' "$MACHINIST_WORKER_TOKEN" > /data/server/worker.token
litestream restore -if-replica-exists -o /data/server/machinist.db "$R2_DB_URL" || true
exec litestream replicate -exec "machinist control-plane --config /config.toml"
```

```ts
export class MachinistCP extends Container { defaultPort = 7331; sleepAfter = "10m"; }
export default {
  async fetch(req: Request, env: Env) {
    return env.MACHINIST.get(env.MACHINIST.idFromName("singleton")).fetch(req);
  },
};
```

### Option B — Reimplement in Worker + D1

Port ~2k lines of Go; single deployable with executor and egress proxy; loses upstream and the UI. **Skip.**

### Option C — Convex speaks the Machinist worker protocol (endgame)

Implement `POST /api/v1/workers/poll`, `/runs/{id}/heartbeat`, `/runs/{id}/complete` as Convex `httpAction`s over `runs` tables. VM and sandbox workers poll Convex directly; the Machinist control-plane process disappears; your Web UI replaces its UI. Design Convex schema from day one so this is a deletion, not a rewrite.

---

## 7. Persistent components and placement

| # | Component | Persistent? | Where | Holds |
|---|---|---|---|---|
| 1 | Convex + Clerk control plane | yes (managed) | Convex cloud | state machine, policy, audit, webhook receiver |
| 2 | Machinist control plane | yes (small) | **local loopback (default)** / Cloudflare Container (A) / folded into Convex (C) | job queue, leases, run history, run UI |
| 3 | Worker | yes | **local Machinist worker (default)**; optionally a sandbox poller beside #2 or a Cloudflare DO alarm loop | local: credentials as in the author's guide; sandbox: worker token + secrets-adapter read token |
| 4 | GitHub App | yes (GitHub) | GitHub | webhooks, installation tokens |
| 5 | Doppler | yes (managed) | Doppler | per-project `dev`/`prd` configs + factory config |
| 6 | Greptile | yes (managed) | GitHub App | reviews, scores |
| 7 | Per-run execution | local: worktree on the worker (persists) / cloud: sandbox destroyed after run | local worker / Daytona / Cloudflare / Scaleway | repo, agents, provider CLIs, credentials |
| 8 | Generated SaaS | yes | default: Vercel + Convex + Clerk + Doppler; EU: Scaleway + self-hosted Convex + Keycloak/Zitadel + Infisical (+ Mollie/PayOne) | the product; factory touches it only via GitHub + adapters |

State locations: spec/stages/policy → Convex; job/run records → Machinist SQLite (→ R2 via Litestream); code → GitHub; secrets → Doppler; image → snapshot; build cache → Daytona volume (no Cloudflare equivalent; use R2 or re-fetch).

**Minimum footprint (default, local):** the operator's machine running Machinist CP + worker + bridge, Convex free tier, Doppler. No cloud sandbox bill. **Minimum cloud footprint:** one `lite`/1-vCPU box (Machinist CP + poller), Convex free tier, Doppler, Workers Paid $5, pay-per-run sandboxes.

---

## 8. Credentials and network

### 8.1 Credentials

**Local default:** credentials live on the worker machine exactly as in Machinist's VM guide (`gh auth`, `claude`, `codex`, Vercel/Convex/Doppler logins under the `machinist` user), with the secrets adapter (Doppler or Infisical) as the source of truth for project secrets. **Cloud sandboxes** switch to per-run injection:

#### Per-run injection (cloud sandboxes only)

| Credential | Source | Scope | Lifetime |
|---|---|---|---|
| GitHub token | GitHub App installation token for this project | one repository | ~1 h |
| `DOPPLER_TOKEN` | Doppler service token for project/config | one config | revocable; rotate via `/rotate` |
| `CONVEX_DEPLOY_KEY` | Convex | one deployment | until rotated |
| Vercel token | Vercel | team/project scoped | until rotated |
| `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN`, `OPENAI_API_KEY` | factory Doppler config | spend-limited keys | until rotated |
| Daytona / Cloudflare API key | factory Doppler config | worker only, never in sandbox | until rotated |

On Cloudflare, prefer **egress-proxy credential injection**: the sandbox makes plain requests to GitHub/Anthropic/etc. and the outbound Worker attaches credentials; the agent never holds them.

### 8.2 Egress allowlist (all backends)

`github.com`, `api.github.com`, `codeload.github.com`, `registry.npmjs.org`, `api.anthropic.com`, `api.openai.com`, `vercel.com`/`api.vercel.com`, `*.convex.cloud`/`api.convex.dev`, `api.doppler.com`, `api.clerk.com`, Semgrep/DeepSec registries as needed. Deny everything else. Log denied attempts to the run record (prompt-injection signal).

### 8.3 Threat model sketch (STRIDE-lite)

Expanded in `docs/security/threat-model.md`.

| Threat | Control |
|---|---|
| Prompt injection via issue/PR/repo content directs agent to exfiltrate | egress allowlist; credential injection at proxy; foreman/shepherd "untrusted task data" rules; forced-gray on sensitive paths |
| Compromised sandbox pivots to other projects | ephemeral per-run sandbox; per-run scoped tokens; no shared filesystem across projects (volumes per project) |
| Agent merges unsafe change in dark mode | Greptile threshold + assessment gate + CI + forced-gray + round cap + `max_actions`; shepherd never adds the permission label |
| Control plane exposure | Cloudflare Access; bearer token; loopback or DO-only port |
| Supply-chain (npm worms) | SVCOS `npm audit`, `npm ls`, `/dependency-incident-check`, pinned actions; new-dependency PRs forced gray |
| Secret sprawl | Doppler as sole broker; `/rotate`; no `.env` in sandboxes beyond Doppler-fetched values |

---

## 9. Human gates (unavoidable in v1)

| Step | Why | How it's handled |
|---|---|---|
| Clerk production instance | dashboard-only; requires custom domain | one-time gray step; keys stored in Doppler `prd`; DEPLOY_PROD stage waits on a Convex "provisioned" flag |
| Custom domain / DNS | ownership | same |
| Google OAuth credentials | Google console | optional; same |
| Stripe | account + Clerk Billing | optional; same |
| Convex team creation | account-level | one-time per operator |
| Doppler workspace / service account | account-level | one-time per operator |

Dark mode therefore delivers a **dev-Clerk `*.vercel.app` URL** end-to-end; production promotion is dark only after the one-time provisioning.

---

## 10. Cost model (rates verified 2026-09; re-check quarterly)

### 10.1 Rate cards

- **Daytona:** vCPU $0.000014/s ($0.0504/h); memory $0.0000045/GiB-s ($0.0162/GiB-h); storage $0.00000003/GiB-s; no subscription; $200 credit. Billed on provisioned resources while running.
- **Cloudflare:** Workers Paid $5/mo (includes 25 GiB-h memory, 375 vCPU-min, 200 GB-h disk); memory $0.0000025/GiB-s ($0.009/GiB-h) provisioned; **CPU $0.00002/vCPU-s on active use only**; disk $0.00000007/GB-s; egress 1 TB/mo included (NA/EU). Fixed instance types: standard-3 = 2 vCPU/8 GiB/16 GB; standard-4 = 4 vCPU/12 GiB/20 GB.
- **E2B:** ~$0.0504/vCPU-h + memory, plus $150/mo Pro floor beyond 20 concurrent or 1-hour sessions.

### 10.2 Per hour, 2 vCPU / 8 GiB build sandbox

| CPU utilization | Daytona | Cloudflare standard-3 |
|---|---|---|
| 25% (agent waiting on model) | $0.23 | $0.11 |
| 50% (Semgrep/DeepSec/`next build`) | $0.23 | $0.15 |
| 100% | $0.23 | $0.22 |

### 10.3 Scenarios

**One product, spec → 5/5 → URL (≈5.75 sandbox-hours):** Daytona ≈ $1.30; Cloudflare ≈ $0.70. Tokens for the same 5.75 h of agent time: ~$30–150. **Compute is 1–3% of job cost.**

**Ongoing per repo/month** (shepherd 30-min cron ≈ 120 h on 1 vCPU/4 GiB + 20 triage jobs × 1 h): Daytona ≈ $19; Cloudflare ≈ $8.50 (+$5 once). Replacing cron with webhook wake-ups drops the shepherd line to ~0 on both.

**Always-on:** Machinist CP on a `lite` container ≈ $2–3/mo.

### 10.4 Levers

Webhooks over polling; right-size instance per stage (triage on `basic`, build on `standard-3`, assessment on `standard-4`); cache `node_modules` (Daytona volume / R2 tarball); cap repair rounds; prefer cheaper models for triage.

---

## 11. Observability and failure handling

- **Run record** = Machinist `result.json` + events + Convex gate results; link to sandbox id, snapshot tag, command hash, model, token usage, PR/SHA.
- **Metrics:** stage durations, repair rounds per PR, Greptile score distribution, assessment finding counts, token spend per project/stage, sandbox $ per stage, denied egress count.
- **Failure classes:**
  - *Timeout/cancel:* sandbox deleted; stage marked `failed`; Convex retries once with a fresh sandbox; second failure → `NEEDS_HUMAN`.
  - *Blocked by foreman (`machinist:blocked`):* surfaced in UI with the foreman's evidence comment.
  - *Provider credential failure:* stage `failed`, reason `credential`; no retry; alert.
  - *Greptile absent/slow:* foreman's own 20-min automation gate → `blocked`; Convex re-queues after a backoff.
  - *Assessment regression:* FIX stage; if findings recur 2× on the same file, force gray.
- **Alerts:** Convex → Slack/email on `NEEDS_HUMAN`, `blocked`, credential failures, spend threshold.

---

## 12. Reliability analysis and risks

### 12.1 Can this reliably install, edit, assess, and maintain SVCOS?

| Phase | Confidence | Basis | Failure modes |
|---|---|---|---|
| **Install (genesis)** | High once R1/R2 verified | `setup.mjs`/`deploy.mjs` are deterministic, arg-driven; Clerk accountless needs no human; `deploy-to-dev` documented as fully automated | Convex/Doppler project creation headless (unverified); no checkpoints → mid-run failure re-runs from scratch (mitigated by idempotent steps) |
| **Edits (build phases)** | Medium | Foreman is Machinist's primary, eval-backed workflow; build → independent review → repair loop is solid | Agent nondeterminism; phase-issue quality; convention mismatches with SVCOS |
| **Security (per-PR CI)** | High | Existing `ci.yml` jobs + Semgrep + detect-secrets; deterministic | Flaky `npm audit` advisories; Semgrep rule tuning |
| **Security (full assessment)** | Medium-high after headless args | Orchestrator + sub-agents run under `claude --print`; REASSESSMENT mode exists | interactive prompts (fixed by §4.10); DeepSec/pnpm bootstrap (fixed by snapshot); template-level noise (fixed by baseline) |
| **Maintain (triage → PR → merge)** | Medium | Foreman + shepherd are Machinist's most-tested parts; Greptile loop is simple `gh api` | Branch protection vs dark merges; Greptile timing; new triage/loop code |

### 12.2 Specific breakages and their fixes

1. **Branch protection defeats dark mode as configured.** `lockdown-main.sh` sets `required_approving_review_count`, `enforce_admins: true`, and required checks; `CLAUDE.md` requires one reviewer who is not the author. Shepherd never bypasses required reviews. **Fix:** per repository, either (a) a factory reviewer identity (second GitHub App, or a review automation with approval enabled) submits the approving review after gates pass, or (b) dark-mode repos run `lockdown-main.sh --solo` (`review_count=0`) and rely on security CI + Greptile + shepherd gates. Gray mode works unchanged. Genesis applies `LOCKDOWN_MODE_DARK` / `LOCKDOWN_MODE_GRAY` from the operator environment.
2. **Interactive prompts inside slash commands.** **Fix:** §4.10 argument contracts; the factory invokes scripts and agents directly; snapshot pre-installs `pnpm` and `.deepsec/`.
3. **Claude Code refuses `--dangerously-skip-permissions` as root.** Sandbox images default to root. **Fix:** snapshot runs agents as an unprivileged `machinist` user (mirrors the VM guide).
4. **Genesis has no checkpoints** (Machinist restarts killed scripts from the beginning). **Fix:** `genesis.sh` is idempotent: it probes for the existing clone, `.doppler.yaml`, Clerk keys, Convex URL, GitHub origin, and Vercel link before each step; `deploy-to-dev` already checks for an existing deployment.
5. **Convention mismatches between foreman and SVCOS.** Foreman uses `codex/` branch names and its own PR flow; SVCOS expects `feat/|fix/|chore/`, Conventional Commits, Husky/detect-secrets hooks, PRs to `main`. **Fix:** repo-level `AGENTS.md` (foreman reads it from the trusted base branch) stating branch prefix and PR conventions (`factory/generated/AGENTS.md`).
6. **Greptile timing.** Foreman's automated-reviewer gate gives up after 20 minutes; Greptile on a large first commit can exceed that while indexing. **Fix:** Convex re-queues `machinist:blocked` runs after a delay instead of failing; use Greptile's label filter so it reviews only ready PRs.
7. **Clerk accountless applications** created without an account may have a claim window. **Fix:** verify TTL; surface the claim URL in the handoff (`RESULT … clerk_claim_url=`) and in the Web UI; alert before expiry.
8. **Assessment noise on the template.** **Fix:** baseline the first FRESH run; open FIX issues only for new/elevated findings (§4.8).

### 12.3 What not to worry about

Machinist's execution core (leases, timeouts, artifacts, token accounting) is mature; SVCOS's script layer is built for headless use and already runs in CI; Vercel git integration makes "merge to main" the deploy; the Convex state machine is straightforward code.

### 12.4 Net assessment

Install, per-PR security CI, periodic assessment, and gray-mode maintenance: **yes, cleanly**, after R1/R2 are resolved and the argument contracts land. Dark-mode maintenance: **yes**, after the required-review decision (12.2 #1). Unattended edits from a spec: the least deterministic part; expect early projects to land in `NEEDS_HUMAN` at phase boundaries until phase-issue templates are tuned. M0/M1 are the proving ground for fixes 1–5.

### 12.5 Upstream non-interference policy (G7)

Every touchpoint with SVCOS or Machinist, and how the factory avoids modifying them (proposals in `docs/upstream/`):

| Touchpoint | Factory approach | Upstream proposal (optional, non-blocking) |
|---|---|---|
| Interactive SVCOS commands | factory wrappers call scripts/agents directly (§4.10) | `## Arguments` blocks on SVCOS commands |
| Security CI additions | `factory-security.yml` written into each generated repo; branch-protection contexts added by a second `gh api` call | fold Semgrep/detect-secrets into SVCOS `ci.yml` |
| Assessment baseline | `security_context/accepted.json` in the generated repo | none needed |
| Conventions for agents | `AGENTS.md` generated into each repo | none needed |
| Provider swaps (hosting, secrets, backend, sandbox, LLM, review) | factory adapters (§4.11); SVCOS runs in its `env` mode for non-Doppler secrets | none needed |
| Provider swaps (identity, payments) | **cannot be done without template code**; factory refuses the profile until a module exists | SVCOS optional modules `auth-oidc` (Keycloak/Zitadel), `payments-mollie`, `payments-payone` |
| Machinist sandbox execution | Tier-0 `sandbox-exec` wrapper executor | Tier-1 `Runtime` seam |
| Machinist control plane placement | run as shipped (local or in a container with Litestream) | none needed |
| Machinist triggers | Convex webhook → label → submit via API; label polling untouched | none needed |
| Prompts | foreman/shepherd used verbatim (fetched at the pinned release by `install-machinist-config.sh`); factory-specific prompts (`assess`, `greptile-fix`, `triage`) live in the factory repo | none needed |

Rule: if a change *only* makes sense inside SVCOS or Machinist, it is filed as an upstream proposal and the factory degrades gracefully (`NEEDS_HUMAN` with reason, or feature disabled) until it lands.

### 12.6 Risk register

| # | Item | Status |
|---|---|---|
| R1 | Convex **project creation** headless: `convex-setup` parses a logged-in session; deploy keys are per-deployment. Need an account-level token that works non-interactively. | **verify** |
| R2 | Doppler **project creation** headless: needs a service-account token with project-create scope, not a per-config token. | **verify** |
| R3 | Machinist `/complete` inline events size for long `stream-json` runs. | measure; stream to R2 if needed |
| R4 | Single shared worker token across all workers. | fine single-tenant; per-worker tokens before multi-tenant |
| R5 | Daytona per-sandbox max 4 vCPU / 8 GiB without support request vs. DeepSec + Semgrep + `next build` concurrently. | benchmark |
| R6 | Cloudflare Sandbox SDK at 1.0 preview; API churn. | pin version; migration budget |
| R7 | Greptile 5/5 gate looping on nits for large PRs. | per-project threshold + round cap |
| R8 | Upstream acceptance of a `Runtime` seam in Machinist. | open issue with Tier-1 diff in hand; Tier-0 works regardless |
| R9 | Clerk accountless apps: claim/expiry semantics for unattended projects. | verify TTL; surface claim URL in handoff |
| R10 | Cost variance: vendor pricing pages change quarterly. | re-verify before budgeting |
| R11 | Required-review branch protection vs dark-mode merges. | decide per repo (12.2 #1) |
| R12 | Interactive questions in any reused SVCOS command hang headless runs. | argument contracts (§4.10); CI guard |
| R13 | Semgrep/detect-secrets false positives blocking PRs. | tune rules; allow-list file with review |
| R14 | EU identity/payments swaps depend on SVCOS optional modules that do not exist yet. | track as upstream proposals; EU profile ships as "EU data plane, Clerk identity" until then, labelled in handoff |
| R15 | Convex self-hosted operational burden (Postgres/SQLite backend, backups, upgrades) for EU projects. | adapter provisions via Docker Compose on Scaleway/Hetzner; document backup cadence; consider Convex's EU cloud region if/when offered |
| R16 | Adapter drift: a provider CLI change breaks an adapter while SVCOS scripts still assume the default provider's artifacts. | adapter contract tests that assert the produced `.env.local`/`DEPLOYMENT-*.md` shape; pin CLI versions in the snapshot |
| R17 | Local default concentrates credentials on one machine. | unprivileged user, disk encryption, secrets adapter as source of truth, `/rotate` cadence; cloud sandboxes available when the operator wants ephemeral credentials |
| R18 | Machinist moves fast (v0.2.0 → v0.4.0 in three days); prompt and config formats may change under the factory. | pin `MACHINIST_VERSION`; fetch prompts at that tag; re-verify on every bump |

## 13. Repository

### 13.1 Name and positioning

- **GitHub repo:** `agentic-secure-dark-factory` (org: same as SVCOS). Short name in tooling and CLI: `asdf`? No: it collides with the `asdf` version manager. Use **`sdf`** for the CLI and `factory` in prose.
- **Description (GitHub "about"):** *Security-first, lights-out software factory: turns a spec into a hardened SaaS on Secure Vibe Coding OS, drives it through security CI, AI review, and periodic assessment, and maintains it in dark or gray mode.*
- **Topics:** `devsecops`, `agentic`, `secure-by-default`, `claude-code`, `machinist`, `secure-vibe-coding`, `supply-chain-security`, `data-residency`.
- **License:** MIT (matches Machinist; SVCOS licence respected as a dependency, never vendored).

"Secure" is the first word after "Agentic" on purpose; the README, the docs tree, and the repo's own CI make the claim concrete rather than decorative.

### 13.2 README opening

See `README.md`; it leads with "A lights-out software factory that will not ship what it cannot prove is safe" and the "Security first, by construction" list.

### 13.3 Layout

```
agentic-secure-dark-factory/
├── README.md                     security-first framing
├── SECURITY.md                   disclosure policy, supported versions, what dark mode does NOT protect against
├── LICENSE
├── Makefile                      check / build / test / lint / guard / spec / typecheck
├── .secrets.baseline             detect-secrets baseline for this repo
├── docs/
│   ├── design.md                 this document
│   ├── security/
│   │   ├── threat-model.md       §8.3 expanded; STRIDE per plane; assumptions and residual risk
│   │   ├── controls-matrix.md    control → where enforced → evidence artifact (assessor-facing)
│   │   └── dark-mode-checklist.md preconditions before enabling dark mode
│   ├── runtimes/                 local, daytona, cloudflare, scaleway
│   ├── providers/                default and eu profiles; adapter contracts
│   └── upstream/                 proposals for SVCOS modules and the Machinist Runtime seam
├── control-plane/                factory-owned code for the SVCOS-based Next.js + Convex app (scaffold lands in M3)
│   ├── convex/                   schema (projects, runs, gates, events, decisions); factory mutations; GitHub webhook httpAction
│   ├── factory/policy/           forced-gray classifier, auto-merge rule
│   ├── factory/ui/tokens.css
│   └── scripts/validate-spec.mjs
├── factory/
│   ├── commands/                 Machinist prompts: assess, greptile-fix, triage (+ foreman/shepherd referenced, not copied)
│   ├── config/                   config.toml and worker.toml templates; factory.env.example
│   ├── scripts/                  genesis.sh, deploy-dev.sh, protect-main.sh, apply-generated.sh, submit-job.sh, …
│   └── generated/                files written into every product repo: AGENTS.md, factory-security.yml, .secrets.baseline, accepted.json
├── sandbox-exec/                 Go binary; backends local | daytona | cloudflare | scaleway
├── snapshots/                    Dockerfile for svcos-factory image (unprivileged user, pinned CLIs), versions.env, build.sh
├── spec/
│   ├── factory-spec.schema.json
│   └── examples/
└── .github/workflows/            the factory's own security CI and release workflow (see 13.4)
```

### 13.4 The repo practices what it enforces

The factory's own repository runs the same controls it imposes on generated products, so the security-first claim is checkable from the first commit:

- **Branch protection** via the same `lockdown` approach: required checks `lint, test, security, semgrep, secrets, build, guard`; one required review; admins not exempt.
- **Security CI:** `npm audit --audit-level=high`, `npm ls --all`, Semgrep, `detect-secrets`, `govulncheck` and `gosec` for the Go executor, Trivy config scan, the `AskUserQuestion` guard on `factory/commands/*`, and a guard that every GitHub Action is pinned by commit SHA.
- **Signed releases:** `sandbox-exec` published with SHA-256 checksums and build provenance attestations (mirrors Machinist's verified-release practice).
- **Pinned actions and CLIs:** every GitHub Action by SHA; every CLI in the snapshot by version.
- **Dogfood:** once M4 lands, the factory maintains its own repo in gray mode, and the README badge shows the last full assessment date and score.
- **SECURITY.md** states plainly what dark mode does not protect against (spec-level design flaws, provider-side compromise, prompt injection that survives review), so the security-first claim is honest, not absolute.

### 13.5 Initial setup steps

1. `gh repo create <org>/agentic-secure-dark-factory --public --description "…" --license mit`, add topics.
2. Commit `README.md`, `SECURITY.md`, `docs/design.md` (this file), `docs/security/threat-model.md`, `spec/factory-spec.schema.json`.
3. Add the security CI workflow and branch protection **before** any application code.
4. Scaffold `control-plane/` from SVCOS with `factory/scripts/scaffold-control-plane.sh <svcos-checkout>` (copies the template without any provider state), then run its headless install (the factory's first "genesis", done by hand). Never copy a checkout's `.env.local` or `.doppler.yaml`: the first attempt did, and the control plane's functions were pushed to that checkout's Convex deployment until it was restored.
5. Add `factory/commands`, `factory/config`, `genesis.sh`, and `sandbox-exec` skeleton with the `local` backend.
6. Tag `v0.0.1` and run the first `security-assessment` on the repo itself; commit the baseline.

## 14. Milestones

0. **M-1 — Repository (1 day).** Create `agentic-secure-dark-factory` per §13: README, SECURITY.md, threat model, security CI, and branch protection before any code.
1. **M0 — Local proof (1 week).** Stand up Machinist per the VM guide **on the operator's machine** with SVCOS registered. Run foreman on a real issue. Confirm Greptile comments appear and foreman's automated-reviewer gate sees them. Zero changes to either repo.
2. **M1 — Genesis + headless args (2 weeks).** `genesis.sh` (idempotent) + `factory-spec.json`. The §4.10 argument contracts in the factory prompts and the CI guard. Prove spec → dev URL with zero prompts on the local runtime. Resolve R1/R2. `AGENTS.md` conventions.
3. **M2 — Provider adapters + optional sandbox (2 weeks).** Adapter interfaces with the default implementations (Vercel, Clerk, Doppler, Convex Cloud) extracted from `genesis.sh`; contract tests on produced artifacts. `sandbox-exec` with `local` passthrough and one cloud backend (Daytona); `svcos-factory` snapshot; egress allowlist on. Cloud remains opt-in.
4. **M3 — Control plane (2–3 weeks).** Convex+Clerk app with projects/runs/gates/events; GitHub App webhook → TRIAGE → job submit via the bridge; Machinist CP in a Cloudflare Container (Option A) behind Access for operators who want it; Web UI skeleton.
5. **M4 — Gates (2 weeks).** Per-PR security CI (Semgrep, detect-secrets, `security-check.sh`) as required checks; Greptile review loop; `ASSESS` stage on initial build + major release with baseline; forced-gray classifier; round caps; required-review decision; alerts.
6. **M5 — Gray GA (1 week).** Run real projects in gray mode; tune thresholds; audit trail review.
7. **M6 — Dark mode per repo.** Enable `machinist:auto-merge` automation for low-risk repos; monitor.
8. **M7 — EU profile, phase 1.** Adapters for Scaleway hosting, Infisical secrets, self-hosted Convex, EU LLM endpoints; `capabilities()` gating; first EU project in gray mode with Clerk identity.
9. **M8 — Upstream proposals.** Open SVCOS module proposals (`auth-oidc`, `payments-mollie`/`payments-payone`) and the Machinist `Runtime` seam issue; Cloudflare DO worker (Tier 2) and Option C only if an operator needs them.

---

## 15. Appendix

### A. Machinist label vocabulary used by the factory

- Foreman state (one at a time on the issue): `machinist:planning`, `machinist:building`, `machinist:verifying`, `machinist:ready-for-review`, `machinist:blocked`, `machinist:needs-human`.
- Intake: `machinist:requested` (from TRIAGE; equals the configured trigger label if polling is kept as a fallback).
- Permission: `machinist:auto-merge` (shepherd's sole mutation permission; applied by Convex in dark mode, by humans in gray).
- Factory-added: `factory:forced-gray`, `factory:security-finding`, `factory:phase-<n>`, `factory:kind:<kind>`, `factory:risk:<risk>`.

### B. `config.toml` commands

See `factory/config/config.toml.tmpl`; rendered by `factory/scripts/install-machinist-config.sh`.

### C. Convex `httpAction` for the GitHub App webhook

See `control-plane/convex/http.ts` (HMAC verification, issue/PR → TRIAGE enqueue, reviewer and check-suite → gate update).

### D. Greptile score parsing

See `factory/scripts/greptile-score.sh`.

### E. Glossary

- **Dark mode** — gates pass → auto-merge → auto-deploy, no human in the loop.
- **Gray mode** — gates pass → PR staged `ready-for-review`; a human applies `machinist:auto-merge`.
- **Genesis** — the one-shot job that turns a spec into a repo, provider resources, and a dev URL.
- **Stage** — one Convex state-machine step, executed as exactly one Machinist run.
- **Runtime** — where a Machinist run's process executes (local by default; Daytona, Cloudflare, Scaleway optional).
- **Provider profile** — the named set of adapters a project uses (`default` = Vercel/Clerk/Doppler/Convex Cloud; `eu` = Scaleway/Keycloak-or-Zitadel/Infisical/self-hosted Convex, with Mollie/PayOne for payments once modules exist).
- **Adapter** — factory-owned code that talks to one provider and produces the artifacts SVCOS expects, so SVCOS is unchanged.
