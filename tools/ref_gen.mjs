// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
// Generates a reference tool's input from a model file: node tools/ref_gen.mjs <model.yaml> <modelica|spice> <out dir>
import fs from 'node:fs';
import path from 'node:path';
import { loadYaml } from '../docs/src/spec.js';
import { modelToModelica, modelToSpice, modelicaName } from '../docs/src/export.js';
import { toSI } from '../docs/src/units.js';

const [file, form, out] = process.argv.slice(2);
const m = loadYaml(fs.readFileSync(file, 'utf8'), file);
fs.mkdirSync(out, { recursive: true });
if (form === 'modelica') {
  const name = modelicaName(m.identity.id);
  fs.writeFileSync(path.join(out, `${name}.mo`), modelToModelica(m));
  const t1 = toSI(m.horizon.t1, m.horizon.unit);
  fs.writeFileSync(path.join(out, 'run.mos'), [
    '// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI. SPDX-License-Identifier: CC0-1.0',
    `loadFile("${name}.mo");`,
    `simulate(${name}, stopTime=${t1}, numberOfIntervals=400, tolerance=1e-10, method="dassl", outputFormat="csv");`,
    'getErrorString();', ''].join('\n'));
  console.log(`${name}.mo run.mos`);
} else if (form === 'spice') {
  fs.writeFileSync(path.join(out, 'model.cir'), modelToSpice(m, { out: 'out.txt' }));
  console.log('model.cir');
} else throw new Error(`unknown form ${form}`);
