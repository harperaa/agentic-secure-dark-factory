#!/usr/bin/env bash
# llm/anthropic-bedrock-eu — Claude via AWS Bedrock in an EU region for the claude executor
# (design §4.11 llm row, data residency). EU profile default. Not verified against Bedrock here.
# Claude Code reads CLAUDE_CODE_USE_BEDROCK and the AWS credential chain from the environment.

llm_anthropic_bedrock_eu_capabilities() {
  jq -cn '{kind:"llm", name:"anthropic-bedrock-eu", implemented:true, verified:false,
    needs_env:["AWS_REGION"], optional_env:["AWS_PROFILE","AWS_ACCESS_KEY_ID","AWS_SECRET_ACCESS_KEY","ANTHROPIC_BEDROCK_MODEL"],
    needs_cmd:["claude"], supports:["env"], residency:"EU"}'
}

llm_anthropic_bedrock_eu_env() {
  case "$AWS_REGION" in
    eu-*) ;;
    *) die "llm/anthropic-bedrock-eu: AWS_REGION=$AWS_REGION is not an EU region" ;;
  esac
  printf 'CLAUDE_CODE_USE_BEDROCK=1\n'
  printf 'AWS_REGION=%s\n' "$AWS_REGION"
  [ -n "${AWS_PROFILE:-}" ] && printf 'AWS_PROFILE=%s\n' "$AWS_PROFILE"
  [ -n "${AWS_ACCESS_KEY_ID:-}" ] && printf 'AWS_ACCESS_KEY_ID=%s\n' "$AWS_ACCESS_KEY_ID"
  [ -n "${AWS_SECRET_ACCESS_KEY:-}" ] && printf 'AWS_SECRET_ACCESS_KEY=%s\n' "$AWS_SECRET_ACCESS_KEY"
  [ -n "${ANTHROPIC_BEDROCK_MODEL:-}" ] && printf 'ANTHROPIC_MODEL=%s\n' "$ANTHROPIC_BEDROCK_MODEL"
  return 0
}
