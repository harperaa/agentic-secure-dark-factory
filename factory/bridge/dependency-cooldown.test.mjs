import { test } from "node:test";
import assert from "node:assert/strict";
import { addedVersions, cooldownVerdict } from "./dependency-cooldown.mjs";

const reg = (name, version) => ({ version, resolved: `https://registry.npmjs.org/${name}/-/${name.split("/").pop()}-${version}.tgz` });
const lock = (pkgs) => ({ lockfileVersion: 3, packages: { "": { name: "app" }, ...Object.fromEntries(pkgs.map(([key, entry]) => [key, entry])) } });
const NOW = Date.parse("2026-10-05T00:00:00Z");
const daysAgo = (n) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

test("only versions new to the lockfile are checked; unchanged ones are not", () => {
  const base = lock([["node_modules/react", reg("react", "19.0.0")]]);
  const head = lock([["node_modules/react", reg("react", "19.0.0")], ["node_modules/vitest", reg("vitest", "4.1.11")]]);
  assert.deepEqual(addedVersions(base, head).added, [{ name: "vitest", version: "4.1.11", requiredDays: 7 }]);
});

test("a major bump of an existing package needs 14 days, a minor 7", () => {
  const base = lock([["node_modules/a", reg("a", "1.2.0")], ["node_modules/b", reg("b", "1.2.0")]]);
  const head = lock([["node_modules/a", reg("a", "2.0.0")], ["node_modules/b", reg("b", "1.3.0")]]);
  const days = Object.fromEntries(addedVersions(base, head).added.map((a) => [a.name, a.requiredDays]));
  assert.deepEqual(days, { a: 14, b: 7 });
});

test("scoped and nested packages are named correctly", () => {
  const head = lock([["node_modules/@edge-runtime/vm", reg("@edge-runtime/vm", "5.0.0")], ["node_modules/x/node_modules/@scope/y", reg("@scope/y", "1.0.0")]]);
  assert.deepEqual(addedVersions(lock([]), head).added.map((a) => a.name).sort(), ["@edge-runtime/vm", "@scope/y"]);
});

test("old-enough versions pass", async () => {
  const head = lock([["node_modules/vitest", reg("vitest", "4.1.11")]]);
  const v = await cooldownVerdict(lock([]), head, async () => daysAgo(30), NOW);
  assert.deepEqual(v, { ok: true, checked: 1, violations: [] });
});

test("a version inside the window fails with its age", async () => {
  const head = lock([["node_modules/fresh", reg("fresh", "1.0.0")]]);
  const v = await cooldownVerdict(lock([]), head, async () => daysAgo(2), NOW);
  assert.equal(v.ok, false);
  assert.match(v.violations[0], /fresh@1\.0\.0: published 2 day\(s\) ago; the cooldown is 7/);
});

test("a major bump at 10 days fails the 14-day window", async () => {
  const v = await cooldownVerdict(lock([["node_modules/a", reg("a", "1.0.0")]]), lock([["node_modules/a", reg("a", "2.0.0")]]), async () => daysAgo(10), NOW);
  assert.equal(v.ok, false);
});

test("an undated or non-registry version cannot pass", async () => {
  const head = lock([["node_modules/gone", reg("gone", "1.0.0")], ["node_modules/gitdep", { version: "1.0.0", resolved: "git+ssh://git@github.com/x/y.git#abc" }]]);
  const v = await cooldownVerdict(lock([]), head, async () => undefined, NOW);
  assert.equal(v.ok, false);
  assert.equal(v.violations.length, 2);
});
