# Controls matrix

Control → where enforced → evidence artifact. Assessor-facing; every row should be verifiable from the repository or a run record without asking anyone.

| # | Control | Enforced by | Evidence |
|---|---|---|---|
| C1 | No merge without security CI | branch protection required contexts `lint, test, security, build` (SVCOS `lockdown-main.sh`) + `semgrep, secrets, security-check` (factory `protect-main.sh`) | `gh api repos/<r>/branches/main/protection`; workflow runs on the PR |
| C2 | No merge without independent AI review at threshold | control plane review gate (`gates.review.score ≥ threshold`, zero unresolved comments); foreman waits for automated reviewers | `gates` row; Greptile review on the PR head SHA |
| C3 | Human required in gray mode and on sensitive changes | `machinist:auto-merge` applied only by a human (gray) or by the control plane when `mayAutoMerge()` is true (dark); `factory:forced-gray` | `events` rows `label.apply` with actor; `decisions` row |
| C4 | Separation of duties | foreman never merges; shepherd merges only labelled PRs and never labels; control plane never pushes code | Machinist prompts (verbatim upstream); shepherd audit comments |
| C5 | Agents run unprivileged in isolated worktrees | Machinist VM guide account; image `USER machinist`; foreman worktree contract; `AGENTS.md` | `id` in run events; worktree path in foreman state comment |
| C6 | No long-lived credentials in cloud sandboxes | `sandbox-exec` per-run env injection; installation tokens; egress-proxy injection on Cloudflare | run record env key names (never values); sandbox lifecycle events |
| C7 | Egress restricted | Daytona/Cloudflare network policy; denied attempts logged | run record denied-egress count |
| C8 | Every run auditable | Machinist run record (prompt, command hash, events, tokens, exit) mirrored in `runs`; `events` append-only | `runs` and `events` rows; Machinist `result.json` |
| C9 | Secrets never in code or output | detect-secrets pre-commit (SVCOS `/setup-hooks`) and CI; SVCOS scripts print no secret values; `resolve-secret.sh` contract | `secrets` job run; `.secrets.baseline` |
| C10 | Dependencies controlled | `npm audit --audit-level=high`, `npm ls --all`, install cooldown, dependency change forced gray | `security` and `security-check` job runs; `factory:forced-gray` label |
| C11 | Periodic full assessment with baseline | `ASSESS` stage after initial build and on major releases; `accepted.json` baseline; issues for new critical/high | `gates.assessment`; `security_reports/assessment_*`; `factory:security-finding` issues |
| C12 | Interactive prompts cannot hang headless runs | argument contracts; `check-no-askuserquestion.sh` in CI | `guard` job run |
| C13 | Pinned supply chain for the factory itself | GitHub Actions by SHA; CLI versions in `snapshots/versions.env`; Machinist release verified by checksum | workflow files; image labels |
| C14 | The factory enforces on itself what it enforces on products | `.github/workflows/security.yml` mirrors `factory-security.yml`; branch protection on this repo | this repository's checks |
