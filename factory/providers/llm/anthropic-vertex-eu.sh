#!/usr/bin/env bash
# llm/anthropic-vertex-eu — Claude via Google Vertex AI in a European region for the claude
# executor (design §4.11 llm row). Not verified against Vertex here. Claude Code reads
# CLAUDE_CODE_USE_VERTEX, CLOUD_ML_REGION, and ANTHROPIC_VERTEX_PROJECT_ID from the environment.

llm_anthropic_vertex_eu_capabilities() {
  jq -cn '{kind:"llm", name:"anthropic-vertex-eu", implemented:true, verified:false,
    needs_env:["ANTHROPIC_VERTEX_PROJECT_ID","CLOUD_ML_REGION"], optional_env:["GOOGLE_APPLICATION_CREDENTIALS"],
    needs_cmd:["claude"], supports:["env"], residency:"EU"}'
}

llm_anthropic_vertex_eu_env() {
  case "$CLOUD_ML_REGION" in
    europe-*) ;;
    *) die "llm/anthropic-vertex-eu: CLOUD_ML_REGION=$CLOUD_ML_REGION is not a European region" ;;
  esac
  printf 'CLAUDE_CODE_USE_VERTEX=1\n'
  printf 'CLOUD_ML_REGION=%s\n' "$CLOUD_ML_REGION"
  printf 'ANTHROPIC_VERTEX_PROJECT_ID=%s\n' "$ANTHROPIC_VERTEX_PROJECT_ID"
  [ -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" ] && printf 'GOOGLE_APPLICATION_CREDENTIALS=%s\n' "$GOOGLE_APPLICATION_CREDENTIALS"
  return 0
}
