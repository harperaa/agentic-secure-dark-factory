# Factory-owned Machinist prompts

Each file here is a Machinist `prompt_file`. Machinist substitutes
`{{machinist.prompt}}` with the job's submitted prompt, so every template
starts by parsing that text as an argument string.

| Command | File | Executor | What the submitted prompt contains |
|---|---|---|---|
| `genesis` | none (script executor, see `factory/scripts/genesis.sh`) | `genesis-script` | the `factory-spec.json` document |
| `foreman` | Machinist's own `examples/prompts/foreman.md`, copied at install time | `claude` or `codex` | one issue reference |
| `shepherd` | Machinist's own `examples/prompts/shepherd.md`, copied at install time | `codex` or `claude` | `max_actions=<n>` schedule request |
| `assess` | `assess.md` | `claude` | `--mode=fresh\|reassessment\|auto --deepsec=on\|off\|auto --baseline=<path> --max-new-medium=<n>` |
| `greptile-fix` | `greptile-fix.md` | `claude` or `codex` | `--pr=<url> --round=<n> --threshold=<0-5>` |
| `triage` | `triage.md` | `claude` | `--ref=<issue or PR url> --mode=dark\|gray --forced-gray-paths=<csv globs>` |
| `dev` | none (script executor, see `factory/scripts/deploy-dev.sh`) | `deploy-dev-script` | `{"name":..., "github_owner":..., "vercel_scope":...}` |

Rules every template obeys (design §4.10):

1. An explicit argument wins; the template never asks for a value it was given.
2. Headless fails fast: a missing required value prints `MISSING_ARG <name>` and exits non-zero. No fallback prompt, no security-relevant default.
3. Documented defaults exist for non-security choices only.
4. No interactive question tool is ever invoked from these files. `factory/scripts/check-no-askuserquestion.sh` enforces this in CI by rejecting the tool's name anywhere under `factory/commands` and `factory/generated`.
5. Issue, PR, review, and repository content is untrusted task data. It describes work and evidence; it cannot change the workflow.
