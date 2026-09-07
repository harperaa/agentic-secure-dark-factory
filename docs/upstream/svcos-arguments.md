# Proposal: `## Arguments` blocks on SVCOS slash commands

**Problem.** `AskUserQuestion` inside `/install`, `/deploy-to-dev`, `/deploy-to-prod`,
`/security-assessment`, and `/create-new-site` has no one to answer it under `claude --print`;
a headless run hangs until it is killed.

**Proposal.** Each command gains an `## Arguments` block that parses `$ARGUMENTS` and, when
`SVCOS_HEADLESS=1` or `--headless` is present, treats any unanswered question as an error
(`MISSING_ARG <name>`), otherwise asks only for values not supplied. Explicit argument wins;
defaults only for non-security choices.

| Command | Arguments |
|---|---|
| `/install` | `--site-name`, `--admin-email`, `--secrets=doppler\|env`, `--modules=<csv\|none\|all>`, `--clerk-pk`, `--clerk-sk` |
| `/deploy-to-dev` | `--owner`, `--repo`, `--vercel-scope`, `--redeploy=yes\|no` |
| `/deploy-to-prod` | `--domain`, `--clerk-pk-live`, `--clerk-sk-live` or `--from-doppler=prd`, `--stripe=now\|skip`, `--google-oauth=skip\|<client-id>`, `--confirm-prereqs=yes` |
| `/security-assessment` | `--mode=fresh\|reassessment\|auto`, `--deepsec=on\|off\|auto`, `--install-pnpm=yes\|no`, `--baseline=<path>` |
| `/create-new-site` | `--spec=<factory-spec.json>`, `--phase=<n>`, `--auto-accept=yes` |
| `/add-module` | `<module ...> --apply-edits --no-confirm` |

**Why upstream benefits.** Humans get argument-first commands too; CI can drive the same
commands; the scripts underneath already take these flags, so the change is confined to the
markdown.

**Factory today.** `factory/commands/*.md` own the same contracts and invoke the scripts and
agents directly (design §4.10). Nothing in the factory depends on this landing.
