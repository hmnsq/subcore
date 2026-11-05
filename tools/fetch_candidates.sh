#!/usr/bin/env bash
# © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
# SPDX-License-Identifier: GPL-3.0-or-later
# Fetches the candidate libraries that the BURP probe reads but this repository does not vendor (they belong to
# hmnsq/mechsim and hmnsq/anasim), into .cache/, pinned by version and checked by integrity or commit.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .cache/npm && cd .cache/npm
pin() {  # name@version integrity
  local spec=$1 want=$2
  local got
  got=$(npm pack "$spec" --json | python3 -c 'import json,sys; d=json.load(sys.stdin)[0]; print(d["filename"], d["integrity"])')
  set -- $got
  if [ "$2" != "$want" ]; then echo "integrity mismatch for $spec: $2" >&2; exit 1; fi
  rm -rf "x_${1%.tgz}"; mkdir -p "x_${1%.tgz}"; tar -xzf "$1" -C "x_${1%.tgz}"
  echo "fetched $spec ($1)"
}
pin uplot@1.6.32 sha512-KIMVnG68zvu5XXUbC4LQEPnhwOxBuLyW1AHtpm6IKTXImkbLgkMy+jabjLgSLMasNuGGzQm/ep3tOkyTxpiQIw==
pin three@0.187.0 sha512-Qiu7R+Cmh8CstZsY1uJOSWnVlfo7ZtNLV7mF8Jltk3LB3AtDu9cRZlcnRKkAk8Y4z6KKw35z7Y7Urd7jWY8etA==
pin @jscad/modeling@2.13.0 sha512-Thv/JJZZOMzQ9rfhP+75PbgrNbBTZduRL+ClaGfGFts9+JdIXcUueqRL3NtZZ/v/hyZCUBkPSRxHIi4icz04tQ==
pin planck@1.5.1 sha512-x3nHPSyoNTAxN0v8UXrSwP0XVTG0e7JCENBVZljZ8PZOjbOo7aRHq2+fy+DOREDhfW52aq5GiwgIm+m8kIErKQ==
pin quantum-circuit@0.9.251 sha512-Sf/jS7KShzJjkrpHzBlF+VPEasn8aO08swz03gRdc9BpKKBjGkh/pOy3hZdcuCeDZSLo2x0X6AwAO8b6kpkMOQ==
cd ..
want=8833791294e642795c8717038e84940a74b19a64
if [ ! -d quirk/.git ] || [ "$(git -C quirk rev-parse HEAD)" != "$want" ]; then
  rm -rf quirk
  git init -q quirk && git -C quirk fetch -q --depth 1 https://github.com/Strilanc/Quirk "$want" && git -C quirk checkout -q FETCH_HEAD
fi
echo "fetched Quirk at $(git -C quirk rev-parse HEAD), tree $(git -C quirk rev-parse HEAD^{tree})"
