# Daytona runtime (optional, M2)

Ephemeral sandbox per run created from the `svcos-factory` snapshot; the local worker stays
the Machinist worker and `sandbox-exec --backend=daytona` moves the process (design §5.2, §5.5).

- **Credential model:** per-run env injection from the secrets adapter; the Daytona API key stays on the worker and never enters the sandbox.
- **Egress:** `networkBlockAll` with the allowlist from design §8.2; denied attempts are pulled from the sandbox log into the run record.
- **Persistence:** none by default. An optional per-project volume may hold `node_modules` and the DeepSec cache, never worktrees.
- **Region:** choose the EU region for `eu` profile projects.
- **Sizing:** triage on the smallest class; builds 2 vCPU / 8 GiB; assessment 4 vCPU / 8 GiB (design R5 benchmark pending).
- **Lifecycle:** `sandbox-exec` creates on start, streams stdout, destroys on exit or on SIGTERM from Machinist's timeout or cancel.
