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

function readEvents(machinistRunId) {
  // Machinist stores events per run under the worker data directory; find by run id.
  const r = sh("bash", ["-c", `ls -d ${machinistHome}/worker/runs/${machinistRunId}/lease_* 2>/dev/null | head -1`]);
  const dir = r.stdout.trim();
  if (!dir) return "";
  const j = sh("bash", ["-c", `jq -r 'select(.type=="process.output") | .data' "${dir}/events.jsonl" | base64 -d 2>/dev/null`]);
  return j.stdout;
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
      const { resultLine, pr, sha } = parseOutput(out);
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

// --- loop -----------------------------------------------------------------------------------
async function tick() {
  const { runs, effects } = await convex.query(api.bridge.pollQueued, { secret });
  for (const run of runs) {
    if (!tracked.has(run._id)) await submitRun(run);
  }
  for (const effect of effects) await runEffect(effect);
  await reconcileRuns();
}

log("start", "passed", `convex=${process.env.CONVEX_URL} machinist=${machinistUrl} poll_ms=${pollMs}`);
for (;;) {
  try {
    await tick();
  } catch (err) {
    log("tick", "failed", `error=${String(err.message ?? err).slice(0, 200)}`);
  }
  await new Promise((r) => setTimeout(r, pollMs));
}
