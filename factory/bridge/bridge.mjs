#!/usr/bin/env node
// Bridge between the Convex control plane and the local Machinist control plane (design §5.0).
// Runs on the worker machine, next to Machinist, with that machine's own credentials (gh, the
// factory scripts). Convex never holds shell or tokens; this process does the few GitHub
// mutations the state machine asks for (labels, comments, phase issues) as "effects".
//
// Env: CONVEX_URL (deployment URL), FACTORY_BRIDGE_SECRET, MACHINIST_URL, MACHINIST_TOKEN_FILE,
//      FACTORY_ROOT, MACHINIST_HOME, BRIDGE_POLL_MS (optional).
//      Local dev servers: FACTORY_WORKSPACE, LOCAL_SERVERS (on|off, default on),
//      LOCAL_SERVERS_MAX (default 0 = no limit), LOCAL_SERVERS_PORT_BASE (default 3100).
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { createLocalServers } from "./local-servers.mjs";
import { cooldownVerdict, registryPublishedAt } from "./dependency-cooldown.mjs";

const required = ["CONVEX_URL", "FACTORY_BRIDGE_SECRET", "MACHINIST_URL", "MACHINIST_TOKEN_FILE", "FACTORY_ROOT", "MACHINIST_HOME"];
for (const name of required) {
  if (!process.env[name]) {
    console.error(`MISSING_ENV ${name}`);
    process.exit(2);
  }
}
const expand = (p) => (p.startsWith("~/") ? path.join(homedir(), p.slice(2)) : p);
const secret = process.env.FACTORY_BRIDGE_SECRET;
const convex = new ConvexHttpClient(process.env.CONVEX_URL);
const machinistUrl = process.env.MACHINIST_URL.replace(/\/$/, "");
const machinistToken = readFileSync(expand(process.env.MACHINIST_TOKEN_FILE), "utf8").trim();
const factoryRoot = process.env.FACTORY_ROOT;
const machinistHome = expand(process.env.MACHINIST_HOME);
const pollMs = Number(process.env.BRIDGE_POLL_MS ?? 10_000);
const api = anyApi;

const log = (step, outcome, extra = "") => console.log(`BRIDGE step=${step} outcome=${outcome}${extra ? ` ${extra}` : ""}`);

