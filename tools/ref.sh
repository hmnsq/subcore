#!/usr/bin/env bash
# © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
# SPDX-License-Identifier: GPL-3.0-or-later
#
#   tools/ref.sh --list                     each reference tool's version, and the image it runs in
#   tools/ref.sh <tool> <sample> [--repo <path>]
#
# Runs one sample in one reference (Guidelines 14): tools ngspice and openmodelica take a model of
# spec/models/; qiskit-aer takes bell (spec/circuits/bell.qasm); qutip takes oscillator; chrono takes
# gear-pair. Output goes to <repo>/refs/<tool>/<sample>/ with ref.json (tool version, image, image digest,
# command, sha256 of every input and output). Runs inside substrate-ref (ops/run.sh), or natively where the
# tools exist (SUBCORE_OMC, SUBCORE_PY_QUANTUM, SUBCORE_PY_CHRONO name them). A tool that is missing exits 3.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
exec python3 "$here/ref.py" "$@"
