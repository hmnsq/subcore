// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// One command surface for the browser and Node.js (WEB-06). runCli(argv, io) takes the arguments and an io
// object { readText(path) -> string, writeText(path, text), log(line) } and returns an exit code. Node.js
// supplies io from the file system (tools/cli.mjs); the page supplies an in-memory one (docs/index.html).
//
//   run <model.yaml> [--solver rk4|dopri54] [--h <step>] [--t1 <end>] [--every <n>] [--points <n>]
//                    [--rtol <r>] [--atol <a>] [--out <trace.csv>]
//   check <model.yaml>                 structural checks; prints each error with its path
//   expr <expression> [--to text|modelica|spice|json] [--nodes x,v]
//   hash <file>                        sha256 of the file's text (UTF-8)
//   prng <seed> [<count>]              xoshiro128** seeded by SplitMix64: 32-bit outputs in hexadecimal
//   compare <a.csv> <b.csv>            maximum absolute and relative differences of two traces
//   version

import { SubcoreError } from './errors.js';
import { sha256Hex } from './hash.js';
import { parse, toText, toModelica, toSpice, astCanonical } from './expr.js';
import { loadYaml, checkModel, compileModel } from './spec.js';
import { integrateFixed, dopri54, grid } from './solve.js';
import { writeTrace, parseTrace, compareTraces } from './trace.js';
import { createRng } from './prng.js';

export const CORE_VERSION = '0.1.0';

function options(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { opt[argv[i].slice(2)] = argv[i + 1]; i++; } else pos.push(argv[i]);
  }
  return { pos, opt };
}

const num = (v, name) => {
  const x = Number(v);
  if (v === undefined || !Number.isFinite(x)) throw new SubcoreError('CLI', `--${name}`, `needs a finite number, got '${v}'`);
  return x;
};

// Run a continuous model and return the trace text (also used by the page and the parity test).
export function runModel(model, { solver = 'rk4', h, t1, every = 1, points = 200, rtol, atol, log = () => {} } = {}) {
  const c = compileModel(model);
  const t0 = c.horizon.t0;
  const tEnd = t1 !== undefined ? t1 : c.horizon.t1;
  let res, meta;
  if (solver === 'rk4') {
    const step = h !== undefined ? h : c.defaults.rk4_step;
    const steps = Math.round((tEnd - t0) / step);
    if (Math.abs(t0 + steps * step - tEnd) > 1e-9 * Math.max(1, Math.abs(tEnd))) {
      throw new SubcoreError('CLI', '--h', `the horizon ${tEnd - t0} is not a whole number of steps of ${step}`);
    }
    log(`run: ${c.id} ${c.version}, rk4, h=${step}, ${steps} steps, output every ${every}`);
    res = integrateFixed({ f: c.f, t0, y0: c.y0, h: step, steps, every, names: c.stateNames });
    meta = { step: String(step) };
  } else if (solver === 'dopri54') {
    const r = rtol !== undefined ? rtol : (c.defaults.rtol ?? 1e-10);
    const a = atol !== undefined ? atol : (c.defaults.atol ?? 1e-12);
    log(`run: ${c.id} ${c.version}, dopri54, rtol=${r}, atol=${a}, ${points} output intervals`);
    res = dopri54({ f: c.f, t0, y0: c.y0, tOut: grid(t0, tEnd, points), rtol: r, atol: a, names: c.stateNames });
    meta = { tolerances: `rtol=${r} atol=${a}` };
    log(`run: ${res.stats.accepted} steps accepted, ${res.stats.rejected} rejected, ${res.stats.fevals} evaluations`);
  } else throw new SubcoreError('CLI', '--solver', `unknown solver '${solver}' (rk4 or dopri54)`);
  const rows = res.t.map((t, k) => [t, ...c.outputs(t, res.y[k])]);
  const text = writeTrace({ model: `${c.id} ${c.version}`, model_sha256: c.hash, parameter_sha256: c.parameterHash, solver, ...meta },
    ['t', ...c.outputNames], rows);
  return { text, stats: res.stats, compiled: c };
}

export function runCli(argv, io) {
  const log = io.log || (() => {});
  const { pos, opt } = options(argv);
  const cmd = pos.shift();
  try {
    switch (cmd) {
      case 'run': {
        if (!pos[0]) throw new SubcoreError('CLI', 'run', 'needs a model file');
        log(`load: ${pos[0]}`);
        const model = loadYaml(io.readText(pos[0]), pos[0]);
        const r = runModel(model, {
          solver: opt.solver || 'rk4', h: opt.h !== undefined ? num(opt.h, 'h') : undefined,
          t1: opt.t1 !== undefined ? num(opt.t1, 't1') : undefined, every: opt.every ? num(opt.every, 'every') : 1,
          points: opt.points ? num(opt.points, 'points') : 200, rtol: opt.rtol !== undefined ? num(opt.rtol, 'rtol') : undefined,
          atol: opt.atol !== undefined ? num(opt.atol, 'atol') : undefined, log,
        });
        if (opt.out) { io.writeText(opt.out, r.text); log(`write: ${opt.out} (sha256 ${sha256Hex(r.text)})`); } else io.writeText('-', r.text);
        return 0;
      }
      case 'check': {
        const model = loadYaml(io.readText(pos[0]), pos[0]);
        const errs = checkModel(model);
        for (const e of errs) log(`${e.code} at ${e.path}: ${e.message}`);
        log(errs.length ? `check: ${pos[0]}: ${errs.length} error(s)` : `check: ${pos[0]}: valid`);
        return errs.length ? 1 : 0;
      }
      case 'expr': {
        const ast = parse(pos[0]);
        const to = opt.to || 'text';
        const out = to === 'modelica' ? toModelica(ast) : to === 'spice' ? toSpice(ast, (opt.nodes || '').split(',').filter(Boolean))
          : to === 'json' ? astCanonical(ast) : toText(ast);
        io.writeText('-', out + '\n');
        return 0;
      }
      case 'hash': io.writeText('-', sha256Hex(io.readText(pos[0])) + '\n'); return 0;
      case 'prng': {
        const rng = createRng(BigInt(pos[0] ?? '0'));
        const n = Number(pos[1] ?? 8);
        const out = [];
        for (let i = 0; i < n; i++) out.push(rng.nextU32().toString(16).padStart(8, '0'));
        io.writeText('-', out.join('\n') + '\n');
        return 0;
      }
      case 'compare': {
        const r = compareTraces(parseTrace(io.readText(pos[0])), parseTrace(io.readText(pos[1])));
        io.writeText('-', JSON.stringify(r, null, 1) + '\n');
        return 0;
      }
      case 'version': io.writeText('-', `subcore ${CORE_VERSION}\n`); return 0;
      default:
        log('usage: run | check | expr | hash | prng | compare | version (see docs/src/cli.js)');
        return 2;
    }
  } catch (e) {
    log(e instanceof SubcoreError ? `error: ${e.message}` : `error: ${e.stack || e}`);
    return 1;
  }
}
