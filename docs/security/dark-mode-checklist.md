# Dark-mode checklist

Preconditions before a repository's `mode` moves from `gray` to `dark`. Every item is
checked by a person and recorded as a `decisions` row with a note; the control plane refuses
`dark` until the row exists.

## Repository

- [ ] Branch protection is applied and verified: required checks include `lint, test, security, build, semgrep, secrets, security-check`; `enforce_admins` is true; force pushes and deletions are blocked.
- [ ] The required-review decision (design §12.2 #1) is made and recorded: either a factory reviewer identity submits approvals, or the repository runs `lockdown-main.sh --solo` and relies on gates.
- [ ] `AGENTS.md`, `factory-security.yml`, `.secrets.baseline`, and `security_context/accepted.json` are present and factory-managed.
- [ ] `forced_gray_paths` in the spec cover authentication, authorization, payments, headers, middleware, API routes, security libraries, and dependency manifests.

## Gates

- [ ] `greptile_threshold` is 5 unless a documented reason lowers it.
- [ ] `max_repair_rounds` is set and has been hit at least once in gray mode so the NEEDS_HUMAN path is proven.
- [ ] The first FRESH assessment has run, its baseline is committed, and there are zero open `factory:security-finding` issues rated high or critical.
- [ ] Security CI has been green on at least ten consecutive PRs with no allow-list changes.

## Operations

- [ ] Spend alert thresholds are configured and have fired in a test.
- [ ] Alerts for `NEEDS_HUMAN`, `machinist:blocked`, and credential failures reach a person.
- [ ] Credential rotation has been exercised with `/rotate` and the worker recovered without manual edits.
- [ ] The operator has read `SECURITY.md` "What dark mode does not protect against" and accepts the residual risk for this repository.

## Exit

Dark mode is revoked automatically when: a forced-gray label is removed by anyone other than a
human decision; a required check is removed from protection; or an assessment finds a new
critical finding. Revocation is an `events` row and reopens the checklist.
