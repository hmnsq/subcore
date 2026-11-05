// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Reads {"units": [[path, code], ...], "expressions": [[path, text], ...], "models": [[path, object], ...]} on
// standard input and writes {"errors": [[path, message], ...]} using the core's own UCUM reader, expression
// parser and model checks, so tools/validate.py checks with the one implementation the simulators run.
import { parseUnit } from '../docs/src/units.js';
import { parse } from '../docs/src/expr.js';
import { checkModel } from '../docs/src/spec.js';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  const q = JSON.parse(input);
  const errors = [];
  for (const [path, code] of q.units || []) {
    try { parseUnit(code); } catch (e) { errors.push([path, e.message]); }
  }
  for (const [path, text] of q.expressions || []) {
    try { parse(text); } catch (e) { errors.push([path, e.message]); }
  }
  for (const [path, m] of q.models || []) {
    for (const e of checkModel(m)) errors.push([`${path}:${e.path}`, `${e.code}: ${e.message}`]);
  }
  process.stdout.write(JSON.stringify({ errors }) + '\n');
});