async function machinist(pathname, init = {}) {
  const res = await fetch(`${machinistUrl}${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${machinistToken}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    throw new Error(`machinist ${pathname} -> HTTP ${res.status}`);
  }
  return res.json();
}

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", env: process.env, ...opts });
  return { ok: r.status === 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
}

// --- runs -----------------------------------------------------------------------------------
const tracked = new Map(); // runId -> { jobId }

async function submitRun(run) {
  const body = { prompt: run.prompt, repository: run.repository, command: run.command, ...(run.model ? { model: run.model } : {}) };
  const { id } = await machinist("/api/v1/jobs", { method: "POST", body: JSON.stringify(body) });
  await convex.mutation(api.bridge.markSubmitted, { secret, runId: run._id, machinistJobId: id });
  tracked.set(run._id, { jobId: id });
  log("submit", "passed", `run=${run._id} job=${id} command=${run.command}`);
}

// Machinist records one total per run in result.json: input + cache creation + cache read +
// output tokens, as the executor reported them. It does not keep the split.
function readTokenUsage(machinistRunId) {
  const r = sh("bash", ["-c", `ls -d ${machinistHome}/worker/runs/${machinistRunId}/lease_* 2>/dev/null | head -1`]);
  const dir = r.stdout.trim();
  if (!dir) return undefined;
  try {
    const total = JSON.parse(readFileSync(`${dir}/result.json`, "utf8")).token_usage;
    return typeof total === "number" ? total : undefined;
  } catch {
    return undefined;
  }
}

function readEvents(machinistRunId) {
  // Machinist stores events per run under the worker data directory; find by run id.
  const r = sh("bash", ["-c", `ls -d ${machinistHome}/worker/runs/${machinistRunId}/lease_* 2>/dev/null | head -1`]);
  const dir = r.stdout.trim();
  if (!dir) return "";
  const j = sh("bash", ["-c", `jq -r 'select(.type=="process.output") | .data' "${dir}/events.jsonl" | base64 -d 2>/dev/null`]);
  return j.stdout;
}

// The foreman records its PR on the issue; that is authoritative, the output is not (it also
// lists other open PRs while taking inventory -- which is how a Dependabot PR once became a
// phase's PR). Machinist has written it three ways: a `**Pull request:** <url>` line, a
// `| Pull request | <url> (open...) |` row in the foreman-state comment, and a separate
// `machinist:foreman-pr` comment. The newest match across those comments wins. Failing all of
// them, an open PR that GitHub says closes the issue is the next best evidence; failing that too,
// the PR the output named counts only if its branch carries the issue number the way the foreman
// names branches (codex/<issue>-<slug>), because the output also lists the PRs it inventoried.
const FOREMAN_PR = /(?:\*\*Pull request:\*\*|\|\s*Pull request\s*\||Pull request for this issue:)\s*https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)/g;
function prFromForemanState(ref, candidate) {
  const m = ref?.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)$/);
  if (!m) return undefined;
  const r = sh("gh", ["api", `repos/${m[1]}/issues/${m[2]}/comments`, "--paginate", "--jq", '.[] | select(.body | test("machinist:foreman-(state|pr)")) | .body']);
  const pr = r.ok ? [...r.stdout.matchAll(FOREMAN_PR)].pop() : undefined;
  if (pr) return Number(pr[1]);
  const closing = sh("gh", ["pr", "list", "--repo", m[1], "--state", "open", "--json", "number,closingIssuesReferences", "--jq", `[.[] | select(any(.closingIssuesReferences[]; .number == ${Number(m[2])})) | .number] | max // empty`]);
  const n = closing.ok ? Number(closing.stdout.trim()) : NaN;
  if (Number.isInteger(n) && n > 0) return n;
  if (candidate !== undefined) {
    const branch = sh("gh", ["pr", "view", String(candidate), "--repo", m[1], "--json", "headRefName", "--jq", ".headRefName"]);
    if (branch.ok && new RegExp(`(^|[^0-9])${Number(m[2])}([^0-9]|$)`).test(branch.stdout.trim())) return candidate;
  }
  return undefined;
}

// Executors narrate themselves one line at a time: `GENESIS step=clone outcome=passed`, from
// log() in factory/scripts/lib/common.sh. That narration never left the worker -- the control
// plane learned only the final state -- so a station sat on "running" for twenty minutes with
// nothing to say. Read it on every poll and give the floor the step the run is actually on.
const STEP_LINE = /^([A-Z][A-Z_]*) step=(\S+) outcome=(\S+)/;

// A note is a label on a station, not a log line: one sentence, no escape codes, bounded so it
// cannot push the rest of the floor off screen. The whole text stays in the run's events and in
// run.error -- this is the part that fits under a station.
const NOTE_MAX = 200;

function toNote(line) {
  // eslint-disable-next-line no-control-regex
  const clean = line.replace(/\u001b\[[0-9;]*m/g, "").trim();
  return clean.length > NOTE_MAX ? `${clean.slice(0, NOTE_MAX - 1)}…` : clean;
}

// The two kinds of stage narrate themselves differently, and a floor that only understood one
// would be blank for the other. Script stages (genesis, deploy-dev) print step lines. Agent
// stages (foreman, assess, greptile-fix, triage) stream Claude Code events, among them a
// purpose-built one:
//   {"type":"system","subtype":"task_progress","description":"Running Check nav anchors"}
// which is already written for a person to read. Both are the executor's own account of itself.
const TASK_PROGRESS = /"subtype":"task_progress"[^\n]*?"description":"((?:[^"\\]|\\.)*)"/g;

