// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Extracts published reference vectors for the seeded generators from the tests of the rand_xoshiro 0.6.0
// crate (crates.io), which state that they were produced with the reference C implementations by Vigna
// (splitmix64.c; xoshiro128starstar.c version 1.1). The crate is fetched into .cache/crates/ and its sha256
// checked; the values are copied, not computed, and written to vectors/prng/ with their source.
//   node tools/prng_vectors.mjs [<output folder, default vectors>]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from './record.mjs';

const CRATE = 'rand_xoshiro-0.6.0';
const URL = 'https://crates.io/api/v1/crates/rand_xoshiro/0.6.0/download';
const SHA256 = '6f97cdb2a36ed4183de61b2f824cc45c9f1037f28afe0a322e9fff4c108b5aaa';
const dir = path.join(REPO, '.cache', 'crates');
const file = path.join(dir, `${CRATE}.crate`);
fs.mkdirSync(dir, { recursive: true });
if (!fs.existsSync(file)) execFileSync('curl', ['-sSL', '-o', file, URL]);
const sha = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if (sha !== SHA256) throw new Error(`crate sha256 ${sha} differs from the pinned ${SHA256}`);
execFileSync('tar', ['-xzf', file, '-C', dir]);

function block(src, fnName) {
  const i = src.indexOf(`fn ${fnName}()`);
  if (i < 0) throw new Error(`no test ${fnName}`);
  return src.slice(i, src.indexOf('\n    }\n', i));
}

function write(name, lines) {
  const out = path.join(path.resolve(REPO, process.argv[2] || 'vectors'), 'prng', name);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, lines.join('\n') + '\n');
  console.log(`wrote ${path.relative(REPO, out)}`);
}

const head = (gen, seed, src, ref, lines, n) => [
  '# subcore-prng-vectors 1',
  '# © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI. (this header only) SPDX-License-Identifier: CC0-1.0',
  `# generator: ${gen}`,
  `# seed: ${seed}`,
  `# source: crate ${CRATE} (${URL}, sha256 ${SHA256}), ${src}, test reference(), lines ${lines}`,
  `# produced_by: ${ref} (as the crate's test states)`,
  '# format: one output per line, lower-case hexadecimal',
  `# cases: ${n}`,
];

{
  const rel = `${CRATE}/src/splitmix64.rs`;
  const src = fs.readFileSync(path.join(dir, rel), 'utf8');
  const b = block(src, 'reference');
  const seed = /seed_from_u64\((\d+)\)/.exec(b)[1];
  const arr = b.slice(b.indexOf('= [') + 3, b.indexOf('];'));
  const vals = arr.match(/\d+/g).map((d) => BigInt(d));
  const start = src.slice(0, src.indexOf('fn reference()')).split('\n').length;
  write('splitmix64.vec', [...head('SplitMix64, next 64-bit output', seed, `src/splitmix64.rs`, 'http://xoshiro.di.unimi.it/splitmix64.c', `${start}-${start + 25}`, vals.length),
    ...vals.map((v) => v.toString(16))]);
}
{
  const rel = `${CRATE}/src/xoshiro128starstar.rs`;
  const src = fs.readFileSync(path.join(dir, rel), 'utf8');
  const b = block(src, 'reference');
  const seedBytes = /from_seed\(\s*\[([^\]]+)\]/.exec(b)[1].split(',').map((x) => Number(x.trim()));
  const words = [0, 1, 2, 3].map((k) => seedBytes[4 * k] | (seedBytes[4 * k + 1] << 8) | (seedBytes[4 * k + 2] << 16) | (seedBytes[4 * k + 3] << 24));
  const e0 = b.indexOf('[', b.indexOf('let expected'));
  const vals = b.slice(e0 + 1, b.indexOf('];', e0)).match(/\d+/g).map(Number);
  const start = src.slice(0, src.indexOf('fn reference()')).split('\n').length;
  write('xoshiro128starstar.vec', [...head('xoshiro128** 1.1, next 32-bit output', `state words ${words.join(' ')} (little-endian bytes ${seedBytes.join(',')})`,
    'src/xoshiro128starstar.rs', 'http://xoshiro.di.unimi.it/xoshiro128starstar.c (v1.1)', `${start}-${start + 12}`, vals.length),
    ...vals.map((v) => v.toString(16))]);
}
