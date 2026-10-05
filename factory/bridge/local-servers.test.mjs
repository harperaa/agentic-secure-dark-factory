import { test } from "node:test";
import assert from "node:assert/strict";
import { lastError, pickPort, productEnv } from "./local-servers.mjs";

test("productEnv keeps the product's secrets and drops the bridge's", () => {
  const base = { PATH: "/bin", HOME: "/h", FACTORY_BRIDGE_SECRET: "b", DOPPLER_TOKEN: "d", ANTHROPIC_API_KEY: "a" };
  const secrets = { NEXT_PUBLIC_CONVEX_URL: "u", CLERK_SECRET_KEY: "c", DOPPLER_PROJECT: "p", FACTORY_CLERK_CLAIM_URL: "claim", VERCEL_OIDC_TOKEN: "v" };
  assert.deepEqual(productEnv(base, secrets), {
    NEXT_TELEMETRY_DISABLED: "1",
    PATH: "/bin",
    HOME: "/h",
    NEXT_PUBLIC_CONVEX_URL: "u",
    CLERK_SECRET_KEY: "c",
  });
});

test("pickPort skips claimed and busy ports", async () => {
  const busy = new Set([3101]);
  const port = await pickPort(new Set([3100]), async (p) => !busy.has(p));
  assert.equal(port, 3102);
});

test("lastError finds the last error-looking line", () => {
  assert.equal(lastError("ready\nError: listen EADDRINUSE :3100\nok"), "Error: listen EADDRINUSE :3100");
  assert.equal(lastError("all good"), undefined);
});
