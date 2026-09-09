# Upstream proposals

The factory does not fork or patch Secure Vibe Coding OS or Machinist (design G7, §12.5).
Anything that only makes sense inside them is written up here and offered upstream. Until a
proposal lands, the factory works around it or degrades to NEEDS_HUMAN with a reason.

| Proposal | Target | Factory workaround today |
|---|---|---|
| [Argument blocks on interactive commands](svcos-arguments.md) ([SVCOS #5](https://github.com/harperaa/secure-vibe-coding-OS/issues/5)) | SVCOS | factory prompts call scripts and agents directly |
| [Optional modules: `auth-oidc`, `payments-mollie`, `payments-payone`](svcos-modules.md) ([SVCOS #10](https://github.com/harperaa/secure-vibe-coding-OS/issues/10)) | SVCOS | EU profile refuses identity/payments swaps |
| [Security CI additions in `ci.yml`](svcos-security-ci.md) ([SVCOS #8](https://github.com/harperaa/secure-vibe-coding-OS/issues/8); also #6, #7, #9) | SVCOS | `factory-security.yml` written into each product repo |
| [`Runtime` seam in the managed worker](machinist-runtime-seam.md) ([owainlewis/machinist#480](https://github.com/owainlewis/machinist/issues/480)) | Machinist | `sandbox-exec` wrapper executor |
