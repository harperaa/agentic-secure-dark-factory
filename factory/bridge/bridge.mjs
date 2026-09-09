#!/usr/bin/env node
// Bridge between the Convex control plane and the local Machinist control plane (design §5.0).
// Runs on the worker machine, next to Machinist, with that machine's own credentials (gh, the
// factory scripts). Convex never holds shell or tokens; this process does the few GitHub
// mutations the state machine asks for (labels, comments, phase issues) as "effects".
//
// Env: CONVEX_URL (deployment URL), FACTORY_BRIDGE_SECRET, MACHINIST_URL, MACHINIST_TOKEN_FILE,
//      FACTORY_ROOT, MACHINIST_HOME, BRIDGE_POLL_MS (optional).
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";

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

function readTokenUsage(machinistRunId) {
  const r = sh("bash", ["-c", `ls -d ${machinistHome}/worker/runs/${machinistRunId}/lease_* 2>/dev/null | head -1`]);
  const dir = r.stdout.trim();
  if (!dir) return undefined;
  try {
    const result = JSON.parse(readFileSync(`${dir}/result.json`, "utf8"));
    const u = result.token_usage ?? result.usage ?? result.tokens;
    if (!u || typeof u !== "object") return undefined;
    const num = (x) => (typeof x === "number" ? x : undefined);
    const input = num(u.input_tokens ?? u.input ?? u.prompt_tokens);
    const output = num(u.output_tokens ?? u.output ?? u.completion_tokens);
    if (input === undefined || output === undefined) return undefined;
    const cacheRead = num(u.cache_read_input_tokens ?? u.cache_read);
    const cacheWrite = num(u.cache_creation_input_tokens ?? u.cache_write);
    return { input, output, ...(cacheRead === undefined ? {} : { cacheRead }), ...(cacheWrite === undefined ? {} : { cacheWrite }) };
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

// The foreman records its PR in the issue's state comment; that is authoritative, the output is not
// (it also lists other open PRs while taking inventory).
function prFromForemanState(ref) {
  const m = ref?.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)$/);
  if (!m) return undefined;
  const r = sh("gh", ["api", `repos/${m[1]}/issues/${m[2]}/comments`, "--paginate", "--jq", '.[] | select(.body | contains("machinist:foreman-state")) | .body']);
  if (!r.ok) return undefined;
  const pr = [...r.stdout.matchAll(/\*\*Pull request:\*\*\s*(https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+))/g)].pop();
  return pr ? Number(pr[2]) : undefined;
}

function parseOutput(text) {
  const lines = text.split("\n");
  const resultLine = [...lines].reverse().find((l) => /^(RESULT|DEPLOY_RESULT|ASSESS_RESULT|GREPTILE_FIX|TRIAGE) /.test(l));
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
      await convex.mutation(api.bridge.mirror, { secret, runId, machinistRunId: mrun.id, ...(mrun.executor ? { executor: mrun.executor } : {}) });
    }
    if (["succeeded", "failed", "cancelled", "timed_out"].includes(job.state)) {
      const out = mrun ? readEvents(mrun.id) : "";
      const parsed = parseOutput(out);
      const resultLine = parsed.resultLine, sha = parsed.sha;
      const run = await convex.query(api.bridge.runById, { secret, runId }).catch(() => null);
      const pr = (run?.command === "foreman" ? prFromForemanState(run.ref) : undefined) ?? parsed.pr;
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
        ...(tokenUsage ? { tokenUsage } : {}),
      });
      tracked.delete(runId);
      log("complete", state, `run=${runId} job=${jobId}${pr ? ` pr=${pr}` : ""}`);
    }
  }
}

