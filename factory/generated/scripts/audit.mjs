#!/usr/bin/env node
// factory-managed: written by the factory's genesis (apply-generated.sh); edits here are overwritten.
// `npm audit --audit-level=high` with an allowlist that cannot go stale.
//
// npm audit has no way to accept one advisory, so an advisory with no patched release fails
// the required `security` check on every branch, including main. audit-allowlist.json names
// the advisories the factory accepts, each with a reason and a review date. This script fails
// when:
//   - a high or critical advisory is reported that the allowlist does not cover;
//   - an allowlisted entry is past its reviewBy date (the review is overdue);
//   - an allowlisted advisory now has a non-breaking fix (take it, and drop the entry);
//   - an allowlisted advisory is no longer reported at all (drop the entry).
// Only the operator edits audit-allowlist.json (see AGENTS.md); agents stop with needs-human.
//
// Usage: node scripts/audit.mjs [--today=YYYY-MM-DD]   (run from the repository root)
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const todayArg = process.argv.find((a) => a.startsWith("--today="))?.slice(8);
const today = todayArg ?? new Date().toISOString().slice(0, 10);
const allowlist = JSON.parse(readFileSync(new URL("../audit-allowlist.json", import.meta.url), "utf8"));
const allowed = new Map(allowlist.map((e) => [e.id, e]));

// npm audit exits nonzero whenever it finds anything; the JSON on stdout is still complete.
const r = spawnSync("npm", ["audit", "--json", "--audit-level=high"], { encoding: "utf8" });
let report;
try {
  report = JSON.parse(r.stdout);
} catch {
  console.error(`AUDIT step=npm-audit outcome=failed note=${(r.stderr || r.stdout).trim().slice(0, 300)}`);
  process.exit(1);
}
// A registry failure comes back as parseable JSON too, with an `error` and no `vulnerabilities`;
// that is an audit that did not happen, not a clean one.
if (report.error || typeof report.vulnerabilities !== "object" || report.vulnerabilities === null) {
  console.error(`AUDIT step=npm-audit outcome=failed note=${JSON.stringify(report.error ?? "no vulnerabilities field in the report").slice(0, 300)}`);
  process.exit(1);
}
const vulns = report.vulnerabilities;
const failures = [];

const ghsa = (via) => via.url?.match(/GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/)?.[0];

// A package is accepted when every advisory on it is allowlisted, or it is only vulnerable
// through packages that are themselves accepted (`via` names a package, not an advisory).
// Iterate to a fixpoint because the dependency chain is reported one package at a time.
const accepted = new Set();
let grew = true;
while (grew) {
  grew = false;
  for (const [name, v] of Object.entries(vulns)) {
    if (accepted.has(name)) continue;
    const ok = v.via.every((via) => (typeof via === "string" ? accepted.has(via) : allowed.has(ghsa(via))));
    if (ok) {
      accepted.add(name);
      grew = true;
    }
  }
}

const seen = new Set();
for (const [name, v] of Object.entries(vulns)) {
  if (!["high", "critical"].includes(v.severity)) continue;
  for (const via of v.via) {
    if (typeof via === "string") continue;
    const id = ghsa(via);
    if (!allowed.has(id)) continue;
    seen.add(id);
    // fixAvailable is false, true, or {name, version, isSemVerMajor}. A fix the package itself
    // publishes, or any non-breaking fix, ends the entry's justification. A "breaking fix" that
    // names a different package is npm offering to swap the dependent (for braces: downgrade
    // eslint-config-next to 14), not a patched release of the advisory's package; it is noted,
    // and the entry's reviewBy date is what forces the operator to look again.
    const fix = v.fixAvailable;
    if (fix === true || (fix && (fix.isSemVerMajor === false || fix.name === name))) {
      failures.push(`${id} (${name}) now has a fix${fix === true ? "" : ` via ${fix.name}@${fix.version}`}: take it and remove the entry from audit-allowlist.json`);
    } else if (fix) {
      console.log(`AUDIT step=allowlist outcome=noted id=${id} note=npm offers a breaking change via ${fix.name}@${fix.version}; not a patched ${name}`);
    }
  }
  if (!accepted.has(name)) {
    const ids = v.via.map((via) => (typeof via === "string" ? `via ${via}` : ghsa(via) ?? via.title)).join(", ");
    failures.push(`${name} ${v.severity}: ${ids}`);
  }
}

for (const e of allowlist) {
  if (!seen.has(e.id)) failures.push(`${e.id} (${e.package}) is no longer reported: remove it from audit-allowlist.json`);
  if (e.reviewBy < today) failures.push(`${e.id} (${e.package}) review was due ${e.reviewBy}: re-check for a fix, then extend reviewBy or remove the entry`);
}

for (const e of allowlist) {
  if (seen.has(e.id)) console.log(`AUDIT step=allowlist outcome=accepted id=${e.id} package=${e.package} reviewBy=${e.reviewBy}`);
}
if (failures.length > 0) {
  for (const f of failures) console.error(`AUDIT step=audit outcome=failed note=${f}`);
  process.exit(1);
}
console.log(`AUDIT step=audit outcome=passed allowlisted=${allowlist.length}`);
