// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeTrace, parseTrace, fmt17, compareTraces } from '../docs/src/trace.js';
import { parseVectors } from '../docs/src/vectors.js';

test('17 significant digits round-trip every double exactly', () => {
  for (const x of [0, -0, 1, 0.1, 1 / 3, Math.PI, 1e-300, 5e-324, 1.7976931348623157e308, -2.5e-7]) {
    assert.ok(Object.is(Number(fmt17(x)), x), `${x} -> ${fmt17(x)}`);
  }
});

test('trace write and parse', () => {
  const text = writeTrace({ model: 'm 1.0.0', parameter_sha256: 'ab', solver: 'rk4', step: '0.01' }, ['t', 'x'], [[0, 1], [0.01, 0.99]]);
  assert.ok(text.startsWith('# subcore-trace 1\n# © 1993–2026'));
  assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(text), 'no timestamps');
  const p = parseTrace(text);
  assert.equal(p.meta.solver, 'rk4');
  assert.deepEqual(p.rows, [[0, 1], [0.01, 0.99]]);
  assert.equal(compareTraces(p, p).maxAbs, 0);
  assert.throws(() => writeTrace({ model: 'm' }, ['t'], []), { code: 'TRACE' });
});

test('vector files: both forms', () => {
  const d = parseVectors('# repsynth-vectors 1\n# fields: a b -> s\n# cases: 1\nff 01 100\n');
  assert.equal(d.kind, 'discrete');
  assert.deepEqual(d.cases[0], [255n, 1n, 256n]);
  const c = parseVectors('# subcore-vectors 1\n# fields: t x\n# cases: 1\n0.0000000000000000e+00 1.0000000000000000e+00\n');
  assert.deepEqual(c.cases[0], [0, 1]);
  assert.throws(() => parseVectors('# subcore-vectors 1\n# cases: 2\n1 2\n'), { code: 'VECTORS' });
});
