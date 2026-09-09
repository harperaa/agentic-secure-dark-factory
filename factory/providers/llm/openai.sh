#!/usr/bin/env bash
# llm/openai — OpenAI API for the codex executor. Default profile option. Not verified here
# (Codex is not installed on the reference worker).

llm_openai_capabilities() {
  jq -cn '{kind:"llm", name:"openai", implemented:true, verified:false,
    needs_env:["OPENAI_API_KEY"], needs_cmd:["codex"], supports:["env"], residency:"US"}'
}

llm_openai_env() {
  printf 'OPENAI_API_KEY=%s\n' "$OPENAI_API_KEY"
  [ -n "${OPENAI_BASE_URL:-}" ] && printf 'OPENAI_BASE_URL=%s\n' "$OPENAI_BASE_URL"
  return 0
}
