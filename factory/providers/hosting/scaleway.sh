#!/usr/bin/env bash
# hosting/scaleway — Scaleway Serverless Containers via the `scw` CLI and Docker (design §4.11,
# EU profile). Real implementation, NOT verified against Scaleway here; capabilities say so.
#
# Shape: the product is built as a Next.js standalone image, pushed to the namespace's Container
# Registry, and deployed as one container. Secrets come from the secrets adapter's export_env.
# Artifacts mirror the Vercel adapter's: .scaleway/container.json marks a linked product and
# the DEPLOYMENT-DEV.md summary is written by SVCOS's write-summary exactly as for Vercel.

hosting_scaleway_capabilities() {
  jq -cn '{kind:"hosting", name:"scaleway", implemented:true, verified:false,
    needs_env:["SCW_REGION","SCW_CONTAINER_NAMESPACE_ID","SCW_REGISTRY_ENDPOINT"], optional_env:["SCW_CONTAINER_CPU_LIMIT","SCW_CONTAINER_MEMORY_LIMIT"],
    needs_cmd:["scw","docker"], supports:["link","is_linked","write_config","set_env","deploy"], residency:"EU"}'
}

hosting_scaleway_step_name() {
  case "$1" in
    link) printf scaleway-link ;;
    config) printf scaleway-config ;;
    set_env) printf scaleway-env ;;
    deploy) printf scaleway-deploy ;;
    *) printf 'scaleway-%s' "$1" ;;
  esac
}

hosting_scaleway_is_linked() { [ -f .scaleway/container.json ]; }

# hosting_scaleway_link NAME — create (or find) the container in the namespace; record its id.
hosting_scaleway_link() {
  local name="$1" id
  id=$(scw container container list namespace-id="$SCW_CONTAINER_NAMESPACE_ID" region="$SCW_REGION" -o json \
    | jq -r --arg n "$name" '.[] | select(.name==$n) | .id' | head -n 1)
  if [ -z "$id" ]; then
    id=$(scw container container create namespace-id="$SCW_CONTAINER_NAMESPACE_ID" name="$name" region="$SCW_REGION" \
      registry-image="$SCW_REGISTRY_ENDPOINT/$name:latest" port=3000 \
      ${SCW_CONTAINER_CPU_LIMIT:+cpu-limit="$SCW_CONTAINER_CPU_LIMIT"} \
      ${SCW_CONTAINER_MEMORY_LIMIT:+memory-limit="$SCW_CONTAINER_MEMORY_LIMIT"} -o json | jq -r .id)
  fi
  [ -n "$id" ] || die "hosting/scaleway: could not create container $name"
  mkdir -p .scaleway
  jq -n --arg id "$id" --arg n "$name" --arg r "$SCW_REGION" --arg ns "$SCW_CONTAINER_NAMESPACE_ID" \
    '{container_id:$id, name:$n, region:$r, namespace_id:$ns}' > .scaleway/container.json
}

# hosting_scaleway_write_config MODE — a Dockerfile for the Next.js standalone build. In Doppler
# mode the image runs SVCOS's prebuild so the build fetches secrets; in env mode the container's
# environment carries them. Never rewrites a Dockerfile the product already owns.
hosting_scaleway_write_config() {
  local mode="$1"
  if [ -f Dockerfile ] && ! grep -q 'factory-managed' Dockerfile; then
    return 0
  fi
  {
    printf '# factory-managed: written by Agentic Secure Dark Factory (hosting/scaleway). Edit upstream, not here.\n'
    printf 'FROM node:24-bookworm AS build\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --no-audit --no-fund\nCOPY . .\n'
    if [ "$mode" = "doppler" ]; then
      printf 'ARG DOPPLER_TOKEN\nENV DOPPLER_TOKEN=$DOPPLER_TOKEN\nRUN node scripts/vercel-prebuild.mjs && npm run build\n'
    else
      printf 'RUN npm run build\n'
    fi
    printf 'FROM node:24-bookworm-slim\nWORKDIR /app\nENV NODE_ENV=production PORT=3000\n'
    printf 'COPY --from=build /app/.next/standalone ./\nCOPY --from=build /app/.next/static ./.next/static\nCOPY --from=build /app/public ./public\n'
    printf 'EXPOSE 3000\nCMD ["node","server.js"]\n'
  } > Dockerfile
}

# hosting_scaleway_set_env ENV — push the secrets adapter's dotenv export as container env vars.
hosting_scaleway_set_env() {
  local id args=() line key value
  id=$(jq -r .container_id .scaleway/container.json)
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    key="${line%%=*}"; value="${line#*=}"
    value="${value%\"}"; value="${value#\"}"
    args+=("environment-variables.$key=$value")
  done < <(secrets_export_env "$1")
  scw container container update "$id" region="$SCW_REGION" "${args[@]}" -o json >/dev/null
}

# hosting_scaleway_deploy — build, push, deploy; leave {url, dashboardUrl} in SVCOS_JSON like the
# Vercel adapter does, and print it for the run record.
hosting_scaleway_deploy() {
  local id name image url
  id=$(jq -r .container_id .scaleway/container.json)
  name=$(jq -r .name .scaleway/container.json)
  image="$SCW_REGISTRY_ENDPOINT/$name:latest"
  docker build -t "$image" ${DOPPLER_TOKEN:+--build-arg DOPPLER_TOKEN="$DOPPLER_TOKEN"} . >&2
  docker push "$image" >&2
  scw container container deploy "$id" region="$SCW_REGION" -o json >/dev/null
  url=$(scw container container get "$id" region="$SCW_REGION" -o json | jq -r '.domain_name // empty')
  [ -n "$url" ] || die "hosting/scaleway: container has no domain name yet"
  SVCOS_JSON=$(jq -cn --arg u "https://$url" --arg d "https://console.scaleway.com/serverless/containers/$SCW_REGION/$SCW_CONTAINER_NAMESPACE_ID" \
    '{success:true, url:$u, dashboardUrl:$d}')
  printf '%s\n' "$SVCOS_JSON"
}
