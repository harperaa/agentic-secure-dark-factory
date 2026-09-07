# Security policy

## Reporting a vulnerability

Use GitHub's private vulnerability reporting on this repository
("Security" tab, "Report a vulnerability"). Do not open a public issue for
anything that could be exploited before it is fixed.

You will get an acknowledgement within three working days and a fix or
mitigation plan within fourteen days for anything rated high or critical.

## Supported versions

Before 1.0 only the `main` branch is supported. Tagged releases of
`sandbox-exec` and the `svcos-factory` image ship with SHA-256 checksums;
verify them before use.

## What the factory protects

- Merges to a product's `main` require security CI, an independent AI review
  at or above the project's score threshold, and in gray mode a human.
- Changes to authentication, payments, headers, middleware, or dependencies are
  always staged for a human regardless of mode.
- Agents run as an unprivileged user inside git worktrees. Only the foreman
  pushes a reviewer-approved commit; only the shepherd merges; the control plane
  never pushes code.
- Cloud sandboxes are destroyed after every run and hold only per-run,
  scoped credentials. Egress is restricted to an allowlist and denied attempts
  are logged to the run record.
- Every run is recorded with its prompt, command hash, events, token usage, gate
  results, and resulting commit.

## What dark mode does not protect against

Be honest about the boundary before enabling `machinist:auto-merge` automation.

- **Design flaws in the spec.** If the specification asks for something unsafe,
  the factory will build it well.
- **Provider-side compromise.** A compromised GitHub, Vercel, Convex, Clerk,
  Doppler, or model provider account is outside the factory's control.
- **Prompt injection that survives review.** The reviewer, security CI, and
  forced-gray paths reduce the blast radius; they do not make it zero.
- **Novel supply-chain attacks.** `npm audit`, lockfile checks, and the
  dependency-change policy catch known and anomalous cases, not day-zero
  maintainer compromise.
- **The local runtime's host.** In the default local runtime credentials live
  on one machine. Disk encryption, an unprivileged account, and rotation reduce
  the exposure; they do not remove it. Use a cloud sandbox backend when you need
  ephemeral credentials.

The threat model in `docs/security/threat-model.md` records assumptions and
residual risk in more detail, and `docs/security/dark-mode-checklist.md` lists
the preconditions for enabling dark mode on a repository.
