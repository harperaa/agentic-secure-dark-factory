/**
 * Provider registry (design §4.11). Mirrors the bash adapter modules under factory/providers so
 * the control plane can refuse a profile whose gaps are not satisfied before a run is queued,
 * and so the Web UI can show each adapter's status inline (design §4.12 Spec screen).
 *
 * Keep this table and factory/providers/<kind>/<name>.sh in step; the contract test in
 * factory/tests/providers.test.sh asserts that every bash module has a row here.
 */

export const PROVIDER_KINDS = [
  "hosting",
  "identity",
  "secrets",
  "backend",
  "payments",
  "sandbox",
  "llm",
  "review",
  "scm",
] as const;

export type ProviderKind = (typeof PROVIDER_KINDS)[number];
export type Profile = "default" | "eu";
export type SecretsMode = "doppler" | "env"; // pragma: allowlist secret
export type Residency = "US" | "EU" | "operator";

export type Adapter = {
  kind: ProviderKind;
  name: string;
  /** false = declared but refused; the reason names the upstream dependency. */
  implemented: boolean;
  /** true only when the adapter has been run against the real provider. */
  verified: boolean;
  needsEnv: readonly string[];
  optionalEnv?: readonly string[];
  needsCmd: readonly string[];
  supports: readonly string[];
  secretsMode?: SecretsMode;
  residency?: Residency;
  reason?: string;
  humanGate?: string;
};

const adapter = (a: Adapter): Adapter => a;

