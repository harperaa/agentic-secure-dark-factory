# Bridge

The bridge is the only thing that talks to both control planes (design §5.0). It runs on the
worker machine beside Machinist and uses that machine's credentials; Convex never holds a shell
or a token.

Loop, every `BRIDGE_POLL_MS`:

1. `bridge.pollQueued` → submit each queued run to Machinist (`POST /api/v1/jobs`) and mark it submitted.
2. Execute queued effects with local tools: `gh` for labels and comments, `create-phase-issues.sh`, `register-repository.sh`. Report each result.
3. Reconcile tracked runs against Machinist `/api/v1/status`; on a terminal state read the run's events, parse the final `RESULT`/`*_RESULT` line, PR number, and head SHA, and call `bridge.complete`, which hands off to the state machine.

Run it from the factory checkout with the operator environment loaded:

```bash
set -a; source ~/.config/asdf/factory.env; set +a
node factory/bridge/bridge.mjs
```

`CONVEX_URL` and `FACTORY_BRIDGE_SECRET` must match the control plane's deployment; the same
secret is set on the deployment with `npx convex env set FACTORY_BRIDGE_SECRET`.
