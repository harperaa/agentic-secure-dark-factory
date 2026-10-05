#!/usr/bin/env bash
# doctor.sh is the first thing a fresh clone runs, so it is tested the way a fresh clone meets it:
# against fake CLIs, under the shell on the machine (macOS ships bash 3.2, where an empty array is
# an unbound variable under `set -u`). The candidates it reports and the file it writes are
# checked for the shapes `vercel teams ls` takes: an unmarked table, a current-scope marker, more
# than one team, and no login at all.

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
fresh_sandbox; sb="$SANDBOX"
doctor="$FACTORY_ROOT/factory/scripts/doctor.sh"

# run_doctor [--write PATH] — doctor exits 1 whenever a CLI is missing on the host, so the exit
# code is not the subject here; the report lines are.
run_doctor() { "$doctor" "$@" 2>&1 || true; }
candidates() { printf '%s\n' "$1" | sed -n 's/^DOCTOR candidates //p'; }

# --- one team, unmarked table ---------------------------------------------------------------
out=$(run_doctor)
assert_contains "$(candidates "$out")" "VERCEL_SCOPE=[fake-team]" "single team is the Vercel scope candidate"
assert_contains "$(candidates "$out")" "CONVEX_TEAM=[fake-team]" "Convex team slug is read from login status"
assert_contains "$(candidates "$out")" "github_owner=[fakeuser fake-org]" "GitHub owner candidates are the user and their orgs"
out=$(run_doctor --write "$sb/one.env")
assert_file "$sb/one.env" "--write creates the env file"
assert_contains "$(cat "$sb/one.env")" "VERCEL_SCOPE=fake-team" "a single candidate is filled in"
assert_contains "$(cat "$sb/one.env")" "CONVEX_TEAM=fake-team" "a single Convex team is filled in"
assert_contains "$out" "DOCTOR wrote=$sb/one.env VERCEL_SCOPE=fake-team CONVEX_TEAM=fake-team" "the write line reports what was chosen"

# --- the current-scope marker is not a slug -------------------------------------------------
out=$(FAKE_VERCEL_TEAMS=marked run_doctor)
assert_contains "$(candidates "$out")" "VERCEL_SCOPE=[fake-team]" "marker before the current team is stripped"
assert_not_contains "$(candidates "$out")" "VERCEL_SCOPE=[✔" "the marker never becomes a candidate"

# --- several teams: listed, and left for the operator to choose ----------------------------
out=$(FAKE_VERCEL_TEAMS=many run_doctor --write "$sb/many.env")
assert_contains "$(candidates "$out")" "VERCEL_SCOPE=[fake-team other-team]" "every team is a candidate"
assert_contains "$(grep '^VERCEL_SCOPE=' "$sb/many.env")" "VERCEL_SCOPE=" "several candidates leave the key blank"
assert_not_contains "$(cat "$sb/many.env")" "VERCEL_SCOPE=fake-team" "no team is chosen for the operator"
assert_contains "$out" "VERCEL_SCOPE=<choose>" "the write line says a choice is pending"

# --- not logged in anywhere that lists scopes: empty arrays must not abort ------------------
out=$(FAKE_VERCEL_LOGGED_OUT=1 run_doctor --write "$sb/none.env")
assert_contains "$out" "DOCTOR login=vercel outcome=missing" "a missing Vercel login is reported"
assert_contains "$(candidates "$out")" "VERCEL_SCOPE=[]" "no scopes is an empty list, not an error"
assert_not_contains "$out" "unbound variable" "empty arrays do not abort under set -u"
assert_file "$sb/none.env" "--write still completes without a Vercel login"
assert_contains "$(grep '^VERCEL_SCOPE=' "$sb/none.env")" "VERCEL_SCOPE=" "the scope is left blank to fill in"

test_summary doctor
