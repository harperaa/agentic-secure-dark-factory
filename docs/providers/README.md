# Provider adapters and profiles

SVCOS ships against Vercel, Clerk, Doppler, Convex Cloud, and Clerk Billing. Those are the
**default** profile. The factory never calls a provider directly; every stage goes through an
adapter, and each adapter produces exactly the artifacts SVCOS's scripts expect (design §4.11).

## Adapter kinds

| Kind | Interface | Default | EU | Touches SVCOS code? |
|---|---|---|---|---|
| hosting | `link`, `setEnv`, `deploy → url`, `promote` | Vercel | Scaleway, Hetzner + Coolify | no |
| secrets | `createProject`, `createConfig`, `set`, `serviceToken`, `exportEnv` | Doppler | Infisical | no (SVCOS runs in `env` mode) |
| backend | `createProject`, `deployKey`, `deployFunctions`, `setEnv`, `url` | Convex Cloud | Convex self-hosted | no |
| identity | `createApp → keys, issuer`, `webhook`, `oidcConfig` | Clerk | Keycloak, Zitadel | **yes** — needs the `auth-oidc` SVCOS module |
| payments | `createProducts`, `checkoutUrl`, `webhook`, `entitlement` | Clerk Billing + Stripe | Mollie, PayOne | **yes** — needs `payments-mollie` / `payments-payone` modules |
| sandbox | `create`, `exec`, `stream`, `destroy` | local | Daytona EU, Cloudflare EU, Scaleway | no |
| llm | endpoint + credential per executor | Anthropic, OpenAI | Bedrock eu-central-1, Vertex europe-west, Mistral | no |
| review | `waitForReview → {score, comments}` | Greptile | Greptile (terms verified) or a self-hosted reviewer job | no |
| scm | webhooks, tokens, PRs, labels | GitHub | GitHub | no |

## Rules

- Adapters are pure functions over a provider's CLI or API, kept in `control-plane/factory/providers/<kind>/<name>.ts` (M2).
- A profile is chosen at genesis and stored in Convex; changing it later is a migration stage.
- `capabilities()` on each adapter lets the state machine refuse a profile with unmet gaps and stop as NEEDS_HUMAN with the reason. Until the identity and payments modules exist upstream, the `eu` profile is "EU data plane, Clerk identity" and is labelled as such in the hand-off (design R14).
- Contract tests assert the produced `.env.local` shape and `docs/DEPLOYMENT-*.md` for every adapter (design R16).

## Status

M1 implements the default profile inline in `factory/scripts/genesis.sh`. M2 extracts the adapters from it. M7 adds the EU phase-1 adapters (hosting, secrets, backend, LLM).
