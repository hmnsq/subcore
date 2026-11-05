#!/usr/bin/env bash
# © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
# SPDX-License-Identifier: GPL-3.0-or-later
# P9.7, T-37: mutation self-test of the core. Each planted defect is applied to a copy of the repository in
# .cache/selftest/<name>/ (the working tree is never touched) and the test suite must fail there; the
# unmutated copy must pass first. Results: reports/selftest/S1.json. Exit 0 only when every defect is caught.
set -uo pipefail
cd "$(dirname "$0")/.."
exec python3 tools/selftest.py "$@"
