#!/usr/bin/env bash
# payments/none — the product has no payments. Always satisfiable.

payments_none_capabilities() {
  jq -cn '{kind:"payments", name:"none", implemented:true, verified:true, needs_env:[], needs_cmd:[], supports:[]}'
}
