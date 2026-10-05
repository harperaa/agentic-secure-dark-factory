import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// scripts/audit.mjs, run the way CI runs it, against a fake `npm audit --json` that reports one
// high advisory (braces, no patched release) and the allowlist each case supplies.
const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "..", "scripts", "audit.mjs");
const report = {
  vulnerabilities: {
    braces: { severity: "high", isDirect: false, fixAvailable: { name: "eslint-config-next", version: "14.2.35", isSemVerMajor: true }, via: [{ url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm", title: "braces" }] },
    micromatch: { severity: "high", isDirect: false, fixAvailable: false, via: ["braces"] },
  },
};

function run(allowlist, npmOutput = JSON.stringify(report)) {
  const dir = mkdtempSync(path.join(tmpdir(), "audit-"));
  mkdirSync(path.join(dir, "scripts"));
  mkdirSync(path.join(dir, "bin"));
  copyFileSync(script, path.join(dir, "scripts", "audit.mjs"));
  writeFileSync(path.join(dir, "audit-allowlist.json"), JSON.stringify(allowlist));
  writeFileSync(path.join(dir, "bin", "npm"), `#!/bin/sh\nprintf '%s' '${npmOutput.replace(/'/g, "'\\''")}'\nexit 1\n`);
  chmodSync(path.join(dir, "bin", "npm"), 0o755);
  const r = spawnSync("node", ["scripts/audit.mjs", "--today=2026-10-05"], { cwd: dir, encoding: "utf8", env: { ...process.env, PATH: `${path.join(dir, "bin")}:${process.env.PATH}` } });
  return { status: r.status, out: r.stdout + r.stderr };
}

const entry = { id: "GHSA-vfj7-8cjw-p6xm", package: "braces", reason: "lint-only, no patched release", added: "2026-10-05", reviewBy: "2026-11-05" };

test("a valid entry accepts the advisory and the dependents reached only through it", () => {
  const r = run([entry]);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /outcome=passed allowlisted=1/);
});

test("an advisory not on the list fails", () => {
  const r = run([]);
  assert.equal(r.status, 1);
  assert.match(r.out, /braces high: GHSA-vfj7-8cjw-p6xm/);
});

test("a reviewBy that is not a real calendar date is rejected, not deferred forever", () => {
  for (const bad of ["9999-99-99", "2026-02-30", "11/05/2026", undefined]) {
    const r = run([{ ...entry, reviewBy: bad }]);
    assert.equal(r.status, 1, String(bad));
    assert.match(r.out, /no valid reviewBy date/, String(bad));
  }
});

test("an overdue review date fails", () => {
  const r = run([{ ...entry, reviewBy: "2026-10-04" }]);
  assert.equal(r.status, 1);
  assert.match(r.out, /review was due 2026-10-04/);
});

test("an entry without a reason fails", () => {
  const r = run([{ ...entry, reason: "  " }]);
  assert.equal(r.status, 1);
  assert.match(r.out, /has no reason/);
});

test("a registry error is an audit that did not happen, not a clean report", () => {
  const r = run([entry], JSON.stringify({ error: { code: "ENOTFOUND", summary: "registry unreachable" } }));
  assert.equal(r.status, 1);
  assert.match(r.out, /step=npm-audit outcome=failed/);
  assert.doesNotMatch(r.out, /no longer reported/);
});
