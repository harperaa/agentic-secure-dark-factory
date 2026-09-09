# Daytona runtime (optional, M2)

Ephemeral sandbox per run created from the `svcos-factory` snapshot; the local worker stays
the Machinist worker and `sandbox-exec --backend=daytona` moves the process (design §5.2, §5.5).

## Configuration

Set in the worker's environment (see `factory/config/factory.env.example`):

| Variable | Meaning |
|---|---|
| `DAYTONA_API_KEY` | API key; stays on the worker, never enters the sandbox |
| `DAYTONA_API_URL` | API base URL |
| `DAYTONA_TARGET` | region; use the EU target for `eu` profile projects |
| `SANDBOX_SNAPSHOT` | snapshot name the sandbox is created from |
| `SANDBOX_CONTAINER_WORKDIR` | directory inside the sandbox the command starts in (the snapshot's `machinist` home) |
| `SANDBOX_NETWORK` | comma-separated CIDR allow list; sets `networkBlockAll` with that list (design §8.2) |

Then select the `claude-sandbox` or `codex-sandbox` executor in `worker.toml` with
`SANDBOX_BACKEND=daytona`.

## Lifecycle

`sandbox-exec` creates the sandbox with the run's env and an `io.asdf.run` label, waits for
`started`, uploads the prompt as a file, opens a shell session, runs the executor command
asynchronously with the prompt on stdin, streams the command log as it grows, reads the exit
code, and destroys the sandbox. Cancellation from Machinist (timeout, cancel) destroys the
sandbox too; the destroy call runs on its own context so it completes even after the run's
context is gone.

- **Credential model:** per-run env injection from the secrets adapter; the API key never
  enters the sandbox.
- **Persistence:** none by default. An optional per-project volume may hold `node_modules`
  and the DeepSec cache, never worktrees; every run re-creates its worktree from the remote.
- **Sizing:** triage on the smallest class; builds 2 vCPU / 8 GiB; assessment 4 vCPU / 8 GiB
  (design R5 benchmark pending).

## Status

Implemented against Daytona's documented REST API (endpoints listed in `sandbox-exec/README.md`)
and unit-tested against a fake server. Not yet run against the live service from this
repository; the first live run is the M2 acceptance test.
