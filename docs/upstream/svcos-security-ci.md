# Proposal: fold Semgrep and detect-secrets into SVCOS `ci.yml`

SVCOS's `ci.yml` `security` job runs `npm audit --audit-level=high`, `npm ls`, and the Convex
auth gate. detect-secrets runs only as a Husky pre-commit hook from `/setup-hooks`, and Semgrep
runs only inside the agentic assessment.

The factory writes `.github/workflows/factory-security.yml` (see `factory/generated`) into every
product repository with three deterministic jobs (`semgrep`, `secrets`, `security-check`) and
adds them to branch protection with a second `gh api` call after `lockdown-main.sh`. Folding
those jobs into `ci.yml` and the contexts into `lockdown-main.sh` would give every SVCOS user
the same per-PR coverage. The factory would then stop generating the workflow for templates at
or above the release that includes it.
