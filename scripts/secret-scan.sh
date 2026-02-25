#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

if ! command -v rg >/dev/null 2>&1; then
  echo "secret-scan: ripgrep (rg) is required." >&2
  exit 2
fi

PATTERNS=(
  "-----BEGIN (RSA|EC|OPENSSH|DSA|PRIVATE) KEY-----"
  "(POLYMARKET_|WALLET_|ETH_|EVM_)?PRIVATE_KEY[[:space:]]*[:=][[:space:]]*['\"]?(0x)?[A-Fa-f0-9]{64}"
  "mnemonic[[:space:]]*[:=][[:space:]]*['\"][A-Za-z]+( [A-Za-z]+){11,23}['\"]"
  "seed phrase[[:space:]]*[:=]"
  "sk-[A-Za-z0-9]{32,}"
  "ghp_[A-Za-z0-9]{30,}"
  "github_pat_[A-Za-z0-9_]{20,}"
  "AKIA[0-9A-Z]{16}"
  "AIza[A-Za-z0-9_-]{30,}"
  "xox[baprs]-[A-Za-z0-9-]{20,}"
  "sk_live_[A-Za-z0-9]{16,}"
  "Authorization:[[:space:]]*Bearer[[:space:]]+[A-Za-z0-9._=-]{20,}"
  "x-api-key[[:space:]]*:[[:space:]]*[A-Za-z0-9._-]{20,}"
)

run_rg_scan() {
  local target_label="$1"
  shift
  local -a targets=("$@")
  local -a args
  local pattern
  local out
  local code

  args=(
    --hidden
    --line-number
    --color=never
    --no-messages
    --glob
    "!.git/**"
    --glob
    "!node_modules/**"
    --glob
    "!.next/**"
    --glob
    "!dist/**"
  )

  for pattern in "${PATTERNS[@]}"; do
    args+=(-e "$pattern")
  done

  if [ "${#targets[@]}" -eq 0 ]; then
    echo "secret-scan: no ${target_label} to scan."
    return 0
  fi

  set +e
  out="$(rg "${args[@]}" -- "${targets[@]}" 2>&1)"
  code=$?
  set -e

  if [ "$code" -eq 0 ]; then
    echo "secret-scan: potential secrets found in ${target_label}:" >&2
    echo "$out" >&2
    return 1
  fi

  if [ "$code" -eq 1 ]; then
    echo "secret-scan: OK (${target_label})."
    return 0
  fi

  echo "secret-scan: scan failed (${target_label})." >&2
  echo "$out" >&2
  return "$code"
}

run_git_revision_scan() {
  local target_label="$1"
  shift
  local -a revs=("$@")
  local -a args
  local pattern
  local out
  local code

  if [ "${#revs[@]}" -eq 0 ]; then
    echo "secret-scan: no ${target_label} to scan."
    return 0
  fi

  args=(-nI -E)
  for pattern in "${PATTERNS[@]}"; do
    args+=(-e "$pattern")
  done

  set +e
  out="$(git grep "${args[@]}" "${revs[@]}" -- . 2>&1)"
  code=$?
  set -e

  if [ "$code" -eq 0 ]; then
    echo "secret-scan: potential secrets found in ${target_label}:" >&2
    echo "$out" >&2
    return 1
  fi

  if [ "$code" -eq 1 ]; then
    echo "secret-scan: OK (${target_label})."
    return 0
  fi

  echo "secret-scan: scan failed (${target_label})." >&2
  echo "$out" >&2
  return "$code"
}

mode="${1:---files}"
shift || true

case "$mode" in
  --staged)
    staged_files="$(git diff --cached --name-only --diff-filter=ACMR)"
    if [ -n "$staged_files" ]; then
      # shellcheck disable=SC2206
      files=($staged_files)
      run_rg_scan "staged files" "${files[@]}"
    else
      echo "secret-scan: no staged files to scan."
    fi
    ;;
  --files)
    tracked_files="$(git ls-files)"
    if [ -n "$tracked_files" ]; then
      files=()
      while IFS= read -r file; do
        [ -n "$file" ] || continue
        [ -e "$file" ] || continue
        files+=("$file")
      done <<< "$tracked_files"
      run_rg_scan "tracked files" "${files[@]}"
    else
      echo "secret-scan: no tracked files to scan."
    fi
    ;;
  --history)
    revisions="$(git rev-list --all)"
    if [ -n "$revisions" ]; then
      # shellcheck disable=SC2206
      revs=($revisions)
      run_git_revision_scan "git history" "${revs[@]}"
    else
      echo "secret-scan: no history to scan."
    fi
    ;;
  --commits)
    if [ "$#" -eq 0 ]; then
      echo "secret-scan: --commits requires at least one commit SHA." >&2
      exit 2
    fi
    run_git_revision_scan "outgoing commits" "$@"
    ;;
  *)
    echo "Usage: scripts/secret-scan.sh [--staged|--files|--history|--commits <sha...>]" >&2
    exit 2
    ;;
esac
