import { test } from "node:test";
import assert from "node:assert/strict";
import { ADAPTERS, PROFILE_DEFAULTS, PROVIDER_KINDS, findAdapter, resolveProfile, secretsModeFor } from "./registry.ts";

const fullEnv = {
  VERCEL_SCOPE: "team",
  LOCKDOWN_MODE_DARK: "solo",
  LOCKDOWN_MODE_GRAY: "team",
  FACTORY_REQUIRED_CONTEXTS: "semgrep",
  GREPTILE_BOT_LOGIN: "greptile-apps[bot]",
};

test("every profile default names an implemented adapter", () => {
  for (const [profile, defaults] of Object.entries(PROFILE_DEFAULTS)) {
    for (const kind of PROVIDER_KINDS) {
      const a = findAdapter(kind, defaults[kind]);
      assert.ok(a, `${profile}.${kind}=${defaults[kind]} missing`);
      assert.equal(a.implemented, true, `${profile}.${kind}=${defaults[kind]} not implemented`);
    }
  }
});

test("default profile resolves with a complete environment and Doppler mode", () => {
  const r = resolveProfile({ profile: "default", sandbox: "local" }, fullEnv);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(secretsModeFor(r), "doppler");
    assert.deepEqual(r.unverified, ["review/greptile"]);
    assert.equal(r.adapters.hosting.name, "vercel");
  }
});

test("missing required env is named", () => {
  const r = resolveProfile({ profile: "default", sandbox: "local" }, { ...fullEnv, VERCEL_SCOPE: "" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /provider-env-missing kind=hosting name=vercel env=VERCEL_SCOPE/);
});

test("EU identity and payments swaps are refused with the R14 reason", () => {
  for (const [kind, name] of [["identity", "keycloak"], ["identity", "zitadel"], ["payments", "mollie"], ["payments", "payone"]]) {
    const r = resolveProfile({ profile: "eu", sandbox: "local", [kind]: name });
    assert.equal(r.ok, false, `${kind}=${name} should be refused`);
    if (!r.ok) {
      assert.equal(r.kind, kind);
      assert.match(r.reason, /R14/);
    }
  }
});

test("EU phase-1 profile resolves as EU data plane with Clerk identity, all unverified", () => {
  const r = resolveProfile({ profile: "eu", sandbox: "local" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.adapters.identity.name, "clerk");
    assert.equal(r.adapters.secrets.name, "infisical");
    assert.equal(secretsModeFor(r), "env");
    assert.ok(r.unverified.includes("hosting/scaleway"));
    assert.ok(r.unverified.includes("backend/convex-selfhosted"));
    assert.ok(r.humanGates.some((g) => g.startsWith("secrets/infisical")));
  }
});

test("unknown adapter names and profiles are refused", () => {
  const a = resolveProfile({ profile: "default", sandbox: "local", hosting: "netlify" });
  assert.equal(a.ok, false);
  const b = resolveProfile({ profile: "asia", sandbox: "local" });
  assert.equal(b.ok, false);
});

test("every adapter row is well formed", () => {
  const seen = new Set();
  for (const a of ADAPTERS) {
    const key = `${a.kind}/${a.name}`;
    assert.ok(!seen.has(key), `duplicate ${key}`);
    seen.add(key);
    assert.ok(PROVIDER_KINDS.includes(a.kind));
    if (!a.implemented) assert.ok(a.reason, `${key} refused without a reason`);
    if (a.verified) assert.equal(a.implemented, true, `${key} verified but not implemented`);
  }
});
