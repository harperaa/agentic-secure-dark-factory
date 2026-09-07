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
