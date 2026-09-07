# syntax=docker/dockerfile:1.7
# svcos-factory: the sandbox image every cloud run starts from (design §5.6).
# No credentials are baked in. Agents run as the unprivileged `machinist` user (design §12.2 #3).
# All versions come from build args; see versions.env and build.sh.

ARG NODE_VERSION
ARG DEBIAN_RELEASE
FROM node:${NODE_VERSION}-${DEBIAN_RELEASE}

ARG SVCOS_TEMPLATE_URL
ARG SVCOS_TEMPLATE_REF
ARG MACHINIST_VERSION
ARG CLAUDE_CODE_VERSION
ARG CODEX_VERSION
ARG VERCEL_CLI_VERSION
ARG CONVEX_CLI_VERSION
ARG PNPM_VERSION
ARG SEMGREP_VERSION
ARG DETECT_SECRETS_VERSION
ARG GH_CLI_VERSION
ARG DOPPLER_CLI_VERSION

ENV DEBIAN_FRONTEND=noninteractive \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

# System packages, GitHub CLI, Doppler CLI, Python tooling (Semgrep, detect-secrets).
RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl ca-certificates jq python3 python3-pip python3-venv gnupg \
 && curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_CLI_VERSION}/gh_${GH_CLI_VERSION}_linux_$(dpkg --print-architecture).deb" -o /tmp/gh.deb \
 && dpkg -i /tmp/gh.deb && rm /tmp/gh.deb \
 && curl -fsSL "https://github.com/DopplerHQ/cli/releases/download/${DOPPLER_CLI_VERSION}/doppler_${DOPPLER_CLI_VERSION}_linux_$(dpkg --print-architecture).deb" -o /tmp/doppler.deb \
 && dpkg -i /tmp/doppler.deb && rm /tmp/doppler.deb \
 && python3 -m venv /opt/sectools \
 && /opt/sectools/bin/pip install --no-cache-dir "semgrep==${SEMGREP_VERSION}" "detect-secrets==${DETECT_SECRETS_VERSION}" \
 && ln -s /opt/sectools/bin/semgrep /usr/local/bin/semgrep \
 && ln -s /opt/sectools/bin/detect-secrets /usr/local/bin/detect-secrets \
 && ln -s /opt/sectools/bin/detect-secrets-hook /usr/local/bin/detect-secrets-hook \
 && apt-get clean && rm -rf /var/lib/apt/lists/*

# Agent and provider CLIs.
RUN npm install -g --no-audit \
      "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
      "@openai/codex@${CODEX_VERSION}" \
      "vercel@${VERCEL_CLI_VERSION}" \
      "convex@${CONVEX_CLI_VERSION}" \
      "pnpm@${PNPM_VERSION}" \
 && npm cache clean --force

# Machinist worker binary at the pinned release (checksum verified by its installer).
RUN curl -fsSL "https://raw.githubusercontent.com/owainlewis/machinist/${MACHINIST_VERSION}/install.sh" \
      | MACHINIST_VERSION="${MACHINIST_VERSION}" sh

# Unprivileged runtime account; Claude Code refuses --dangerously-skip-permissions as root.
RUN useradd --create-home --shell /bin/bash machinist \
 && mkdir -p /home/machinist/Code/.worktrees /home/machinist/templates \
 && chown -R machinist:machinist /home/machinist
USER machinist
WORKDIR /home/machinist

# Pre-cloned SVCOS template with warmed node_modules so genesis and builds skip the cold install.
RUN git clone --depth 1 "${SVCOS_TEMPLATE_URL}" templates/secure-vibe-coding-OS \
 && cd templates/secure-vibe-coding-OS \
 && git fetch --depth 1 origin "${SVCOS_TEMPLATE_REF}" && git checkout --quiet FETCH_HEAD \
 && npm ci --no-audit --no-fund \
 && rm -rf .git

LABEL org.opencontainers.image.title="svcos-factory" \
      org.opencontainers.image.description="Agentic Secure Dark Factory sandbox image: SVCOS template, agent CLIs, provider CLIs, security scanners; no credentials" \
      org.opencontainers.image.source="https://github.com/harperaa/agentic-secure-dark-factory" \
      io.asdf.svcos.ref="${SVCOS_TEMPLATE_REF}" \
      io.asdf.machinist.version="${MACHINIST_VERSION}"

ENTRYPOINT ["/bin/bash", "-lc"]
CMD ["machinist version && claude --version && codex --version"]
