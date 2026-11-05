// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256Hex, canonicalJson } from '../docs/src/hash.js';

test('sha256 equals node crypto (FIPS 180-4 vectors and edge lengths)', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  for (const n of [1, 55, 56, 63, 64, 65, 119, 120, 1000]) {
    const s = 'é'.repeat(n);
    assert.equal(sha256Hex(s), createHash('sha256').update(s).digest('hex'));
  }
});

test('canonical JSON sorts keys', () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] }), '{"a":[2,{"c":4,"d":3}],"b":1}');
});
