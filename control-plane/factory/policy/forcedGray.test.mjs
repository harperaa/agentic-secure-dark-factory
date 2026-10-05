import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyForcedGray, mayAutoMerge } from "./forcedGray.ts";

const forcedGrayPaths = ["middleware.ts", "convex/auth*", "app/api/**", "lib/security/**", "package.json"];

test("sensitive path forces gray", () => {
  const r = classifyForcedGray({ changedPaths: ["app/api/webhooks/route.ts"], forcedGrayPaths });
  assert.equal(r.forced, true);
  assert.match(r.reasons[0], /app\/api\/\*\*/);
});

test("dependency change forces gray even when not in the list", () => {
  const r = classifyForcedGray({ changedPaths: ["package-lock.json"], forcedGrayPaths: [] });
  assert.equal(r.forced, true);
});

test("a dependency change that cleared the cooldown no longer forces gray, by name or by path", () => {
  const r = classifyForcedGray({ changedPaths: ["package.json", "package-lock.json", "app/page.tsx"], forcedGrayPaths, dependencyCooldown: { ok: true, checked: 60, violations: [] } });
  assert.deepEqual(r, { forced: false, reasons: [] });
});

test("a failed cooldown keeps dependency changes forced and says which package", () => {
  const r = classifyForcedGray({ changedPaths: ["package-lock.json"], forcedGrayPaths, dependencyCooldown: { ok: false, checked: 3, violations: ["fresh@1.0.0: published 2 day(s) ago; the cooldown is 7"] } });
  assert.equal(r.forced, true);
  assert.ok(r.reasons.some((x) => x.includes("fresh@1.0.0")));
});

test("the cooldown does not clear other sensitive paths", () => {
  const r = classifyForcedGray({ changedPaths: ["package.json", "package-lock.json", "middleware.ts"], forcedGrayPaths, dependencyCooldown: { ok: true, checked: 1, violations: [] } });
  assert.deepEqual(r.reasons, ["path middleware.ts matches middleware.ts"]);
});

test("a package.json edited without its lockfile stays forced, whatever the cooldown says", () => {
  const r = classifyForcedGray({ changedPaths: ["package.json"], forcedGrayPaths, dependencyCooldown: { ok: true, checked: 0, violations: [] } });
  assert.equal(r.forced, true);
  assert.ok(r.reasons.includes("dependency change in package.json"));
});

test("a cooldown that checked nothing clears nothing", () => {
  const r = classifyForcedGray({ changedPaths: ["package.json", "package-lock.json"], forcedGrayPaths, dependencyCooldown: { ok: true, checked: 0, violations: [] } });
  assert.equal(r.forced, true);
});

test("ordinary page change does not force gray", () => {
  const r = classifyForcedGray({ changedPaths: ["app/dashboard/page.tsx"], forcedGrayPaths });
  assert.deepEqual(r, { forced: false, reasons: [] });
});

test("labels and triage risk force gray", () => {
  assert.equal(classifyForcedGray({ changedPaths: [], forcedGrayPaths, labels: ["factory:forced-gray"] }).forced, true);
  assert.equal(classifyForcedGray({ changedPaths: [], forcedGrayPaths, triageRisk: "high" }).forced, true);
});

test("auto-merge only in dark mode with passing gates and nothing forced", () => {
  const clear = { forced: false, reasons: [] };
  assert.equal(mayAutoMerge({ mode: "dark", forcedGray: clear, gateVerdict: "pass" }), true);
  assert.equal(mayAutoMerge({ mode: "gray", forcedGray: clear, gateVerdict: "pass" }), false);
  assert.equal(mayAutoMerge({ mode: "dark", forcedGray: { forced: true, reasons: ["x"] }, gateVerdict: "pass" }), false);
  assert.equal(mayAutoMerge({ mode: "dark", forcedGray: clear, gateVerdict: "pending" }), false);
});
