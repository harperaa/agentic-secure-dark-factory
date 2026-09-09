# Provider adapters and profiles

SVCOS ships against Vercel, Clerk, Doppler, Convex Cloud, and Clerk Billing. Those are the
**default** profile. The factory never calls a provider directly; every stage goes through an
adapter, and each adapter produces exactly the artifacts SVCOS's scripts expect (design §4.11).

## Where adapters live

Two copies of the same table, kept in step by a contract test:

| Layer | Path | Used by |
|---|---|---|
| bash modules | `factory/providers/<kind>/<name>.sh` | `genesis.sh`, `deploy-dev.sh`, and any other Machinist script executor |
| TypeScript registry | `control-plane/factory/providers/registry.ts` | the control plane's profile gate and the Spec screen's inline capability display |

`factory/tests/providers.test.sh` fails if a bash module has no registry row.

## Kinds, verbs, and dispatch

`factory/providers/load.sh` resolves the spec's `providers` block against the profile
defaults, sources one module per kind, and defines generic dispatchers named `<kind>_<verb>`
(`secrets_has`, `hosting_deploy`, `scm_protect`, ...). A module defines
`<kind>_<name_with_underscores>_<verb>` functions plus `<kind>_<name>_capabilities`. Scripts
only ever call the dispatchers, so they never name a provider. `<kind>_supports_<verb>` tells a
script whether the selected adapter implements an optional verb (for example Infisical has no
`ci_token`, so genesis logs that step as skipped with a reason).

| Kind | Verbs | Default | EU | Touches SVCOS code? |
|---|---|---|---|---|
| hosting | `link`, `is_linked`, `write_config`, `config_current`, `set_env`, `deploy`, `promote`, `step_name` | vercel | scaleway (`scw` + Docker) | no |
| secrets | `bootstrap`, `bootstrapped`, `has`, `get`, `set`, `sync_local`, `synced`, `ci_token`, `has_ci_token`, `export_env`, `mode`, `step_name` | doppler | infisical (SVCOS `env` mode) | no |
| backend | `create_project`, `has_project`, `url`, `deploy_functions` | convex-cloud | convex-selfhosted | no |
| identity | `create_app`, `has_app`, `configure` | clerk | keycloak, zitadel: **refused** (needs SVCOS `auth-oidc`) | yes, hence refused |
| payments | none during genesis | clerk-billing, none | mollie, payone: **refused** (needs SVCOS modules) | yes, hence refused |
| scm | `create_repo`, `has_repo`, `set_default`, `repo_url`, `has_secret`, `protect` | github | github | no |
| llm | `env` (executor environment lines) | anthropic, openai | anthropic-bedrock-eu, anthropic-vertex-eu, mistral | no |
| review | declared only | greptile | greptile, self-hosted (**refused** until the prompt exists) | no |
| sandbox | executed by `sandbox-exec`, gated by the registry | local | daytona, scaleway; cloudflare refused | no |

## Capabilities and the gate

Every module's `capabilities` prints one JSON object:

```json
{"kind":"hosting","name":"vercel","implemented":true,"verified":true,
 "needs_env":["VERCEL_SCOPE"],"needs_cmd":["npx"],"supports":["link","is_linked","write_config","set_env","deploy","promote"]}
```

The secrets kind additionally reports `secrets_mode` (`doppler` or `env`), which genesis checks
against the spec.

- `implemented: false` carries a `reason`; `providers_gate` refuses the profile with
  `NEEDS_HUMAN reason=provider-unsupported kind=... name=... detail="..."` before genesis touches anything.
- `verified: false` means the adapter has never been run against the real provider. Every EU
  adapter is unverified today; the registry lists them so the UI can say so.
- `needs_env` and `needs_cmd` are checked next, after every implementation gap, so the operator
  hears about a refused adapter before a missing variable.
- `human_gate` names what a person must provision (Stripe, an Infisical project, the Greptile App).

## Profiles

| Profile | hosting | identity | secrets | backend | payments | llm | Notes |
|---|---|---|---|---|---|---|---|
| `default` | vercel | clerk | doppler | convex-cloud | clerk-billing | anthropic | verified end to end on 2026-09-07 |
| `eu` | scaleway | clerk | infisical | convex-selfhosted | clerk-billing | anthropic-bedrock-eu | "EU data plane, Clerk identity" (design R14); every EU adapter unverified |

The spec's `secrets_mode` must match the selected secrets adapter's mode (`doppler` or `env`);
genesis refuses a mismatch.

## Rules

- Adapters are pure functions over a provider's CLI or API and produce the artifacts SVCOS
  expects (`.env.local` shape in env mode, `.doppler.yaml` in Doppler mode, `vercel.json` per
  mode, `docs/DEPLOYMENT-*.md`), so SVCOS scripts downstream keep working unchanged. The
  SVCOS invocations inside the default adapters are byte-for-byte what genesis ran before the
  split (design G7).
- A profile is chosen at genesis and stored in the control plane; changing it later is a
  migration stage.
- Probes never fail open. A Doppler error other than "secret not found" is fatal; treating it as
  "not configured" would re-run init or convex-setup and duplicate resources.
- Every gh call in a product checkout names the repository (`gh repo set-default` plus
  `GH_REPO`), because products carry both `origin` and `upstream`.

## Contract tests

`factory/tests/run.sh` runs three suites against fake CLIs under `factory/tests/fakes` (no
network, no real providers):

- `providers.test.sh`: loader, gate, each adapter's artifacts, registry parity.
- `genesis.test.sh`: the golden step sequence and `RESULT` line for a fresh run and an
  idempotent re-run, failure handling, and the gate refusing before a clone.
- `deploy-dev.test.sh`: tool checks, missing settings, and the deployment summary.

## Adding an adapter

1. Create `factory/providers/<kind>/<name>.sh` defining `<kind>_<name>_capabilities` and the
   verbs the kind needs (see the table). Use `run_svcos STEP cmd...` for any SVCOS script call.
2. Add the matching row to `control-plane/factory/providers/registry.ts` with `verified: false`
   until it has run against the provider.
3. Document its env in `factory/config/factory.env.example`.
4. Add a fake CLI under `factory/tests/fakes` if it needs one, and assertions in
   `factory/tests/providers.test.sh` for the artifacts it produces.
5. Set `verified: true` only after a real run, and say in the PR what was exercised.

## Onboarding

`factory/scripts/doctor.sh` discovers the values a cloner cannot guess (GitHub owner, Vercel
scope, Convex team slug, Doppler workplace), reports missing CLIs and logins, and with
`--write <path>` produces a filled-in `factory.env` (blank where a value has several candidates).
