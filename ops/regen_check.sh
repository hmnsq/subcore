#!/usr/bin/env bash
# © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
# SPDX-License-Identifier: GPL-3.0-or-later
# P9.6: regenerate every vector file into .cache/tmp/regen and compare it byte for byte with vectors/.
set -euo pipefail
cd "$(dirname "$0")/.."
out=.cache/tmp/regen
rm -rf "$out"; mkdir -p "$out"
python3 tools/oracles.py --out "$out/vectors"
node tools/prng_vectors.mjs "$out/vectors"
echo "comparing regenerated vectors with vectors/:"
diff -r vectors "$out/vectors"
n=$(find vectors -type f | wc -l)
echo "regen_check: $n files regenerate byte for byte"
