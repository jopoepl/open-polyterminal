#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

chmod +x scripts/secret-scan.sh scripts/install-git-hooks.sh .githooks/pre-commit .githooks/pre-push
git config core.hooksPath .githooks

echo "Git hooks installed. core.hooksPath -> .githooks"
echo "Hooks enabled: pre-commit (staged secret scan), pre-push (tracked + outgoing commit scan)"
