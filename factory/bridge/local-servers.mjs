// Local dev servers (one per built product), supervised by the bridge on the worker machine.
//
// The hosted dev deploy only happens at the end of the line, after every phase and the
// assessment. Until then the only way to see the product is to run it, so the bridge keeps a
// `next dev` running in each product's checkout and reports the process to the control plane.
//
// Security: the server binds to loopback only (`-H localhost`; `-H 127.0.0.1` makes Next's dev
// router proxy every request to http://localhost:<port> and hang, and no -H binds every
// interface, LAN included), and its environment is built from scratch --
// the product's own Doppler dev secrets plus the few variables a Node process needs. The
// bridge's environment holds the bridge secret, the Doppler service token, and LLM keys; none of
// that is handed to product code the factory has just generated.
//
// Servers are spawned detached and outlive a bridge restart. The state file per product
// (MACHINIST_HOME/local-servers/<name>.json) is how a restarted bridge re-adopts them.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync, closeSync } from "node:fs";
import { homedir } from "node:os";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PORT_BASE = Number(process.env.LOCAL_SERVERS_PORT_BASE ?? 3100);
// 0 (the default) runs a server for every project; set a number on a machine short of memory.
const MAX_SERVERS = Number(process.env.LOCAL_SERVERS_MAX ?? 0);
const PULL_EVERY_MS = 60_000;
const NOTE_MAX = 200;

// Only these reach the product process from the bridge's own environment.
const PASS_THROUGH = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "TMPDIR", "TERM"];
// Doppler adds its own metadata and the factory keeps operator-only values in the product's
// config; the running product needs none of them. The claim URL in particular hands over the
// Clerk application.
const DENY = /^(DOPPLER_|FACTORY_|VERCEL_OIDC_TOKEN$)/;

/** The environment a product's dev server runs with: a minimal base plus its own secrets. */
export function productEnv(base, secrets) {
  const env = { NEXT_TELEMETRY_DISABLED: "1" };
  for (const k of PASS_THROUGH) if (base[k] !== undefined) env[k] = base[k];
  for (const [k, v] of Object.entries(secrets)) if (!DENY.test(k) && typeof v === "string") env[k] = v;
  return env;
}

/** Lowest port from the base that no other product has claimed and nothing is listening on. */
export async function pickPort(taken, isFree = portFree) {
  for (let port = PORT_BASE; port < PORT_BASE + 100; port++) {
    if (!taken.has(port) && (await isFree(port))) return port;
  }
  throw new Error(`no free port in ${PORT_BASE}-${PORT_BASE + 99}`);
}

function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, "localhost", () => srv.close(() => resolve(true)));
  });
}

