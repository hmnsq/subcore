// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
// The seeded generators reproduce their published reference vectors (vectors/prng/, extracted by
// tools/prng_vectors.mjs from the rand_xoshiro 0.6.0 crate, produced with Vigna's reference C code).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SplitMix64, Xoshiro128ss, createRng } from '../docs/src/prng.js';

function readVec(name) {
  const text = fs.readFileSync(new URL(`../vectors/prng/${name}`, import.meta.url), 'utf8');
  const lines = text.split('\n').filter(Boolean);
  const meta = Object.fromEntries(lines.filter((l) => l.startsWith('# ')).map((l) => l.slice(2).split(': ')).filter((p) => p.length >= 2).map(([k, ...v]) => [k, v.join(': ')]));
  const values = lines.filter((l) => !l.startsWith('#')).map((h) => BigInt('0x' + h));
  assert.equal(values.length, Number(meta.cases));
  return { meta, values };
}

test('SplitMix64 reproduces the reference vector (50 outputs)', () => {
  const { meta, values } = readVec('splitmix64.vec');
  const g = new SplitMix64(BigInt(meta.seed));
  for (const v of values) assert.equal(g.next(), v);
});

test('xoshiro128** 1.1 reproduces the reference vector', () => {
  const { meta, values } = readVec('xoshiro128starstar.vec');
  const words = /state words (\d+) (\d+) (\d+) (\d+)/.exec(meta.seed).slice(1).map(Number);
  const g = new Xoshiro128ss(words);
  for (const v of values) assert.equal(BigInt(g.nextU32()), v);
});

test('createRng is deterministic and its floats lie in [0, 1)', () => {
  const a = createRng(7n), b = createRng(7n);
  for (let i = 0; i < 1000; i++) {
    const x = a.nextFloat();
    assert.equal(x, b.nextFloat());
    assert.ok(x >= 0 && x < 1);
  }
  const c = createRng(8n);
  assert.notEqual(c.nextU32(), createRng(7n).nextU32());
});

test('normal deviates have mean near 0 and variance near 1 (100000 samples)', () => {
  const r = createRng(1n);
  let s = 0, q = 0;
  const n = 100000;
  for (let i = 0; i < n; i++) { const z = r.nextNormal(); s += z; q += z * z; }
  assert.ok(Math.abs(s / n) < 0.02);
  assert.ok(Math.abs(q / n - 1) < 0.02);
});
