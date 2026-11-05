// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// The cases of the Node.js and browser parity test (WEB-06, T-33). The same module runs in Node.js
// (tools/parity.mjs) and in each browser (tests/parity.html); readText is fs or fetch. Returns
// { name: text } where each text is a trace or a list of numbers in 17 significant digits.
// REQUIRED lists the cases that must be byte-identical on Chromium (fixed-step runs and integer outputs);
// the others (adaptive runs, function tables, normal deviates) are reported with their largest difference.
import { loadYaml } from '../docs/src/spec.js';
import { runModel } from '../docs/src/cli.js';
import { compileFunctions } from '../docs/src/spec.js';
import { createRng } from '../docs/src/prng.js';
import { fmt17 } from '../docs/src/trace.js';

export const MODELS = ['exponential-decay', 'harmonic-oscillator', 'damped-driven-oscillator', 'lorenz'];
export const REQUIRED = [...MODELS.map((id) => `${id}.rk4.csv`), 'prng.u32.txt'];

export async function runCases(readText) {
  const out = {};
  for (const id of MODELS) {
    const m = loadYaml(await readText(`spec/models/${id}.yaml`));
    out[`${id}.rk4.csv`] = runModel(m, { solver: 'rk4' }).text;
    out[`${id}.dopri54.csv`] = runModel(m, { solver: 'dopri54', points: 400 }).text;
  }
  const fg = compileFunctions(loadYaml(await readText('spec/models/function-generation.yaml')));
  const rows = [];
  for (let k = 0; k <= 1000; k++) rows.push([k / 1000, ...fg.at(k / 1000)].map(fmt17).join(','));
  out['function-generation.csv'] = rows.join('\n') + '\n';
  const rng = createRng(20261104n);
  const p = [], q = [];
  for (let i = 0; i < 10000; i++) p.push(rng.nextU32().toString(16));
  for (let i = 0; i < 2000; i++) q.push(fmt17(rng.nextNormal()));
  out['prng.u32.txt'] = p.join('\n') + '\n';
  out['prng.normal.txt'] = q.join('\n') + '\n';
  return out;
}
