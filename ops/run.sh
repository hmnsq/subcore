#!/usr/bin/env bash
# © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
# SPDX-License-Identifier: GPL-3.0-or-later
#
#   ops/run.sh --iteration S1 [--native] [--only P9.4]
#
# Runs the steps of ops/iterations/<iteration>.steps. By default each step runs inside its container
# (substrate-node or substrate-ref), which is built once when its image is missing and then kept (PRF-05).
# --native runs every step on this machine instead. Every step writes a run record (tools/record.mjs) and its
# log under records/. A failing step does not stop the others; the exit code is the number of failed steps
# (capped at 100). RESUME.md is regenerated at the end (tools/resume.mjs).
# A machine behind a proxy sets SUBCORE_BUILD_HOOK=containers/hooks/proxy.sh; nothing else changes.
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
iteration="" native=0 only=""
while [ $# -gt 0 ]; do
  case "$1" in
    --iteration) iteration=$2; shift 2 ;;
    --native) native=1; shift ;;
    --only) only=$2; shift 2 ;;
    *) echo "run.sh: unknown argument $1" >&2; exit 2 ;;
  esac
done
[ -n "$iteration" ] || { echo "usage: ops/run.sh --iteration <N> [--native] [--only <packet>]" >&2; exit 2; }
steps="ops/iterations/${iteration}.steps"
[ -f "$steps" ] || { echo "run.sh: no step file $steps" >&2; exit 2; }
VERSION=$(cat VERSION)
declare -A IMAGE=([node]="hmnsq/subcore-substrate-node:$VERSION" [ref]="hmnsq/subcore-substrate-ref:$VERSION")
declare -A DOCKERFILE=([node]=containers/Dockerfile.substrate-node [ref]=containers/Dockerfile.substrate-ref)
DOCKER_BUILD_EXTRA=() DOCKER_RUN_EXTRA=()
if [ -n "${SUBCORE_BUILD_HOOK:-}" ]; then
  # shellcheck disable=SC1090
  source "$SUBCORE_BUILD_HOOK"
fi

ensure_image() {  # build once and keep
  local c=$1
  if docker image inspect "${IMAGE[$c]}" >/dev/null 2>&1; then return 0; fi
  echo "[run] building ${IMAGE[$c]} from ${DOCKERFILE[$c]} (once; the image is kept)"
  mkdir -p .cache/logs
  local t0=$SECONDS
  DOCKER_BUILDKIT=1 docker build -f "${DOCKERFILE[$c]}" -t "${IMAGE[$c]}" "${DOCKER_BUILD_EXTRA[@]}" containers \
    > ".cache/logs/build_${c}.log" 2>&1 || { echo "[run] build of ${IMAGE[$c]} failed; see .cache/logs/build_${c}.log"; tail -20 ".cache/logs/build_${c}.log"; return 1; }
  echo "[run] built ${IMAGE[$c]} in $((SECONDS - t0)) s"
}

failed=0 total=0
while IFS= read -r line; do
  case "$line" in ''|'#'*) continue ;; esac
  packet=$(echo "$line" | awk '{print $1}'); step=$(echo "$line" | awk '{print $2}'); cont=$(echo "$line" | awk '{print $3}')
  cmd=${line#* -- }
  if [ -n "$only" ] && [ "$packet" != "$only" ]; then continue; fi
  total=$((total + 1))
  echo "[run] $packet $step ($([ $native = 1 ] && echo native || echo "container $cont")): $cmd"
  if [ $native = 1 ]; then
    # shellcheck disable=SC2086
    bash -c "node tools/record.mjs --packet $packet --step $step -- $cmd" || failed=$((failed + 1))
  else
    if ! ensure_image "$cont"; then
      node tools/record.mjs --packet "$packet" --step "$step" --state not_built --notes "container ${IMAGE[$cont]} could not be built" -- false || true
      failed=$((failed + 1)); continue
    fi
    id=$(docker image inspect --format '{{.Id}}' "${IMAGE[$cont]}")
    docker run --rm "${DOCKER_RUN_EXTRA[@]}" -e SUBCORE_IMAGE="${IMAGE[$cont]}" -e SUBCORE_IMAGE_ID="$id" \
      -v "$ROOT":/work -w /work "${IMAGE[$cont]}" \
      bash -c "node tools/record.mjs --packet $packet --step $step -- $cmd" || failed=$((failed + 1))
  fi
done < "$steps"
node tools/resume.mjs || true
echo "[run] iteration $iteration: $((total - failed))/$total steps passed"
[ $failed -gt 100 ] && failed=100
exit $failed