function parseProgress(text) {
  let step, outcome, note;
  const finished = new Set();
  for (const line of text.split("\n")) {
    const m = line.match(STEP_LINE);
    if (m) {
      [, , step, outcome] = m;
      // "started" is the step in flight; anything else is a step that reached an end.
      if (outcome !== "started") finished.add(m[2]);
      continue;
    }
    // Keep the most recent failure line: when a run stops, this is the sentence worth showing.
    if (/^(ERROR|NEEDS_HUMAN|MISSING_ENV|MISSING_ARG)\b/.test(line)) note = toNote(line);
  }

  if (!step) {
    // No step lines: either an agent stage, or a script that died before its first step.
    const tasks = [...text.matchAll(TASK_PROGRESS)].map((m) => m[1]);
    if (tasks.length > 0) {
      // Distinct descriptions, because a task repeats its line on every heartbeat. This counts
      // work observed, not a fraction of a known total -- an agent has no fixed step list.
      return {
        step: toNote(tasks[tasks.length - 1].replace(/\\"/g, '"')),
        outcome: "started",
        done: new Set(tasks).size,
        at: Date.now(),
        ...(note ? { note } : {}),
      };
    }
    // A run can fail before anything announces itself -- a missing provider env is rejected up
    // front -- and that is exactly when the operator most needs the reason.
    return note ? { step: "—", outcome: "failed", done: 0, at: Date.now(), note } : undefined;
  }
  return { step, outcome, done: finished.size, at: Date.now(), ...(note ? { note } : {}) };
}

// Script stages print their result line at the start of a line. Agent stages stream Claude
// Code JSON, where the same line sits inside a "text" field with JSON escaping -- which is how
// four greptile-fix runs reported outcome=needs-human and the control plane saw none of it.
// Find the line in either place; the last one wins. A plain line is taken whole, quotes and all,
// since a free-text reason= may contain them; inside JSON the string's own escaping marks the end.
const PLAIN_RESULT = /^(?:RESULT|DEPLOY_RESULT|ASSESS_RESULT|GREPTILE_FIX|TRIAGE) .*$/gm;
const EMBEDDED_RESULT = /(?:^|[^A-Za-z_]|\\n)((?:RESULT|DEPLOY_RESULT|ASSESS_RESULT|GREPTILE_FIX|TRIAGE) (?:[^\n"\\`]|\\")*)/gm;
function resultLineOf(text) {
  const plain = [...text.matchAll(PLAIN_RESULT)].pop()?.[0];
  if (plain) return plain.trim();
  return [...text.matchAll(EMBEDDED_RESULT)].pop()?.[1]?.replace(/\\"/g, '"').trim();
}
function parseOutput(text) {
  const resultLine = resultLineOf(text);
  const prMatch = text.match(/https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)/g);
  const pr = prMatch ? Number(prMatch[prMatch.length - 1].split("/").pop()) : undefined;
  const sha = [...text.matchAll(/\b(?:head|sha)=([0-9a-f]{40})\b/g)].pop()?.[1];
  return { resultLine, pr, sha };
}

async function reconcileRuns() {
  const status = await machinist("/api/v1/status");
  const jobs = new Map((status.jobs ?? []).map((j) => [j.id, j]));
  for (const [runId, { jobId }] of tracked) {
    const job = jobs.get(jobId);
    if (!job) continue;
    const mrun = job.runs?.[job.runs.length - 1];
    if (mrun) {
      // readEvents works mid-run, so the operator sees the step while it is still happening.
      const progress = parseProgress(readEvents(mrun.id));
      await convex.mutation(api.bridge.mirror, {
        secret,
        runId,
        machinistRunId: mrun.id,
        ...(mrun.executor ? { executor: mrun.executor } : {}),
        ...(progress ? { progress } : {}),
      });
    }
    if (["succeeded", "failed", "cancelled", "timed_out"].includes(job.state)) {
      const out = mrun ? readEvents(mrun.id) : "";
      const parsed = parseOutput(out);
      const resultLine = parsed.resultLine, sha = parsed.sha;
      const run = await convex.query(api.bridge.runById, { secret, runId }).catch(() => null);
      // A foreman's PR comes from the issue; its output names every open PR it inventoried, so
      // the last URL there is only a candidate, accepted when its branch names the issue.
      const pr = run?.command === "foreman" ? prFromForemanState(run.ref, parsed.pr) : parsed.pr;
      const tokenUsage = mrun ? readTokenUsage(mrun.id) : undefined;
      const state = job.state === "succeeded" ? "succeeded" : job.state === "cancelled" ? "cancelled" : job.state === "timed_out" ? "timed_out" : "failed";
      await convex.mutation(api.bridge.complete, {
        secret,
        runId,
        state,
        ...(mrun?.exit_code === undefined || mrun?.exit_code === null ? {} : { exitCode: mrun.exit_code }),
        ...(mrun?.error ? { error: mrun.error } : {}),
        ...(resultLine ? { resultLine } : {}),
        ...(sha ? { headSha: sha } : {}),
        ...(pr === undefined ? {} : { pr }),
        ...(tokenUsage === undefined ? {} : { tokenUsage }),
      });
      tracked.delete(runId);
      log("complete", state, `run=${runId} job=${jobId}${pr ? ` pr=${pr}` : ""}`);
    }
  }
}

// --- effects (local credentials) ------------------------------------------------------------
// The labels the factory applies, as create-phase-issues.sh defines them, for a repository that
// lacks one.
const LABELS = {
  "machinist:auto-merge": { color: "5319e7", description: "The shepherd may verify, update, repair, and merge this pull request" },
  "machinist:requested": { color: "0e8a16", description: "Ready for the Machinist foreman" },
  "factory:forced-gray": { color: "b60205", description: "A human must apply machinist:auto-merge" },
  "factory:security-finding": { color: "d93f0b", description: "Opened from a security assessment finding" },
};
async function runEffect(effect) {
  const a = effect.args ?? {};
  try {
    let result;
    switch (effect.kind) {
      case "apply-label": {
        let r = sh("gh", ["issue", "edit", String(a.number), "--repo", a.repo, "--add-label", a.label]);
        if (!r.ok && /not found/i.test(r.stderr)) {
          // Genesis creates the labels a product needs, but a repository made before a label was
          // added to that list (or by hand) may lack it, and a passing gate must not stall on a
          // missing tag. Create it with the factory's colour and meaning, then apply again.
          const meta = LABELS[a.label] ?? { color: "ededed", description: "Applied by the Agentic Secure Dark Factory" };
          sh("gh", ["label", "create", a.label, "--repo", a.repo, "--color", meta.color, "--description", meta.description]);
          log("effect", "label-created", `repo=${a.repo} label=${a.label}`);
          r = sh("gh", ["issue", "edit", String(a.number), "--repo", a.repo, "--add-label", a.label]);
        }
        if (!r.ok) throw new Error(r.stderr.trim());
        result = { label: a.label };
        break;
      }
      case "remove-label": {
        const r = sh("gh", ["issue", "edit", String(a.number), "--repo", a.repo, "--remove-label", a.label]);
        if (!r.ok) throw new Error(r.stderr.trim());
        result = { label: a.label };
        break;
      }
      case "comment": {
        const r = sh("gh", ["issue", "comment", String(a.number), "--repo", a.repo, "--body", a.body]);
        if (!r.ok) throw new Error(r.stderr.trim());
        result = { url: r.stdout.trim() };
        break;
      }
      case "create-phase-issues": {
        const specPath = path.join(machinistHome, `spec-${effect._id}.json`);
        sh("bash", ["-c", `umask 077; cat > '${specPath}'`], { input: JSON.stringify(a.spec) });
        const r = sh(path.join(factoryRoot, "factory/scripts/create-phase-issues.sh"), [specPath, "--request-first"]);
        sh("rm", ["-f", specPath]);
        if (!r.ok) throw new Error(r.stderr.trim() || r.stdout.trim());
        const issues = [...r.stdout.matchAll(/issue=(https:\/\/github\.com\/\S+)/g)].map((m) => m[1]);
        // Skipped phases print issue numbers, not URLs; resolve them in order.
        const owner = a.spec.github_owner, name = a.spec.name;
        const all = [...r.stdout.matchAll(/phase-(\d+) outcome=(passed|skipped) issue=(\S+)/g)]
          .map((m) => (m[3].startsWith("http") ? m[3] : `https://github.com/${owner}/${name}/issues/${m[3]}`));
        result = { issues: all.length ? all : issues };
        break;
      }
      case "reveal-claim-url": {
        const dir = path.join(expand(process.env.FACTORY_WORKSPACE ?? ""), a.name);
        const r = sh("doppler", ["secrets", "get", "FACTORY_CLERK_CLAIM_URL", "--plain", "--config", "dev"], { cwd: dir });
        if (!r.ok) throw new Error(r.stderr.trim() || "doppler secrets get failed");
        const url = r.stdout.trim();
        if (!url) throw new Error("FACTORY_CLERK_CLAIM_URL is empty in Doppler dev");
        result = { url };
        break;
      }
      case "register-repository": {
        const p = path.join(expand(process.env.FACTORY_WORKSPACE ?? ""), a.name);
        const r = sh(path.join(factoryRoot, "factory/scripts/register-repository.sh"), [a.name, p]);
        if (!r.ok) throw new Error(r.stderr.trim() || r.stdout.trim());
        result = { path: p, note: "restart the worker to advertise the new repository" };
        break;
      }
      default:
        throw new Error(`unknown effect kind ${effect.kind}`);
    }
    await convex.mutation(api.bridge.effectResult, { secret, effectId: effect._id, ok: true, result });
    log("effect", "passed", `kind=${effect.kind}`);
  } catch (err) {
    await convex.mutation(api.bridge.effectResult, { secret, effectId: effect._id, ok: false, error: String(err.message ?? err) });
    log("effect", "failed", `kind=${effect.kind} error=${String(err.message ?? err).slice(0, 200)}`);
  }
}

// --- gate sync (webhook-independent view of CI and reviewer state) ---------------------------
let lastGateSync = 0;

// Lockfile cooldown per PR head: only recomputed when the head moves, because it fetches both
// lockfiles and a packument for every new package.
const cooldownByHead = new Map();
const publishedAt = registryPublishedAt();
const LOCKFILES = new Set(["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"]);
async function dependencyCooldown(repo, view) {
  const changed = (view.files ?? []).map((f) => f.path).filter((p) => LOCKFILES.has(p.split("/").pop()));
  if (changed.length === 0 || !view.headRefOid) return undefined;
  const key = `${repo}@${view.headRefOid}`;
  if (cooldownByHead.has(key)) return cooldownByHead.get(key);
  let verdict;
  if (changed.some((p) => !/(^|\/)package(-lock)?\.json$/.test(p))) {
    verdict = { ok: false, checked: 0, violations: [`only package-lock.json can be checked; this PR changes ${changed.join(", ")}`] };
  } else if (changed.some((p) => p.includes("/"))) {
    verdict = { ok: false, checked: 0, violations: [`only the root lockfile is checked; this PR changes ${changed.join(", ")}`] };
  } else {
    const read = (ref) => {
      const r = sh("gh", ["api", `repos/${repo}/contents/package-lock.json?ref=${ref}`, "-H", "Accept: application/vnd.github.raw"]);
      return r.ok ? JSON.parse(r.stdout) : null;
    };
    const base = read(view.baseRefName ?? "main"), head = read(view.headRefOid);
    verdict = base && head ? await cooldownVerdict(base, head, publishedAt) : { ok: false, checked: 0, violations: ["could not read package-lock.json from the base or the head"] };
  }
  cooldownByHead.set(key, verdict);
  log("dependency-cooldown", verdict.ok ? "passed" : "failed", `repo=${repo} head=${view.headRefOid.slice(0, 8)} checked=${verdict.checked} violations=${verdict.violations.length}`);
  return verdict;
}
async function syncGates() {
  if (Date.now() - lastGateSync < Number(process.env.BRIDGE_GATE_SYNC_MS ?? 60_000)) return;
  lastGateSync = Date.now();
  const targets = await convex.query(api.bridge.reviewTargets, { secret });
  for (const t of targets) {
    const checks = sh("gh", ["pr", "checks", String(t.pr), "--repo", t.repo, "--json", "name,bucket,link,startedAt"]);
    const req = sh("gh", ["api", `repos/${t.repo}/branches/main/protection/required_status_checks`, "--jq", ".contexts[]"]);
    const required = new Set(req.ok ? req.stdout.split("\n").filter(Boolean) : []);
    // Every check run on the head is listed, so a workflow triggered by both push and
    // pull_request reports each job twice. Branch protection judges the newest run per name;
    // keep that one, or a decision reads "security, security".
    const newest = new Map();
    for (const c of checks.ok ? JSON.parse(checks.stdout || "[]") : []) {
      if (!newest.has(c.name) || String(c.startedAt ?? "") > String(newest.get(c.name).startedAt ?? "")) newest.set(c.name, c);
    }
    const ci = [...newest.values()].map((c) => ({ name: c.name, conclusion: c.bucket === "pass" ? "success" : c.bucket === "fail" ? "failure" : c.bucket === "skipping" ? "skipped" : "pending", required: required.has(c.name), ...(c.link ? { url: c.link } : {}) }));
    const view = sh("gh", ["pr", "view", String(t.pr), "--repo", t.repo, "--json", "headRefOid,baseRefName,files,labels"]);
    const v = view.ok ? JSON.parse(view.stdout) : {};
    const cooldown = await dependencyCooldown(t.repo, v);
    const score = sh(path.join(factoryRoot, "factory/scripts/greptile-score.sh"), [t.repo, String(t.pr)]);
    const sc = score.ok ? JSON.parse(score.stdout) : { score: null, comments: [], unresolved: 0, scored_at: null };
    // Greptile reviews on push, but not always; when the newest score predates the head commit, ask once per head.
    const head = sh("gh", ["api", `repos/${t.repo}/commits/${v.headRefOid}`, "--jq", ".commit.committer.date"]);
    const headAt = head.ok ? Date.parse(head.stdout.trim()) : NaN;
    const scoredAt = sc.scored_at ? Date.parse(sc.scored_at) : NaN;
    const stale = Number.isFinite(headAt) && (!Number.isFinite(scoredAt) || scoredAt < headAt);
    // The once-per-head marker is stored on the gate row (reviewRequestedHead), so a bridge restart
    // does not post a second mention for the same head.
    let reviewRequestedHead = t.reviewRequestedHead ?? undefined;
    if (stale && v.headRefOid && reviewRequestedHead !== v.headRefOid && Date.now() - headAt > 3 * 60_000) {
      const mention = process.env.GREPTILE_REVIEW_MENTION ?? "@greptileai review";
      const c = sh("gh", ["pr", "comment", String(t.pr), "--repo", t.repo, "--body", mention]);
      if (c.ok) { reviewRequestedHead = v.headRefOid; log("review-request", "passed", `repo=${t.repo} pr=${t.pr} head=${v.headRefOid.slice(0, 8)}`); }
    }
    await convex.mutation(api.bridge.gateSync, {
      secret,
      projectId: t.projectId,
      pr: t.pr,
      ...(v.headRefOid ? { headSha: v.headRefOid } : {}),
      ci,
      reviewScore: stale ? null : (sc.score ?? null),
      ...(!stale && sc.summary ? { reviewSummary: sc.summary } : {}),
      unresolvedComments: typeof sc.unresolved === "number" ? sc.unresolved : (sc.comments ?? []).filter((c) => !c.in_reply_to_id).length,
      changedPaths: (v.files ?? []).map((f) => f.path),
      labels: (v.labels ?? []).map((l) => l.name),
      ...(cooldown ? { dependencyCooldown: { ok: cooldown.ok, checked: cooldown.checked, violations: cooldown.violations.slice(0, 50) } } : {}),
      ...(reviewRequestedHead ? { reviewRequestedHead } : {}),
    });
    log("gate-sync", "passed", `repo=${t.repo} pr=${t.pr} ci=${ci.length} required=${ci.filter((c) => c.required).length} score=${stale ? "stale" : (sc.score ?? "none")} unresolved=${typeof sc.unresolved === "number" ? sc.unresolved : "?"}`);
  }
}

// --- local dev servers (see local-servers.mjs) ----------------------------------------------
const superviseLocal =
  process.env.LOCAL_SERVERS !== "off" && process.env.FACTORY_WORKSPACE
    ? createLocalServers({ convex, api, secret, machinistHome, workspace: expand(process.env.FACTORY_WORKSPACE), log })
    : async () => {};

// --- loop -----------------------------------------------------------------------------------
async function tick() {
  // Re-attach any run the control plane considers running that this process is not tracking
  // (a retracked job, or a run submitted before a restart).
  for (const r of await convex.query(api.bridge.running, { secret })) {
    if (!tracked.has(r.runId)) tracked.set(r.runId, { jobId: r.machinistJobId });
  }
  const { runs, effects } = await convex.query(api.bridge.pollQueued, { secret });
  for (const run of runs) {
    if (!tracked.has(run._id)) await submitRun(run);
  }
  for (const effect of effects) await runEffect(effect);
  // The dev servers need only Convex and this machine, so they are looked after before anything
  // that talks to Machinist: when it is down, their status must not go stale with it.
  await superviseLocal();
  await reconcileRuns();
  await syncGates();
}

log("start", "passed", `convex=${process.env.CONVEX_URL} machinist=${machinistUrl} poll_ms=${pollMs}`);
// Re-track runs submitted before a restart so their completion is still reported.
try {
  for (const r of await convex.query(api.bridge.running, { secret })) {
    tracked.set(r.runId, { jobId: r.machinistJobId });
  }
  log("retrack", "passed", `runs=${tracked.size}`);
} catch (err) {
  log("retrack", "failed", `error=${String(err.message ?? err).slice(0, 200)}`);
}
for (;;) {
  try {
    await tick();
  } catch (err) {
    log("tick", "failed", `error=${String(err.message ?? err).slice(0, 200)}`);
  }
  await new Promise((r) => setTimeout(r, pollMs));
}