// --- effects (local credentials) ------------------------------------------------------------
async function runEffect(effect) {
  const a = effect.args ?? {};
  try {
    let result;
    switch (effect.kind) {
      case "apply-label": {
        const r = sh("gh", ["issue", "edit", String(a.number), "--repo", a.repo, "--add-label", a.label]);
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
const reviewRequested = new Map(); // "owner/repo#pr" -> head sha the re-review was requested for
async function syncGates() {
  if (Date.now() - lastGateSync < Number(process.env.BRIDGE_GATE_SYNC_MS ?? 60_000)) return;
  lastGateSync = Date.now();
  const targets = await convex.query(api.bridge.reviewTargets, { secret });
  for (const t of targets) {
    const checks = sh("gh", ["pr", "checks", String(t.pr), "--repo", t.repo, "--json", "name,bucket"]);
    const req = sh("gh", ["api", `repos/${t.repo}/branches/main/protection/required_status_checks`, "--jq", ".contexts[]"]);
    const required = new Set(req.ok ? req.stdout.split("\n").filter(Boolean) : []);
    const ci = checks.ok ? JSON.parse(checks.stdout || "[]").map((c) => ({ name: c.name, conclusion: c.bucket === "pass" ? "success" : c.bucket === "fail" ? "failure" : c.bucket === "skipping" ? "skipped" : "pending", required: required.has(c.name) })) : [];
    const view = sh("gh", ["pr", "view", String(t.pr), "--repo", t.repo, "--json", "headRefOid,files,labels"]);
    const v = view.ok ? JSON.parse(view.stdout) : {};
    const score = sh(path.join(factoryRoot, "factory/scripts/greptile-score.sh"), [t.repo, String(t.pr)]);
    const sc = score.ok ? JSON.parse(score.stdout) : { score: null, comments: [], unresolved: 0, scored_at: null };
    // Greptile reviews on push, but not always; when the newest score predates the head commit, ask once per head.
    const head = sh("gh", ["api", `repos/${t.repo}/commits/${v.headRefOid}`, "--jq", ".commit.committer.date"]);
    const headAt = head.ok ? Date.parse(head.stdout.trim()) : NaN;
    const scoredAt = sc.scored_at ? Date.parse(sc.scored_at) : NaN;
    const stale = Number.isFinite(headAt) && (!Number.isFinite(scoredAt) || scoredAt < headAt);
    if (stale && v.headRefOid && reviewRequested.get(`${t.repo}#${t.pr}`) !== v.headRefOid && Date.now() - headAt > 3 * 60_000) {
      const mention = process.env.GREPTILE_REVIEW_MENTION ?? "@greptileai review";
      const c = sh("gh", ["pr", "comment", String(t.pr), "--repo", t.repo, "--body", mention]);
      if (c.ok) { reviewRequested.set(`${t.repo}#${t.pr}`, v.headRefOid); log("review-request", "passed", `repo=${t.repo} pr=${t.pr} head=${v.headRefOid.slice(0, 8)}`); }
    }
    await convex.mutation(api.bridge.gateSync, {
      secret,
      projectId: t.projectId,
      pr: t.pr,
      ...(v.headRefOid ? { headSha: v.headRefOid } : {}),
      ci,
      reviewScore: stale ? null : (sc.score ?? null),
      unresolvedComments: typeof sc.unresolved === "number" ? sc.unresolved : (sc.comments ?? []).filter((c) => !c.in_reply_to_id).length,
      changedPaths: (v.files ?? []).map((f) => f.path),
      labels: (v.labels ?? []).map((l) => l.name),
    });
    log("gate-sync", "passed", `repo=${t.repo} pr=${t.pr} ci=${ci.length} required=${ci.filter((c) => c.required).length} score=${stale ? "stale" : (sc.score ?? "none")} unresolved=${typeof sc.unresolved === "number" ? sc.unresolved : "?"}`);
  }
}

// --- loop -----------------------------------------------------------------------------------
async function tick() {
  const { runs, effects } = await convex.query(api.bridge.pollQueued, { secret });
  for (const run of runs) {
    if (!tracked.has(run._id)) await submitRun(run);
  }
  for (const effect of effects) await runEffect(effect);
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
