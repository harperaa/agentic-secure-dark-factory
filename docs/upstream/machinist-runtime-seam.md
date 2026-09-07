# Proposal: a `Runtime` seam in Machinist's managed worker

`internal/managedworker/worker.go::execute()` resolves the repository and command, then calls
`runner.Execute(ctx, runner.Options{...})`. Everything above is transport and lease; everything
below is "start one process in one directory".

```go
type Runtime interface {
    Execute(ctx context.Context, options runner.Options) (runner.Result, error)
}
```

With that one interface, a worker could run the process in an ephemeral sandbox (Daytona,
Cloudflare, a container) while the control plane, UI, triggers, prompts, leases, heartbeats,
timeouts, and token accounting stay exactly as they are. This is pluggable process location,
not pluggable orchestration; it does not reintroduce pipelines.

**Evidence.** The factory's `sandbox-exec` wrapper executor (Tier 0) does this today from
outside Machinist with zero changes, which shows the seam is real and the behaviour is
bounded: heartbeat ↔ sandbox alive; timeout or cancel ↔ delete sandbox; exit code ↔ inner
process exit code.

**If it lands:** `sandbox-exec` becomes redundant. **If it does not:** nothing in the factory
changes (design R8).
