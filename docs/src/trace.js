// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Traces (Guidelines 13): CSV with header lines naming the model, substrate, parameter hash, solver, step or
// tolerances and seed. Numbers are written with 17 significant digits in exponent form (toExponential(16)),
// so a trace is exact for doubles and byte-comparable between engines. No timestamps are written.
//
//   # subcore-trace 1
//   # © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI. SPDX-License-Identifier: CC0-1.0
//   # model: <id> <version>
//   # substrate: <id or none>
//   # parameter_sha256: <hex>
//   # solver: rk4 | dopri54
//   # step: <h>            (rk4)    or   # tolerances: rtol=<r> atol=<a>   (dopri54)
//   # seed: <n or none>
//   # generator: subcore.trace <version>
//   t,x,v
//   0.0000000000000000e+0,1.0000000000000000e+0,...

import { SubcoreError } from './errors.js';

export const TRACE_VERSION = '1.0.0';
export const NOTICE = '© 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.';

export function fmt17(x) {
  if (Number.isNaN(x)) return 'nan';
  if (x === Infinity) return 'inf';
  if (x === -Infinity) return '-inf';
  if (Object.is(x, -0)) return '-0.0000000000000000e+0';
  return x.toExponential(16);
}

export function parseNum(s) {
  if (s === 'nan') return NaN;
  if (s === 'inf') return Infinity;
  if (s === '-inf') return -Infinity;
  const v = Number(s);
  if (Number.isNaN(v) || s.trim() === '') throw new SubcoreError('TRACE', s, 'not a number');
  return v;
}

const KEYS = ['model', 'model_sha256', 'substrate', 'parameter_sha256', 'solver', 'step', 'tolerances', 'seed', 'generator'];

// meta: { model, substrate, parameter_sha256, solver, step?, tolerances?, seed?, extra?: {k: v} }
// columns: names; rows: arrays of numbers (or { t, y } pairs via rowsFrom)
export function writeTrace(meta, columns, rows) {
  if (!meta.model || !meta.solver || !meta.parameter_sha256) {
    throw new SubcoreError('TRACE', 'meta', 'a trace names its model, solver and parameter hash');
  }
  const lines = ['# subcore-trace 1', `# ${NOTICE} SPDX-License-Identifier: CC0-1.0`];
  const m = { substrate: 'none', seed: 'none', generator: `subcore.trace ${TRACE_VERSION}`, ...meta };
  for (const k of KEYS) if (m[k] !== undefined) lines.push(`# ${k}: ${m[k]}`);
  for (const [k, v] of Object.entries(meta.extra || {}).sort()) lines.push(`# ${k}: ${v}`);
  lines.push(columns.join(','));
  for (const r of rows) {
    if (r.length !== columns.length) throw new SubcoreError('TRACE', 'rows', `row has ${r.length} fields, header has ${columns.length}`);
    lines.push(r.map(fmt17).join(','));
  }
  return lines.join('\n') + '\n';
}

// From an integrator result { t, y } to rows [t, y0, y1, ...]
export function rowsFrom(result) {
  return result.t.map((t, k) => [t, ...result.y[k]]);
}

export function parseTrace(text) {
  const meta = {};
  let columns = null;
  const rows = [];
  const lines = text.split('\n');
  if (lines[0] !== '# subcore-trace 1') throw new SubcoreError('TRACE', 'line 1', "not a subcore trace (expected '# subcore-trace 1')");
  lines.forEach((line, i) => {
    if (line === '') return;
    if (line.startsWith('#')) {
      const m = /^# ([a-z_0-9]+): (.*)$/.exec(line);
      if (m) meta[m[1]] = m[2];
      return;
    }
    if (!columns) { columns = line.split(','); return; }
    const f = line.split(',');
    if (f.length !== columns.length) throw new SubcoreError('TRACE', `line ${i + 1}`, `${f.length} fields, header has ${columns.length}`);
    rows.push(f.map(parseNum));
  });
  if (!columns) throw new SubcoreError('TRACE', 'header', 'no column header');
  return { meta, columns, rows };
}

// Compare two traces column by column on equal time grids. Returns the maximum absolute and relative
// differences (relative with an absolute floor) per column and overall.
export function compareTraces(a, b, { floor = 1e-9 } = {}) {
  if (a.columns.join(',') !== b.columns.join(',')) throw new SubcoreError('TRACE', 'columns', 'traces have different columns');
  if (a.rows.length !== b.rows.length) throw new SubcoreError('TRACE', 'rows', `traces have ${a.rows.length} and ${b.rows.length} rows`);
  const per = {};
  let maxAbs = 0, maxRel = 0;
  a.columns.forEach((c, j) => {
    let ma = 0, mr = 0;
    for (let k = 0; k < a.rows.length; k++) {
      const x = a.rows[k][j], y = b.rows[k][j];
      const d = Math.abs(x - y);
      ma = Math.max(ma, d);
      mr = Math.max(mr, d / Math.max(Math.abs(y), floor));
    }
    per[c] = { maxAbs: ma, maxRel: mr };
    maxAbs = Math.max(maxAbs, ma); maxRel = Math.max(maxRel, mr);
  });
  return { maxAbs, maxRel, per };
}
