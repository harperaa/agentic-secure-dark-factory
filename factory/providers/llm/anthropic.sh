#!/usr/bin/env bash
# llm/anthropic — Anthropic API or a Claude login for the claude executor. Default profile.
# Verified 2026-09-07 (claude.ai login on the local worker). An LLM adapter contributes env lines
# for executors (design §4.11 llm row); genesis itself never calls a model.

llm_anthropic_capabilities() {
  jq -cn '{kind:"llm", name:"anthropic", implemented:true, verified:true,
    needs_env:[], optional_env:["ANTHROPIC_API_KEY","CLAUDE_CODE_OAUTH_TOKEN"], needs_cmd:["claude"],
    supports:["env"], residency:"US"}'
}

# llm_anthropic_env — KEY=VALUE lines to inject into an executor's environment.
llm_anthropic_env() {
  [ -n "${ANTHROPIC_API_KEY:-}" ] && printf 'ANTHROPIC_API_KEY=%s\n' "$ANTHROPIC_API_KEY"
  [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] && printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' "$CLAUDE_CODE_OAUTH_TOKEN"
  return 0
}