export const ADAPTERS: readonly Adapter[] = [
  // hosting
  adapter({ kind: "hosting", name: "vercel", implemented: true, verified: true, needsEnv: ["VERCEL_SCOPE"], needsCmd: ["npx"], supports: ["link", "is_linked", "write_config", "set_env", "deploy", "promote"], residency: "US" }),
  adapter({ kind: "hosting", name: "scaleway", implemented: true, verified: false, needsEnv: ["SCW_REGION", "SCW_CONTAINER_NAMESPACE_ID", "SCW_REGISTRY_ENDPOINT"], optionalEnv: ["SCW_CONTAINER_CPU_LIMIT", "SCW_CONTAINER_MEMORY_LIMIT"], needsCmd: ["scw", "docker"], supports: ["link", "is_linked", "write_config", "set_env", "deploy"], residency: "EU" }),
  adapter({ kind: "hosting", name: "hetzner-coolify", implemented: false, verified: false, needsEnv: [], needsCmd: [], supports: [], reason: "no adapter module", residency: "EU" }),
  // identity
  adapter({ kind: "identity", name: "clerk", implemented: true, verified: true, needsEnv: [], needsCmd: [], supports: ["create_app", "has_app", "configure"], residency: "US" }),
  adapter({ kind: "identity", name: "keycloak", implemented: false, verified: false, needsEnv: [], needsCmd: [], supports: [], reason: "requires the SVCOS optional module auth-oidc (design R14); EU profile ships with Clerk identity until it lands", residency: "EU" }),
  adapter({ kind: "identity", name: "zitadel", implemented: false, verified: false, needsEnv: [], needsCmd: [], supports: [], reason: "requires the SVCOS optional module auth-oidc (design R14); EU profile ships with Clerk identity until it lands", residency: "EU" }),
  // secrets
  adapter({ kind: "secrets", name: "doppler", implemented: true, verified: true, needsEnv: [], needsCmd: ["doppler"], supports: ["bootstrap", "has", "get", "set", "sync_local", "ci_token", "export_env"], secretsMode: "doppler", residency: "US" }), // pragma: allowlist secret
  adapter({ kind: "secrets", name: "infisical", implemented: true, verified: false, needsEnv: ["INFISICAL_PROJECT_ID", "INFISICAL_API_URL"], optionalEnv: ["INFISICAL_TOKEN", "INFISICAL_ENV"], needsCmd: ["infisical"], supports: ["bootstrap", "has", "get", "set", "sync_local", "export_env"], secretsMode: "env", humanGate: "create the Infisical project and a machine identity for CI; set INFISICAL_PROJECT_ID", residency: "EU" }), // pragma: allowlist secret
  // backend
  adapter({ kind: "backend", name: "convex-cloud", implemented: true, verified: true, needsEnv: [], optionalEnv: ["CONVEX_TEAM"], needsCmd: ["npx"], supports: ["create_project", "has_project", "url", "deploy_functions"], residency: "US" }),
  adapter({ kind: "backend", name: "convex-selfhosted", implemented: true, verified: false, needsEnv: ["CONVEX_SELF_HOSTED_URL", "CONVEX_SELF_HOSTED_ADMIN_KEY"], needsCmd: ["npx"], supports: ["create_project", "has_project", "url", "deploy_functions"], humanGate: "provision the self-hosted Convex backend (Docker Compose on Scaleway/Hetzner) and its admin key", residency: "EU" }),
  // payments
  adapter({ kind: "payments", name: "clerk-billing", implemented: true, verified: true, needsEnv: [], needsCmd: [], supports: [], humanGate: "Stripe account and Clerk Billing are provisioned by a person (design §9)", residency: "US" }),
  adapter({ kind: "payments", name: "none", implemented: true, verified: true, needsEnv: [], needsCmd: [], supports: [] }),
  adapter({ kind: "payments", name: "mollie", implemented: false, verified: false, needsEnv: [], needsCmd: [], supports: [], reason: "requires the SVCOS optional module payments-mollie (design R14); EU profile ships with Clerk Billing until it lands", residency: "EU" }),
  adapter({ kind: "payments", name: "payone", implemented: false, verified: false, needsEnv: [], needsCmd: [], supports: [], reason: "requires the SVCOS optional module payments-payone (design R14); EU profile ships with Clerk Billing until it lands", residency: "EU" }),
  // sandbox (executed by sandbox-exec, design §5.2; the registry only gates the choice)
  adapter({ kind: "sandbox", name: "local", implemented: true, verified: true, needsEnv: [], needsCmd: [], supports: ["run"], residency: "operator" }),
  adapter({ kind: "sandbox", name: "daytona", implemented: true, verified: false, needsEnv: ["DAYTONA_API_KEY", "DAYTONA_API_URL"], needsCmd: [], supports: ["run"], residency: "EU" }),
  adapter({ kind: "sandbox", name: "scaleway", implemented: true, verified: false, needsEnv: [], needsCmd: ["docker"], supports: ["run"], residency: "EU" }),
  adapter({ kind: "sandbox", name: "cloudflare", implemented: false, verified: false, needsEnv: [], needsCmd: [], supports: [], reason: "requires the Worker-based runtime (design §5.4)" }),
  // llm
  adapter({ kind: "llm", name: "anthropic", implemented: true, verified: true, needsEnv: [], optionalEnv: ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"], needsCmd: ["claude"], supports: ["env"], residency: "US" }),
  adapter({ kind: "llm", name: "openai", implemented: true, verified: false, needsEnv: ["OPENAI_API_KEY"], needsCmd: ["codex"], supports: ["env"], residency: "US" }),
  adapter({ kind: "llm", name: "anthropic-bedrock-eu", implemented: true, verified: false, needsEnv: ["AWS_REGION"], optionalEnv: ["AWS_PROFILE", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "ANTHROPIC_BEDROCK_MODEL"], needsCmd: ["claude"], supports: ["env"], residency: "EU" }),
  adapter({ kind: "llm", name: "anthropic-vertex-eu", implemented: true, verified: false, needsEnv: ["ANTHROPIC_VERTEX_PROJECT_ID", "CLOUD_ML_REGION"], optionalEnv: ["GOOGLE_APPLICATION_CREDENTIALS"], needsCmd: ["claude"], supports: ["env"], residency: "EU" }),
  adapter({ kind: "llm", name: "mistral", implemented: true, verified: false, needsEnv: ["MISTRAL_API_KEY", "MISTRAL_BASE_URL"], needsCmd: ["codex"], supports: ["env"], residency: "EU" }),
  // review
  adapter({ kind: "review", name: "greptile", implemented: true, verified: false, needsEnv: ["GREPTILE_BOT_LOGIN"], needsCmd: ["gh"], supports: ["wait_for_review"], humanGate: "install the Greptile GitHub App on the product repository; verify data-processing terms for EU projects" }),
  adapter({ kind: "review", name: "none", implemented: true, verified: true, needsEnv: [], needsCmd: [], supports: [], humanGate: "CI-only review gate; the control plane never auto-merges without a reviewer" }),
  adapter({ kind: "review", name: "self-hosted", implemented: false, verified: false, needsEnv: [], needsCmd: [], supports: [], reason: "self-hosted reviewer prompt not implemented; use review=greptile or build factory/commands/review.md" }),
  // scm
  adapter({ kind: "scm", name: "github", implemented: true, verified: true, needsEnv: ["LOCKDOWN_MODE_DARK", "LOCKDOWN_MODE_GRAY", "FACTORY_REQUIRED_CONTEXTS"], needsCmd: ["gh", "git"], supports: ["create_repo", "has_repo", "set_default", "repo_url", "has_secret", "protect"] }),
];

/** Profile defaults; must match profile_default() in factory/providers/load.sh. */
export const PROFILE_DEFAULTS: Record<Profile, Record<ProviderKind, string>> = {
  default: {
    hosting: "vercel",
    identity: "clerk",
    secrets: "doppler", // pragma: allowlist secret
    backend: "convex-cloud",
    payments: "clerk-billing",
    sandbox: "local",
    llm: "anthropic",
    review: "greptile",
    scm: "github",
  },
  eu: {
    hosting: "scaleway",
    identity: "clerk", // design R14: EU data plane, Clerk identity until auth-oidc exists
    secrets: "infisical", // pragma: allowlist secret
    backend: "convex-selfhosted",
    payments: "clerk-billing", // design R14
    sandbox: "local",
    llm: "anthropic-bedrock-eu",
    review: "greptile",
    scm: "github",
  },
};

export type ProvidersBlock = { profile: Profile } & Partial<Record<Exclude<ProviderKind, never>, string>>;

export type ResolvedProfile =
  | { ok: true; profile: Profile; adapters: Record<ProviderKind, Adapter>; unverified: string[]; humanGates: string[] }
  | { ok: false; reason: string; kind?: ProviderKind; name?: string };

export function findAdapter(kind: ProviderKind, name: string): Adapter | undefined {
  return ADAPTERS.find((a) => a.kind === kind && a.name === name);
}

/**
 * Resolve a spec's providers block to concrete adapters, or a NEEDS_HUMAN reason (design §4.11
 * rules). `env` is the operator environment the run will execute with; when omitted only
 * implementation gaps are checked.
 */
export function resolveProfile(providers: ProvidersBlock, env?: Readonly<Record<string, string | undefined>>): ResolvedProfile {
  const defaults = PROFILE_DEFAULTS[providers.profile];
  if (!defaults) {
    return { ok: false, reason: `profile-unknown profile=${String(providers.profile)}` };
  }
  const adapters = {} as Record<ProviderKind, Adapter>;
  const unverified: string[] = [];
  const humanGates: string[] = [];
  for (const kind of PROVIDER_KINDS) {
    const name = providers[kind] ?? defaults[kind];
    const found = findAdapter(kind, name);
    if (!found) {
      return { ok: false, reason: `provider-unsupported kind=${kind} name=${name} detail="no adapter module"`, kind, name };
    }
    if (!found.implemented) {
      return { ok: false, reason: `provider-unsupported kind=${kind} name=${name} detail="${found.reason ?? "not implemented"}"`, kind, name };
    }
    if (env) {
      const missing = found.needsEnv.find((e) => !env[e]);
      if (missing) {
        return { ok: false, reason: `provider-env-missing kind=${kind} name=${name} env=${missing}`, kind, name };
      }
    }
    if (!found.verified) unverified.push(`${kind}/${name}`);
    if (found.humanGate) humanGates.push(`${kind}/${name}: ${found.humanGate}`);
    adapters[kind] = found;
  }
  return { ok: true, profile: providers.profile, adapters, unverified, humanGates };
}

/** The SVCOS secrets mode a resolved profile implies (design §4.11 secrets row). */
export function secretsModeFor(resolved: Extract<ResolvedProfile, { ok: true }>): SecretsMode {
  return resolved.adapters.secrets.secretsMode ?? "env";
}
