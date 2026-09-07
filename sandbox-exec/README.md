# sandbox-exec

Machinist "Tier 0" wrapper executor (design §5.2). It reads the rendered prompt on stdin,
runs the inner agent command somewhere, pumps the agent's stdout back unchanged so
Machinist's `stream-json` token accounting keeps working, forwards SIGTERM and SIGINT so a
Machinist timeout or cancel tears the run down, and exits with the inner command's exit code.

```
sandbox-exec --backend=<local|daytona|cloudflare|scaleway> [--snapshot=<name>] [--env=KEY=VALUE ...] -- <command> [args...]
```

| Backend | Status | Where the process runs |
|---|---|---|
| `local` | implemented | this machine, current working directory (Machinist's repository path) |
| `daytona` | planned (M2) | ephemeral Daytona sandbox created from `--snapshot` |
| `cloudflare` | planned | Cloudflare Sandbox via a Worker; credentials injected at the egress proxy |
| `scaleway` | planned | Scaleway Serverless Container via plain `docker run` |

Because `local` is a passthrough, the same executor definition in `worker.toml` works on
every runtime; the backend is a configuration value. Machinist itself is unchanged.
