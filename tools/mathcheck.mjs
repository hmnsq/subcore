// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// How often Math's functions differ in the last bit between this Node.js and headless Chromium (Playwright).
// ECMAScript does not require correctly rounded transcendental functions, and two releases of one engine may
// differ. Writes reports/parity/math_functions.json.   node tools/mathcheck.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { REPO } from './record.mjs';

const require = createRequire(import.meta.url);
const pw = require('playwright');
const probe = () => {
  const fns = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'exp', 'log', 'log10', 'sqrt', 'pow'];
  const out = {};
  for (const f of fns) {
    const v = [];
    for (let k = 1; k <= 20000; k++) {
      const x = k / 20000;
      v.push(f === 'pow' ? Math.pow(x * 3, 1 / 5) : Math[f]((f === 'asin' || f === 'acos') ? x * 0.999 : x * 3));
    }
    out[f] = v;
  }
  return out;
};
const nodeOut = probe();
const b = await pw.chromium.launch();
const version = b.version();
const p = await b.newPage();
const br = await p.evaluate(probe);
await b.close();
const res = {};
for (const f of Object.keys(nodeOut)) {
  let d = 0, first = null;
  nodeOut[f].forEach((x, i) => { if (!Object.is(x, br[f][i])) { d++; if (!first) first = { argument_index: i + 1, node: x, chromium: br[f][i] }; } });
  res[f] = { arguments: 20000, differ: d, first };
  console.log(`${f.padEnd(6)} ${d} of 20000 differ`);
}
const out = { _notice: '© 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI. SPDX-License-Identifier: CC0-1.0',
  node: process.version, node_v8: process.versions.v8, chromium: version,
  arguments: 'x = 3k/20000 for k = 1..20000 (asin, acos: 0.999k/20000; pow: (3k/20000)^(1/5))', functions: res };
fs.mkdirSync(path.join(REPO, 'reports/parity'), { recursive: true });
fs.writeFileSync(path.join(REPO, 'reports/parity/math_functions.json'), JSON.stringify(out, null, 1) + '\n');
