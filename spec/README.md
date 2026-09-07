# factory-spec

`factory-spec.schema.json` is the contract between whoever writes a product
spec (the Web UI, the Hermes plugin, or a human with an editor) and the factory.
The spec is the artifact; the conversational elicitation that SVCOS's
`/create-new-site` performs lives above this file, not in it.

- `phases` become GitHub issues, one per BUILD stage, so the unmodified
  Machinist foreman can run them.
- `forced_gray_paths` and `mode` drive the dark/gray policy in the control plane.
- `providers.profile` selects the adapter set; the control plane refuses a
  profile whose `capabilities()` are not satisfied and stops as NEEDS_HUMAN
  with the reason.
- Secrets are referenced, never embedded. `clerk.secret_key_ref` points into the
  secrets adapter.

Validate an example with:

```bash
factory/scripts/validate-spec.sh spec/examples/acme-analytics.json
```
