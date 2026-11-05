// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Writes, as JSON on standard output, what tools/oracles.py needs from each model: its hash, its parameters and
// initial values in SI, its horizon, and the syntax trees of its equations, outputs and analytic solution (with
// the oracle's definitions substituted). The trees come from the core's one parser, so the oracle evaluates
// exactly the expressions the core evaluates, at higher precision.
import fs from 'node:fs';
import path from 'node:path';
import { loadYaml, specHash } from '../docs/src/spec.js';
import { parse, substitute } from '../docs/src/expr.js';
import { toSI } from '../docs/src/units.js';

const out = {};
for (const f of process.argv.slice(2)) {
  const m = loadYaml(fs.readFileSync(f, 'utf8'), f);
  const params = {};
  for (const p of m.parameters || []) params[p.name] = toSI(p.value, p.unit);
  const r = { file: f, id: m.identity.id, version: m.identity.version, sha256: specHash(m), kind: m.kind, params };
  if (m.kind === 'continuous') {
    r.states = m.states.map((s) => ({ name: s.name, initial: toSI(s.initial, s.unit) }));
    r.equations = m.equations.map((e) => ({ der: e.der, ast: parse(e.expression) }));
    r.horizon = { t0: toSI(m.horizon.t0, m.horizon.unit), t1: toSI(m.horizon.t1, m.horizon.unit) };
  }
  if (m.kind === 'function') {
    r.independent = m.independent.name;
    r.domain = m.domain;
    r.outputs = m.outputs.map((o) => ({ name: o.name, ast: parse(o.expression) }));
  }
  if (m.oracle && m.oracle.kind === 'analytic') {
    const defs = {};
    for (const d of m.oracle.definitions || []) defs[d.name] = substitute(parse(d.expression), defs);
    r.solution = m.oracle.solution.map((s) => ({ name: s.name, ast: substitute(parse(s.expression), defs) }));
  }
  out[path.basename(f, '.yaml')] = r;
}
process.stdout.write(JSON.stringify(out) + '\n');
