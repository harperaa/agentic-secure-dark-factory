/**
 * Read-only capability notes per adapter kind, by provider profile (design §4.11, R14).
 * Mirrors what the factory's adapters declare; the control plane refuses a profile whose gaps
 * are not satisfied and stops as NEEDS_HUMAN with the reason.
 */
export type ProviderKind = "hosting" | "identity" | "secrets" | "backend" | "payments" | "sandbox" | "llm" | "review" | "scm";

export const PROVIDER_KINDS: ProviderKind[] = ["hosting", "identity", "secrets", "backend", "payments", "sandbox", "llm", "review", "scm"];

export const PROFILE_DEFAULTS: Record<"default" | "eu", Record<ProviderKind, string>> = {
  default: {
    hosting: "vercel",
    identity: "clerk",
    secrets: "doppler",
    backend: "convex-cloud",
    payments: "clerk-billing",
    sandbox: "local",
    llm: "anthropic",
    review: "greptile",
    scm: "github",
  },
  eu: {
    hosting: "scaleway",
    identity: "clerk",
    secrets: "infisical",
    backend: "convex-selfhosted",
    payments: "clerk-billing",
    sandbox: "local",
    llm: "anthropic-bedrock-eu",
    review: "greptile",
    scm: "github",
  },
};

export function capabilityNote(kind: ProviderKind, name: string): string {
  switch (kind) {
    case "identity":
      return name === "clerk" ? "Supported. Accountless dev app at genesis; production instance is a human step." : "Not available until the SVCOS auth-oidc module exists. The line stops with the reason.";
    case "payments":
      return name === "clerk-billing" || name === "none" ? "Supported." : "Not available until the SVCOS payments module for this provider exists.";
    case "sandbox":
      return name === "local" ? "Runs on the worker machine." : name === "cloudflare" ? "Needs the Worker-based runtime." : "Ephemeral sandbox per run; needs the provider's API credentials on the worker.";
    case "secrets":
      return name === "doppler" ? "Supported (Doppler mode)." : "Supported in env mode; not yet verified against the provider.";
    case "backend":
      return name === "convex-cloud" ? "Supported." : "Self-hosted Convex over CONVEX_SELF_HOSTED_URL; not yet verified.";
    case "hosting":
      return name === "vercel" ? "Supported." : "Adapter present; not yet verified against the provider.";
    case "llm":
      return name === "anthropic" || name === "openai" ? "Supported." : "Endpoint preset; verify data residency terms.";
    case "review":
      return name === "greptile" ? "Reviews on every push; install the GitHub App on the repository." : "Self-hosted reviewer runs as a factory job.";
    case "scm":
      return "Supported.";
    default:
      return "";
  }
}
