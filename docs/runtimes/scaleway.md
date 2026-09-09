# Scaleway runtime (optional, EU)

Scaleway Serverless Containers run the `svcos-factory` image per job through the plain
`docker run` path of `sandbox-exec --backend=scaleway` (the same code as `--backend=docker`).
French-hosted, Docker-based, no SDK-level sandbox primitives, so egress control comes from the
container network policy passed with `--network` and credentials are injected per run with
`-e` from the secrets adapter (Infisical in the EU profile). Used with the `eu` provider
profile (design §4.11) alongside Scaleway hosting and self-hosted Convex.

## Configuration

| Variable | Meaning |
|---|---|
| `SANDBOX_BACKEND` | `scaleway` (or `docker` for any plain Docker host) |
| `SANDBOX_SNAPSHOT` | image tag pushed to the Scaleway container registry |
| `SANDBOX_CONTAINER_WORKDIR` | working directory inside the container |
| `SANDBOX_WORKSPACE` | `none` (clone inside; default) or `mount` to bind-mount the worker's checkout |
| `SANDBOX_NETWORK` | value for `docker --network`, for example a user-defined network with an egress firewall |
| `SANDBOX_DOCKER_BIN` | docker client binary if not `docker` on `PATH` |
| `SANDBOX_CONTAINER_USER` | account inside the container; empty keeps the image's `machinist` |

## Lifecycle

`docker run -i --rm --name asdf-<run-id> [--network …] [-v host:container -w container] -e … --label io.asdf.run=<run-id> <image> <command…>`.
Stdin carries the prompt; stdout and stderr are piped through unchanged. On cancel the client
receives SIGTERM (proxied into the container) and `docker kill asdf-<run-id>` follows, so a
wedged client cannot leave a container running.

## Status

Implemented and unit-tested with a fake `docker` binary. An integration test runs against a
real daemon when `SANDBOX_EXEC_DOCKER_INTEGRATION=1` and `SANDBOX_EXEC_DOCKER_IMAGE` are set.
No Docker daemon was available where this was built, so the live path is unverified here.
