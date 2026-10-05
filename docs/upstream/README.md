# Upstream proposals

The factory does not fork or patch Secure Vibe Coding OS or Machinist (design G7, §12.5).
Anything that only makes sense inside them is written up here and offered upstream. Until a
proposal lands, the factory works around it or degrades to NEEDS_HUMAN with a reason.

| Proposal | Target | Factory workaround today |
|---|---|---|
| [Argument blocks on interactive commands](svcos-arguments.md) ([SVCOS #5](https://github.com/harperaa/secure-vibe-coding-OS/issues/5)) | SVCOS | factory prompts call scripts and agents directly |
| [Optional modules: `auth-oidc`, `payments-mollie`, `payments-payone`](svcos-modules.md) ([SVCOS #10](https://github.com/harperaa/secure-vibe-coding-OS/issues/10)) | SVCOS | EU profile refuses identity/payments swaps |
| [Security CI additions in `ci.yml`](svcos-security-ci.md) ([SVCOS #8](https://github.com/harperaa/secure-vibe-coding-OS/issues/8); also #6, #7, #9) | SVCOS | `factory-security.yml` written into each product repo |
| [`Runtime` seam in the managed worker](machinist-runtime-seam.md) ([owainlewis/machinist#480](https://github.com/owainlewis/machinist/issues/480)) | Machinist | `sandbox-exec` wrapper executor |

## Upstream drift

Checked 2026-10-05 against `owainlewis/machinist` `main` (`3943516`), 53 commits past the pinned
v0.4.0 with no newer release. Re-check before every `MACHINIST_VERSION` bump.

| Upstream change | Effect on the factory |
|---|---|
| `foreman.md` and `shepherd.md` removed from `examples/prompts` (#488) | fetched at `MACHINIST_PROMPTS_REF`, pinned apart from the binary |
| `[shepherd]` schedules removed (#448) | none: the factory never configured them |
| Task workflows, review gates, artifacts (#492) | none: additive; command jobs (`POST /api/v1/jobs` with `command`) unchanged |
| `final_message` in `result.json` (#497) | not read yet: after the bump, bridge work to show it as the run summary instead of scraping output |
| Worker survives a stale-completion 409 (#454, issue #443); completion retries (#444) | wanted: a lease lost on a long foreman run stops the v0.4.0 worker |
| `Runtime` seam (#480) | still open, no upstream response |