function toNote(line) {
  // eslint-disable-next-line no-control-regex
  const clean = line.replace(/\u001b\[[0-9;]*m/g, "").trim();
  return clean.length > NOTE_MAX ? `${clean.slice(0, NOTE_MAX - 1)}…` : clean;
}

/** The last line of a log that reads like an error, for the station note. */
export function lastError(text) {
  const lines = text.split("\n").filter((l) => /error|ERR!|failed|EADDRINUSE|Cannot find/i.test(l));
  return lines.length ? toNote(lines[lines.length - 1]) : undefined;
}

// A pid from a state file may have been reused by an unrelated process after a reboot; only a
// live process that is still `next dev` counts as ours.
function alive(pid) {
  if (!pid) return false;
  const r = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
  return r.status === 0 && /next/.test(r.stdout);
}

function stopServer(dir, name) {
  const file = path.join(dir, `${name}.json`);
  let state = null;
  try {
    state = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    /* no state: nothing of ours is running */
  }
  if (state?.pid && alive(state.pid)) {
    // Detached, so the server leads its own process group; kill the group to take its workers too.
    try {
      process.kill(-state.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  rmSync(file, { force: true });
}

/** Stop every server the bridge started on this machine; start-local.sh calls this on shutdown. */
export function stopAllLocalServers(machinistHome) {
  const dir = path.join(machinistHome, "local-servers");
  const names = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)) : [];
  for (const name of names) stopServer(dir, name);
  return names;
}

export function createLocalServers({ convex, api, secret, machinistHome, workspace, log }) {
  const dir = path.join(machinistHome, "local-servers");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const installs = new Map(); // name -> { child, lockHash }
  const lastPull = new Map(); // name -> ms
  const backoff = new Map(); // name -> { until, tries }
  const known = new Map(); // name -> projectId, so a server dropped from the targets can be reported stopped

  const statePath = (name) => path.join(dir, `${name}.json`);
  const logPath = (name) => path.join(dir, `${name}.log`);
  const readState = (name) => {
    try {
      return JSON.parse(readFileSync(statePath(name), "utf8"));
    } catch {
      return null;
    }
  };
  const writeState = (name, state) => writeFileSync(statePath(name), JSON.stringify(state), { mode: 0o600 });
  const logTail = (name) => {
    try {
      return readFileSync(logPath(name), "utf8").slice(-8000);
    } catch {
      return "";
    }
  };
  const git = (checkout, ...args) => spawnSync("git", ["-C", checkout, ...args], { encoding: "utf8" });
  const head = (checkout) => git(checkout, "rev-parse", "--short", "HEAD").stdout.trim() || undefined;
  const lockHash = (checkout) => {
    try {
      return createHash("sha256").update(readFileSync(path.join(checkout, "package-lock.json"))).digest("hex").slice(0, 16);
    } catch {
      return "none";
    }
  };

  async function answering(port) {
    try {
      await fetch(`http://localhost:${port}/`, { redirect: "manual", signal: AbortSignal.timeout(5000) });
      return true;
    } catch {
      return false;
    }
  }

  const stop = (name) => stopServer(dir, name);

  function secretsFor(target, checkout) {
    if (target.secrets !== "doppler") return {}; // other providers keep a local .env.local, which next dev reads
    const r = spawnSync("doppler", ["secrets", "download", "--no-file", "--format", "json", "--project", target.name, "--config", "dev"], { cwd: checkout, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`doppler: ${toNote(r.stderr || "secrets download failed")}`);
    return JSON.parse(r.stdout);
  }

  function install(target, checkout) {
    const fd = openSync(logPath(target.name), "a");
    const child = spawn("npm", ["ci", "--no-audit", "--no-fund"], { cwd: checkout, stdio: ["ignore", fd, fd], env: productEnv(process.env, {}) });
    closeSync(fd);
    const entry = { child, lockHash: lockHash(checkout), exit: undefined };
    child.on("exit", (code) => {
      entry.exit = code ?? 1;
    });
    child.on("error", () => {
      entry.exit = 1;
    });
    installs.set(target.name, entry);
    log("local-install", "started", `project=${target.name}`);
  }

  function start(target, checkout, port) {
    const env = productEnv(process.env, secretsFor(target, checkout));
    const fd = openSync(logPath(target.name), "a");
    const args = ["dev", "-H", "localhost", "-p", String(port)];
    const child = spawn(path.join(checkout, "node_modules/.bin/next"), args, { cwd: checkout, stdio: ["ignore", fd, fd], env, detached: true });
    closeSync(fd);
    child.on("error", () => {}); // a missing binary surfaces as a dead pid on the next pass
    child.unref();
    const state = { pid: child.pid, port, startedAt: Date.now(), head: head(checkout), lockHash: lockHash(checkout) };
    writeState(target.name, state);
    log("local-start", "passed", `project=${target.name} port=${port} pid=${child.pid}`);
    return state;
  }

  // Keep the served checkout on origin/main, but only when nothing else is using it: no run in
  // flight and no local changes. Fast-forward only -- this never resolves a divergence.
  function pull(target, checkout) {
    if (target.busy || Date.now() - (lastPull.get(target.name) ?? 0) < PULL_EVERY_MS) return;
    lastPull.set(target.name, Date.now());
    if (git(checkout, "branch", "--show-current").stdout.trim() !== "main") return;
    if (git(checkout, "status", "--porcelain", "--untracked-files=no").stdout.trim() !== "") return;
    if (git(checkout, "fetch", "-q", "origin", "main").status !== 0) return;
    git(checkout, "merge", "--ff-only", "-q", "origin/main");
  }

  async function superviseOne(target, port) {
    const checkout = path.join(workspace, target.name);
    const command = `next dev -H localhost -p ${port}`;
    const report = (status, extra = {}) =>
      convex.mutation(api.bridge.localServerReport, {
        secret, projectId: target.projectId, status, port, url: `http://localhost:${port}`, command, checkout,
        ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined)),
      });

    if (!existsSync(path.join(checkout, "package.json"))) {
      return report("failed", { note: `no checkout at ${checkout}` });
    }
    pull(target, checkout);

    const inflight = installs.get(target.name);
    if (inflight) {
      if (inflight.exit === undefined) return report("installing", { head: head(checkout) });
      installs.delete(target.name);
      if (inflight.exit !== 0) {
        backoff.set(target.name, { until: Date.now() + 5 * 60_000, tries: 0 });
        return report("failed", { head: head(checkout), note: lastError(logTail(target.name)) ?? `npm ci exited ${inflight.exit}` });
      }
      log("local-install", "passed", `project=${target.name}`);
    }

    let state = readState(target.name);
    const running = state && alive(state.pid);
    // Dependencies changed under a running server (a merged PR added a package): reinstall and restart.
    const stale = !existsSync(path.join(checkout, "node_modules")) || (state && state.lockHash !== lockHash(checkout));
    if (stale && !target.busy) {
      if (running) stop(target.name);
      install(target, checkout);
      return report("installing", { head: head(checkout) });
    }
    if (stale && !running) {
      return report("stopped", { head: head(checkout), note: "waiting for the run in this checkout to finish before installing" });
    }

    if (running) {
      const ok = await answering(port);
      if (ok) backoff.delete(target.name);
      return report(ok ? "running" : "starting", { pid: state.pid, head: head(checkout), startedAt: state.startedAt });
    }

    // Not running. A server that keeps dying is reported, not restarted in a tight loop.
    const b = backoff.get(target.name);
    if (b && Date.now() < b.until) {
      return report("failed", { head: head(checkout), note: lastError(logTail(target.name)) ?? "exited; retrying shortly" });
    }
    if (state) {
      // It was ours and it died: back off 15s, 30s, 60s ... capped at 5 minutes.
      const tries = (b?.tries ?? 0) + 1;
      backoff.set(target.name, { until: Date.now() + Math.min(15_000 * 2 ** (tries - 1), 5 * 60_000), tries });
      log("local-exit", "failed", `project=${target.name} pid=${state.pid}`);
    }
    try {
      state = start(target, checkout, port);
    } catch (err) {
      backoff.set(target.name, { until: Date.now() + 5 * 60_000, tries: (b?.tries ?? 0) + 1 });
      return report("failed", { head: head(checkout), note: toNote(String(err.message ?? err)) });
    }
    return report("starting", { pid: state.pid, head: state.head, startedAt: state.startedAt });
  }

  /** One supervision pass: called from the bridge's tick. */
  return async function supervise() {
    const targets = await convex.query(api.bridge.localTargets, { secret });
    const wanted = MAX_SERVERS > 0 ? targets.slice(0, MAX_SERVERS) : targets;
    const wantedNames = new Set(wanted.map((t) => t.name));

    for (const t of targets) known.set(t.name, t);
    // Servers past the cap, or for projects that left the list, are stopped; only the former still
    // has a project to report to.
    for (const [name, t] of known) {
      if (wantedNames.has(name) || !readState(name)) continue;
      stop(name);
      log("local-stop", "passed", `project=${name}`);
      if (t.port !== null && targets.some((x) => x.name === name)) {
        await convex.mutation(api.bridge.localServerReport, {
          secret, projectId: t.projectId, status: "stopped", port: t.port, url: `http://localhost:${t.port}`,
          command: `next dev -H localhost -p ${t.port}`, checkout: path.join(workspace, name),
          note: `stopped: more than LOCAL_SERVERS_MAX=${MAX_SERVERS} projects`,
        });
      }
    }

    // A port stays with its project across restarts so the operator's link does not move.
    const taken = new Set(targets.map((t) => t.port ?? readState(t.name)?.port).filter((p) => p !== null && p !== undefined));
    for (const t of wanted) {
      try {
        const state = readState(t.name);
        let port = t.port ?? state?.port;
        // Keep the port unless something else has taken it while our server was down.
        if (port === null || port === undefined || (!(state && alive(state.pid)) && !(await portFree(port)))) {
          port = await pickPort(taken);
          taken.add(port);
        }
        await superviseOne(t, port);
      } catch (err) {
        log("local", "failed", `project=${t.name} error=${String(err.message ?? err).slice(0, 200)}`);
      }
    }
  };
}

// `node local-servers.mjs stop`: the shutdown half, for start-local.sh. Servers are detached so
// they survive a bridge restart; stopping the whole local runtime should still take them down.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv[2] === "stop") {
  const home = (process.env.MACHINIST_HOME ?? "~/.machinist").replace(/^~(?=\/)/, homedir());
  const names = stopAllLocalServers(home);
  console.log(`LOCAL step=stop outcome=passed servers=${names.length}${names.length ? ` projects=${names.join(",")}` : ""}`);
}
