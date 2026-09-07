# Agentic Secure Dark Factory — developer tasks.
# Every target is also what CI runs; keep them in sync with .github/workflows/security.yml.

SHELL := /usr/bin/env bash
.SHELLFLAGS := -eu -o pipefail -c

GO_DIR := sandbox-exec
CP_DIR := control-plane
SCRIPTS := $(shell find factory/scripts snapshots -type f -name '*.sh')

.PHONY: all check build test lint guard spec typecheck install-machinist-config snapshot clean

all: check build

check: lint guard spec test typecheck

build:
	cd $(GO_DIR) && go build -o bin/sandbox-exec ./cmd/sandbox-exec

test:
	cd $(GO_DIR) && go test ./...

lint:
	cd $(GO_DIR) && go vet ./...
	@if command -v shellcheck >/dev/null; then shellcheck -x $(SCRIPTS); else echo "shellcheck not installed; skipped"; fi

guard:
	factory/scripts/check-no-askuserquestion.sh

spec:
	factory/scripts/validate-spec.sh spec/examples/*.json

typecheck:
	cd $(CP_DIR) && npm ci --no-audit --no-fund && npx tsc --noEmit

install-machinist-config:
	factory/scripts/install-machinist-config.sh

snapshot:
	snapshots/build.sh

clean:
	rm -rf $(GO_DIR)/bin $(CP_DIR)/node_modules
