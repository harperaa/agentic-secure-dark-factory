# Local runtime (default)

The author's Machinist VM shape on the operator's own machine or VM (design §5.0).

## Layout

| Component | Where |
|---|---|
| Machinist control plane | `127.0.0.1:7331`, SQLite under `$MACHINIST_HOME/server` |
| Machinist worker | same machine, unprivileged `machinist` account, executors `claude`, `codex`, `genesis-script`, `deploy-dev-script` |
| Product checkouts | `$FACTORY_WORKSPACE/<name>` (registered in `worker.toml`) |
| Worktrees | `~/Code/.worktrees/<repo>/<task>` (foreman's own convention, restated in `AGENTS.md`) |
| Bridge | a small poller on the same machine that reads queued `runs` from Convex and calls `submit-job.sh` (M3) |
| Credentials | on the machine, under the `machinist` account, exactly as in Machinist's VM guide; product secrets from the secrets adapter |

## Install

1. Install the pinned Machinist release (`MACHINIST_VERSION` in `factory.env`) with its checksum-verified installer, for example `MACHINIST_VERSION=v0.4.0 MACHINIST_INSTALL_DIR=~/.local/bin sh install.sh`. On a shared VM follow Machinist's `docs/vm-deployment.md` and run everything as the `machinist` user. Authenticate `gh`, `claude`, `codex`, `vercel`, `convex`, and `doppler` in that account.
2. Copy `factory/config/factory.env.example` to a private path (for example `~/.config/asdf/factory.env`, mode 600) and fill it in. `VERCEL_SCOPE` is required by genesis; `CONVEX_TEAM` only when the account has several teams.
3. Export it and render the Machinist configuration:

   ```bash
   set -a; source ~/.config/asdf/factory.env; set +a
   factory/scripts/install-machinist-config.sh
   ```

   This writes `config.toml`, `worker.toml`, the prompts, and the worker token into `$MACHINIST_HOME`, and turns `$FACTORY_WORKSPACE` into a content-free Git repository. Machinist refuses to run a command outside a Git worktree, so the workspace genesis runs in must be one; products are cloned beneath it and ignored by its `.gitignore`.
4. Register any existing product checkout: `factory/scripts/register-repository.sh <name> </absolute/path>`.
5. Start both processes with the environment loaded. Script executors such as genesis read `FACTORY_*`, `VERCEL_SCOPE`, and the lockdown settings from the worker's environment, so the worker must be started from a shell that sourced `factory.env`:

   ```bash
   factory/scripts/start-local.sh ~/.config/asdf/factory.env
   ```

   `machinist worker validate --config ~/.machinist/worker.toml` checks the rendered worker file without starting anything.

## Smoke test without model spend

Submit a genesis job with an incomplete spec. The script executor path runs end to end and the run fails fast with the headless contract's error:

```bash
factory/scripts/submit-job.sh --command=genesis --repository=factory-workspace --prompt='{"name":"smoke-test"}'
curl -fsS http://127.0.0.1:7331/api/v1/status | jq '.jobs[0].runs[0]'
```

The run's `events.jsonl` under `$MACHINIST_HOME/worker/runs/<run>/<lease>/` carries the `MISSING_ENV` or `MISSING_ARG` line on stderr and exit code 2.

## Run genesis

`VERCEL_SCOPE`, `CONVEX_TEAM` (if needed), and a Doppler login must be present in the worker's environment. Codex is optional; when it is not installed, point the `shepherd` command at the `claude` executor in `config.toml.tmpl`.

```bash
factory/scripts/submit-job.sh --command=genesis --repository=factory-workspace \
  --prompt-file=spec/examples/acme-analytics.json
```

`genesis.sh` reads the spec from stdin, is idempotent, prints one `GENESIS step=… outcome=…`
line per step, and ends with `RESULT status=ready repo=… url=…`.

## Housekeeping

- Prune worktrees for merged or closed PRs on a schedule: `git worktree prune` in each product checkout.
- Rotate credentials with SVCOS `/rotate`; the worker needs no config change.
- Concurrency is bounded by `MACHINIST_MAX_CONCURRENT_JOBS` and the machine.

## What local does not give you

Ephemeral credentials, per-run isolation between projects, and an egress proxy. Choose a cloud
backend for a project (`providers.sandbox`) when those matter; the same executor definitions
work because `sandbox-exec --backend=local` is a passthrough.
