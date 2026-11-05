// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Vector files. Two forms are read:
//  - the discrete form of the sprint contract (CNF-01, 'repsynth-vectors 1'): hexadecimal unsigned integers of
//    the register width, read as BigInt;
//  - the continuous form of this core ('subcore-vectors 1'): doubles with 17 significant digits, one case per
//    line, with a header naming the model, its version and hash, the oracle and its stated error bound.
//
//   # subcore-vectors 1
//   # © ... SPDX-License-Identifier: CC0-1.0
//   # model: <id>
//   # version: <model version>
//   # model_sha256: <hex of the canonical model>
//   # oracle: <analytic | mpmath ...>
//   # error_bound: <bound and its kind>
//   # fields: t x v
//   # generator: <tool and version>
//   # cases: <n>
//   <t> <x> <v>

import { SubcoreError } from './errors.js';

export const VECTORS_VERSION = '1.0.0';

function header(lines) {
  const meta = {};
  for (const l of lines) {
    const m = /^# ([a-z_0-9]+): (.*)$/.exec(l);
    if (m) meta[m[1]] = m[2];
  }
  return meta;
}

// Returns { kind: 'discrete' | 'continuous', meta, fields, cases: (BigInt[] | number[])[] }
export function parseVectors(text) {
  const lines = text.split('\n').filter((l) => l !== '');
  if (lines.length === 0) throw new SubcoreError('VECTORS', 'line 1', 'empty vector file');
  const first = lines[0];
  const meta = header(lines.filter((l) => l.startsWith('#')));
  const body = lines.filter((l) => !l.startsWith('#'));
  let kind, cases;
  if (first === '# repsynth-vectors 1') {
    kind = 'discrete';
    cases = body.map((l, i) => l.trim().split(/\s+/).filter((x) => x !== '->').map((h) => {
      if (!/^[0-9a-f]+$/.test(h)) throw new SubcoreError('VECTORS', `case ${i + 1}`, `'${h}' is not lower-case hexadecimal`);
      return BigInt('0x' + h);
    }));
  } else if (first === '# subcore-vectors 1') {
    kind = 'continuous';
    cases = body.map((l, i) => l.trim().split(/\s+/).map((x) => {
      const v = Number(x);
      if (Number.isNaN(v)) throw new SubcoreError('VECTORS', `case ${i + 1}`, `'${x}' is not a number`);
      return v;
    }));
  } else {
    throw new SubcoreError('VECTORS', 'line 1', `unknown vector file header '${first}'`);
  }
  if (meta.cases !== undefined && Number(meta.cases) !== cases.length) {
    throw new SubcoreError('VECTORS', 'cases', `header says ${meta.cases} cases, file has ${cases.length}`);
  }
  const fields = (meta.fields || '').split(/\s+/).filter((x) => x && x !== '->');
  return { kind, meta, fields, cases };
}
