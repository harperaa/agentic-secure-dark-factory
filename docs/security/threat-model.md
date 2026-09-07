# Threat model

STRIDE-lite per plane (design §8.3), with the assumptions each control rests on and the
risk that remains. Read with `controls-matrix.md` (where each control is enforced) and
`dark-mode-checklist.md` (preconditions before removing the human from the loop).

## Assets

| Asset | Where it lives | Owner |
|---|---|---|
| Product source and history | GitHub | product repository |
| Product secrets (Clerk, Convex, Doppler tokens) | Doppler or Infisical; Vercel holds only `DOPPLER_TOKEN` | secrets adapter |
| Factory credentials (GitHub App key, model API keys, provider tokens) | local worker account (default) or per-run injection (cloud) | operator |
| Stage state, policy, audit trail | Convex (control plane) | control plane |
| Job queue, run history | Machinist SQLite (loopback) | Machinist |
| The running product | Vercel + Convex Cloud (default) or EU providers | product |

## Trust boundaries

1. **Operator ↔ control plane.** Clerk-authenticated humans and API-key plugins. Only decisions, specs, and settings cross here; never shell, never credentials.
2. **Control plane ↔ Machinist.** A bridge process on the worker machine polls Convex and submits jobs to the loopback API with the bearer token. Convex never reaches into the worker.
3. **Machinist ↔ run.** One process, one repository directory, one lease. The run holds whatever credentials the runtime gives it.
4. **Run ↔ the world.** GitHub, npm, model endpoints, providers. Egress allowlist on cloud sandboxes; host firewall on the local runtime.
5. **Untrusted content ↔ agent.** Issue text, PR bodies, review comments, check output, repository files, and scanner output are task data, never instructions.

## Threats and controls

| ID | Threat (STRIDE) | Vector | Controls | Residual risk |
|---|---|---|---|---|
| T1 | Tampering / elevation: prompt injection makes an agent exfiltrate secrets or weaken security | crafted issue, PR, review comment, dependency README | foreman/shepherd untrusted-data rules; factory prompts repeat them; egress allowlist (cloud); per-run scoped tokens (cloud); forced-gray on sensitive paths; independent review subagent; Greptile gate; security CI | local runtime has host-level credentials and no egress proxy; an injection that produces a plausible, review-passing change can land in dark mode |
| T2 | Elevation: agent merges an unsafe change in dark mode | agent nondeterminism, weak tests | Greptile threshold; security CI as required checks; forced-gray paths and dependency policy; repair round cap; shepherd `max_actions`; shepherd never applies the permission label; control plane applies it only when every gate passed | gates measure what they measure; a logic flaw in allowed paths with passing checks can merge |
| T3 | Spoofing: forged webhook or job submission | network access to Convex or the loopback API | HMAC verification with constant-time compare; Machinist bearer token; loopback bind; Cloudflare Access when hosted | shared worker token (design R4) |
| T4 | Information disclosure: secrets in logs, events, PRs | scripts echo env; agents paste keys | SVCOS scripts never print secret values; `resolve-secret.sh` prints only to stdout for the caller; detect-secrets pre-commit and CI; AGENTS.md rule; Doppler as sole broker | run events are stored in Machinist SQLite and Convex; an accidental print persists until rotated |
| T5 | Elevation: compromised sandbox pivots to another project | shared filesystem or credentials across runs | ephemeral sandbox per run; per-project volumes only for caches; per-run installation tokens; no credentials in the image | local runtime shares one account across projects (design R17) |
| T6 | Tampering: supply-chain compromise via npm | malicious release with valid provenance | `npm audit`, `npm ls --all`, install cooldown in SVCOS `.npmrc`, dependency changes forced gray, pinned Actions by SHA, pinned CLIs in the image | day-zero maintainer compromise (SVCOS `security-check.sh` documents this limit) |
| T7 | Denial of service / cost: runaway repair loops or shepherd actions | flaky review, oscillating fixes | round cap; `max_actions`; timeouts per command; single automatic retry then NEEDS_HUMAN; spend alerts | model spend before the cap triggers |
| T8 | Repudiation: who approved what | human or automation ambiguity | every label application, decision, and gate update is an `events` row with actor; shepherd audit comments; decisions carry operator notes | actor identity for local scripts is the worker account |
| T9 | Tampering: branch protection bypass | admin token, direct push | `enforce_admins: true`; required checks; no force-push; foreman pushes only reviewer-approved SHA by refspec; agents never hold admin-scoped tokens | the operator's own admin token can bypass; dark-mode repos in `solo` lockdown have no required human review by design |
| T10 | Information disclosure: repository content leaves jurisdiction | model endpoints, reviewer, cloud sandbox region | provider profiles; EU LLM endpoints; local execution by default; Greptile terms check before EU enablement | Clerk identity remains US until the OIDC module exists (design R14) |

## Assumptions

- The operator's machine or VM running the local worker is trustworthy: disk encrypted, unprivileged `machinist` account, no shared use.
- GitHub, Convex, Clerk, Vercel, Doppler, and the model providers are not compromised.
- Machinist's execution invariants hold (one job = one run, terminal state only from exit code, lease expiry requeues).
- SVCOS's security CI and assessment agents are maintained upstream; the factory pins the template ref it builds from.

## What the factory does not do

See `SECURITY.md`: it does not fix an unsafe spec, cannot see provider-side compromise, and cannot guarantee that every prompt injection is caught. Dark mode is a policy the operator enables per repository after the checklist, not a default.
