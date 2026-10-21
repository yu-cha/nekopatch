#!/usr/bin/env bash
# pre-commit と pre-push の両方で使うフック。devShell の shellHook が .git/hooks/ に設置する。
# global の core.hooksPath のフックから呼ばれる。stdin は global 側の pre-push が読むので、ここでは読まない。
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

if command -v just >/dev/null && command -v openspec >/dev/null; then
  just check </dev/null
else
  nix develop --command just check </dev/null
fi
