// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
// The restricted expression grammar (CMS-02; T-32): precedence, evaluation, refusals, and the round trip
// through the Modelica and SPICE forms, for every expression of every CMS-03 model and for seeded random trees.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse, parseModelica, parseSpice, toText, toModelica, toSpice, evaluate, astEqual, roundTrip, compile, FUNCTIONS } from '../docs/src/expr.js';
import { loadYaml } from '../docs/src/spec.js';
import { createRng } from '../docs/src/prng.js';

const ev = (s, scope = {}) => evaluate(parse(s), scope);

test('precedence and associativity', () => {
  assert.equal(ev('1+2*3'), 7);
  assert.equal(ev('(1+2)*3'), 9);
  assert.equal(ev('10-4-3'), 3);
  assert.equal(ev('8/4/2'), 1);
  assert.equal(ev('2^3^2'), 512);
  assert.equal(ev('-2^2'), -4);
  assert.equal(ev('2^-1'), 0.5);
  assert.equal(ev('2*3^2'), 18);
  assert.equal(ev('-3*2+1'), -5);
  assert.equal(ev('1-2*3^2/9'), -1);
  assert.equal(ev('a - -b', { a: 1, b: 2 }), 3);
  assert.deepEqual(parse('-a*b'), { type: 'bin', op: '*', left: { type: 'neg', arg: { type: 'ident', name: 'a' } }, right: { type: 'ident', name: 'b' } });
});

test('functions', () => {
  assert.equal(ev('sin(0)+cos(0)+exp(0)+log(1)+sqrt(4)+abs(-3)+sign(-2)'), 0 + 1 + 1 + 0 + 2 + 3 - 1);
  assert.equal(ev('min(2, 3) + max(2, 3)'), 5);
  assert.equal(ev('log10(1000)'), 3);
});

test('refusals carry a code and a position', () => {
  for (const bad of ['', '1+', '(1', 'sin 1', 'foo(1)', 'min(1)', 'sin(1,2)', '2x', 'time', 'der', 'a $ b', '1..2', '--', 'x^']) {
    assert.throws(() => parse(bad), (e) => e.code === 'PARSE' && /^expr:\d+$/.test(e.path), `'${bad}' should be refused`);
  }
  assert.throws(() => compile(parse('a+b'), { a: 0 }), { code: 'UNBOUND' });
});

test('no eval, no new Function, no Math.random in the core sources (WEB-04)', () => {
  const dir = new URL('../docs/src/', import.meta.url);
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.js')) continue;
    const src = fs.readFileSync(new URL(f, dir), 'utf8').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/\beval\s*\(|new\s+Function\s*\(|Math\.random/.test(src), `${f} uses eval, new Function or Math.random`);
  }
});

function modelExpressions() {
  const dir = new URL('../spec/models/', import.meta.url);
  const out = [];
  for (const f of fs.readdirSync(dir).sort()) {
    const m = loadYaml(fs.readFileSync(new URL(f, dir), 'utf8'));
    const nodes = (m.states || []).map((s) => s.name).concat((m.inputs || []).map((u) => u.name));
    const add = (where, list) => (list || []).forEach((e, k) => out.push({ where: `${f}:${where}[${k}]`, text: e.expression, nodes }));
    add('equations', m.equations); add('outputs', m.outputs); add('inputs', m.inputs);
    if (m.oracle) { add('oracle.definitions', m.oracle.definitions); add('oracle.solution', m.oracle.solution); }
  }
  return out;
}

test('T-32: every CMS-03 expression re-parses from its Modelica and SPICE forms to the same tree', () => {
  const all = modelExpressions();
  assert.ok(all.length >= 25, `only ${all.length} expressions found`);
  for (const { where, text, nodes } of all) {
    const ast = parse(text);
    const r = roundTrip(ast, nodes);
    assert.ok(astEqual(parse(r.text), ast), `${where}: text form`);
    assert.ok(astEqual(parseModelica(r.modelica), ast), `${where}: Modelica form ${r.modelica}`);
    assert.ok(astEqual(parseSpice(r.spice), ast), `${where}: SPICE form ${r.spice}`);
  }
});

function randomTree(rng, depth, names) {
  const pick = (n) => rng.nextU32() % n;
  if (depth === 0 || pick(4) === 0) {
    return pick(2) === 0 ? { type: 'num', value: [0, 1, 2, 0.5, 3.25, 1e-7, 6.02e23, 0.1][pick(8)] } : { type: 'ident', name: names[pick(names.length)] };
  }
  const k = pick(10);
  if (k < 2) return { type: 'neg', arg: randomTree(rng, depth - 1, names) };
  if (k < 8) return { type: 'bin', op: ['+', '-', '*', '/', '^'][pick(5)], left: randomTree(rng, depth - 1, names), right: randomTree(rng, depth - 1, names) };
  const fn = FUNCTIONS[pick(FUNCTIONS.length)];
  const n = fn === 'min' || fn === 'max' ? 2 : 1;
  return { type: 'call', fn, args: Array.from({ length: n }, () => randomTree(rng, depth - 1, names)) };
}

test('T-32: 3000 seeded random trees round-trip through every form', () => {
  const rng = createRng(20261104n);
  const names = ['x', 'v', 'k', 'omega', 't'];
  for (let i = 0; i < 3000; i++) {
    const ast = randomTree(rng, 6, names);
    const nodes = ['x', 'v'];
    assert.ok(astEqual(parse(toText(ast)), ast), `text: ${toText(ast)}`);
    assert.ok(astEqual(parseModelica(toModelica(ast)), ast), `modelica: ${toModelica(ast)}`);
    assert.ok(astEqual(parseSpice(toSpice(ast, nodes)), ast), `spice: ${toSpice(ast, nodes)}`);
  }
});

test('generated forms evaluate to the same value as the tree', () => {
  const scope = { x: 0.7, v: -1.3, k: 2.5, omega: 3, t: 0.25 };
  for (const s of ['-omega^2*x - 2*k*v + sin(omega*t)', '2^3^2*x', '-x^2', 'exp(-k*t)*cos(omega*t)']) {
    const a = parse(s);
    assert.equal(evaluate(parseModelica(toModelica(a)), scope), evaluate(a, scope));
    assert.equal(evaluate(parseSpice(toSpice(a, ['x', 'v'])), scope), evaluate(a, scope));
  }
});

test('T-32: whole generated Modelica models and SPICE netlists read back to the model trees', async () => {
  const { modelToModelica, readModelica, modelToSpice, readSpice } = await import('../docs/src/export.js');
  const dir = new URL('../spec/models/', import.meta.url);
  let n = 0;
  for (const f of fs.readdirSync(dir).sort()) {
    const m = loadYaml(fs.readFileSync(new URL(f, dir), 'utf8'));
    if (m.kind !== 'continuous') continue;
    const mo = readModelica(modelToModelica(m));
    const sp = readSpice(modelToSpice(m));
    for (const e of m.equations) {
      assert.ok(astEqual(mo.der[e.der], parse(e.expression)), `${f}: Modelica der(${e.der})`);
      assert.ok(astEqual(sp.der[e.der], parse(e.expression)), `${f}: SPICE B_${e.der}`);
      n++;
    }
  }
  assert.equal(n, 8, `${n} equations checked`);
});
