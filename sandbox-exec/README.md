# sandbox-exec

Machinist "Tier 0" wrapper executor (design §5.2). It reads the rendered prompt on stdin,
runs the inner agent command somewhere, pumps the agent's stdout back unchanged so
Machinist's `stream-json` token accounting keeps working, forwards SIGTERM and SIGINT so a
Machinist timeout or cancel tears the run down, and exits with the inner command's exit code.

```
sandbox-exec --backend=<name> [--snapshot=<image>] [--container-workdir=<path>]
             [--workspace=none|mount] [--network=<policy>] [--run-id=<id>] [--env=KEY=VALUE ...]
             -- <command> [args...]
```

Every flag falls back to an environment variable so one `worker.toml` executor line works on
every runtime and the choice is configuration (design §5.2):

| Flag | Environment fallback | Meaning |
|---|---|---|
| `--backend` | `SANDBOX_BACKEND` | `local`, `docker`, `scaleway`, `daytona`, `cloudflare` |
| `--snapshot` | `SANDBOX_SNAPSHOT` | image or snapshot name; ignored by `local` |
| `--container-workdir` | `SANDBOX_CONTAINER_WORKDIR` | working directory inside the sandbox |
| `--workspace` | `SANDBOX_WORKSPACE` | `none` (default): the inner command clones inside; `mount`: bind-mount the host workdir (docker only) |
| `--network` | `SANDBOX_NETWORK` | docker `--network` value, or the Daytona network allow list (CIDRs) |
| `--run-id` | `MACHINIST_RUN_ID` | label on the container or sandbox for tracing |

## Backends

| Backend | Status | Where the process runs | Credentials it reads |
|---|---|---|---|
| `local` | implemented, tested | this machine, current working directory | none |
| `docker` / `scaleway` | implemented; unit-tested with a fake `docker`, integration test behind `SANDBOX_EXEC_DOCKER_INTEGRATION=1` | `docker run -i --rm <snapshot> <command>`; SIGTERM proxied by the client and a `docker kill` follows on cancel | `SANDBOX_DOCKER_BIN` (default `docker`), `SANDBOX_CONTAINER_USER` |
| `daytona` | implemented against the documented REST API; unit-tested against an httptest fake, not yet run against the live service | an ephemeral sandbox created from the snapshot and destroyed on exit or cancel | `DAYTONA_API_KEY`, `DAYTONA_API_URL`, `DAYTONA_TARGET` |
| `cloudflare` | stub | a Worker-hosted Durable Object (design §5.4); not reachable from this binary | — |

### docker / scaleway

The container name is `asdf-<run-id>`, per-run env goes in with `-e`, and `--label io.asdf.run=<run-id>`
marks it. `--workspace=mount` bind-mounts the host working directory at `--container-workdir`;
`none` leaves the container's own filesystem in place and the inner command clones what it
needs, which is what genesis and every worktree-based run do. Scaleway Serverless Containers
exposes plain Docker semantics, so the `scaleway` name selects the same backend.

### daytona

Endpoints coded against (Daytona REST API as documented in 2026-09, base URL from
`DAYTONA_API_URL`, bearer auth from `DAYTONA_API_KEY`):

```
POST   /sandbox                                                       create from snapshot (env, labels, target, network allow list)
GET    /sandbox/{id}                                                  poll until started
DELETE /sandbox/{id}?force=true                                       destroy (always, including on cancel)
POST   /toolbox/{id}/toolbox/files/upload?path=...                    upload the prompt as a file
POST   /toolbox/{id}/toolbox/process/session                          open a shell session
POST   /toolbox/{id}/toolbox/process/session/{sid}/exec               run the command asynchronously
GET    /toolbox/{id}/toolbox/process/session/{sid}/command/{cid}      exit code
GET    /toolbox/{id}/toolbox/process/session/{sid}/command/{cid}/logs  output, polled and streamed as a growing suffix
```

The inner command is quoted argument by argument and run as
`cd <container-workdir> && <command> < <prompt file>`, so the agent sees the prompt on stdin
exactly as Machinist wrote it. `--workspace=mount` is rejected; the sandbox has no host
filesystem. `--network` becomes `networkBlockAll: true` plus `networkAllowList`.

The live API has not been exercised from this repository. If an endpoint shape differs, the
error surfaces as `daytona: <step>: HTTP <code>: <body>` and the sandbox is still destroyed.

## Exit codes

The inner command's exit code is returned unchanged. `2` means sandbox-exec itself could not
run (missing argument, unknown backend, missing credential, backend not implemented). A run
cancelled by Machinist returns `143` (128 + SIGTERM).
