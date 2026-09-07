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

1. Follow Machinist's `docs/vm-deployment.md` (or run the control plane and worker under `launchd` on a Mac) as the `machinist` user. Authenticate `gh`, `claude`, `codex`, `vercel`, `convex`, and `doppler` there.
2. Fill in `factory/config/factory.env.example` and export it.
3. `make install-machinist-config` renders `config.toml`, `worker.toml`, and prompts into `$MACHINIST_HOME`.
4. Start the services. The worker advertises `factory-workspace` and every repository registered with `register-repository.sh`.

## Run genesis

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
