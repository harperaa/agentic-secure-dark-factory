#!/usr/bin/env bash
# llm/mistral — Mistral's OpenAI-compatible endpoint for Codex-compatible roles (design §4.11
# llm row, EU residency). Not verified here. Codex reads OPENAI_BASE_URL and OPENAI_API_KEY.

llm_mistral_capabilities() {
  jq -cn '{kind:"llm", name:"mistral", implemented:true, verified:false,
    needs_env:["MISTRAL_API_KEY","MISTRAL_BASE_URL"], needs_cmd:["codex"], supports:["env"], residency:"EU"}'
}

llm_mistral_env() {
  printf 'OPENAI_API_KEY=%s\n' "$MISTRAL_API_KEY"
  printf 'OPENAI_BASE_URL=%s\n' "$MISTRAL_BASE_URL"
}
