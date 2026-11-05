// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
// Integrators against analytic solutions (T-34) with the Test Plan section 5 bounds:
//   fixed-step RK4: maximum absolute error over amplitude <= 1e-4 at the configured step;
//   adaptive: maximum relative error <= 1e-7 with an absolute floor of 1e-9, at solver tolerance 1e-10.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { integrateFixed, dopri54, grid, DOPRI, rk4Step } from '../docs/src/solve.js';
import { loadYaml, compileModel, analyticSolution } from '../docs/src/spec.js';

const model = (id) => loadYaml(fs.readFileSync(new URL(`../spec/models/${id}.yaml`, import.meta.url), 'utf8'));
const ANALYTIC = ['exponential-decay', 'harmonic-oscillator', 'damped-driven-oscillator'];

test('Dormand-Prince tableau is consistent (row sums equal c; weights sum to one)', () => {
  for (let i = 1; i < 7; i++) {
    const s = DOPRI.a[i].reduce((x, y) => x + y, 0);
    assert.ok(Math.abs(s - DOPRI.c[i]) < 1e-15, `row ${i}`);
  }
  assert.ok(Math.abs(DOPRI.b.reduce((x, y) => x + y, 0) - 1) < 1e-15);
  assert.ok(Math.abs(DOPRI.bhat.reduce((x, y) => x + y, 0) - 1) < 1e-15);
});

test('RK4 is fourth order: halving the step divides the error by about 16', () => {
  const f = (t, y, d) => { d[0] = y[1]; d[1] = -y[0]; };
  const err = (h) => {
    const r = integrateFixed({ f, y0: [1, 0], h, steps: Math.round(2 / h) });
    return Math.abs(r.y[r.y.length - 1][0] - Math.cos(2));
  };
  const ratio = err(0.02) / err(0.01);
  assert.ok(ratio > 15 && ratio < 17, `ratio ${ratio}`);
});

test('RK4 single step equals the textbook formula on y\' = y', () => {
  const f = (t, y, d) => { d[0] = y[0]; };
  const h = 0.1;
  const out = rk4Step(f, 0, Float64Array.of(1), h, new Float64Array(1));
  const expect = 1 + h + h * h / 2 + h ** 3 / 6 + h ** 4 / 24; // RK4 reproduces the Taylor series to h^4
  assert.ok(Math.abs(out[0] - expect) < 1e-16, `${out[0]} vs ${expect}`);
});

for (const id of ANALYTIC) {
  test(`T-34 ${id}: fixed-step RK4 within 1e-4 of the amplitude`, () => {
    const m = model(id), c = compileModel(m), a = analyticSolution(m);
    const h = c.defaults.rk4_step;
    const r = integrateFixed({ f: c.f, t0: c.horizon.t0, y0: c.y0, h, steps: Math.round((c.horizon.t1 - c.horizon.t0) / h) });
    let amp = 0, err = 0;
    r.t.forEach((t, k) => a.at(t).forEach((v, j) => { amp = Math.max(amp, Math.abs(v)); err = Math.max(err, Math.abs(v - r.y[k][j])); }));
    assert.ok(err / amp <= 1e-4, `max abs error over amplitude ${err / amp}`);
  });
  test(`T-34 ${id}: dopri54 at tolerance 1e-10 within relative 1e-7 (floor 1e-9)`, () => {
    const m = model(id), c = compileModel(m), a = analyticSolution(m);
    const r = dopri54({ f: c.f, t0: c.horizon.t0, y0: c.y0, tOut: grid(c.horizon.t0, c.horizon.t1, 400), rtol: 1e-10, atol: 1e-10 });
    let rel = 0;
    r.t.forEach((t, k) => a.at(t).forEach((v, j) => { rel = Math.max(rel, Math.abs(v - r.y[k][j]) / Math.max(Math.abs(v), 1e-9)); }));
    assert.ok(rel <= 1e-7, `max relative error ${rel}`);
  });
}

test('a non-finite state stops the run with NONFINITE, naming the state and time', () => {
  const f = (t, y, d) => { d[0] = y[0] * y[0]; }; // blows up at t = 1
  assert.throws(() => integrateFixed({ f, y0: [1], h: 0.01, steps: 200, names: ['q'] }),
    (e) => e.code === 'NONFINITE' && e.path === 'q' && e.detail.t > 0.9);
});

test('stiffness shows as step-size collapse, never hidden', () => {
  const f = (t, y, d) => { d[0] = y[0] * y[0]; };
  assert.throws(() => dopri54({ f, y0: [1], tOut: [2], rtol: 1e-10, atol: 1e-12, names: ['q'] }),
    (e) => e.code === 'STEP_COLLAPSE' || e.code === 'NONFINITE');
});

test('dopri54 lands exactly on every output time and records its statistics', () => {
  const f = (t, y, d) => { d[0] = -y[0]; };
  const tOut = grid(0, 3, 7);
  const r = dopri54({ f, y0: [1], tOut });
  assert.deepEqual(r.t, tOut);
  assert.ok(r.stats.accepted > 0 && r.stats.fevals > r.stats.accepted && r.stats.rtol === 1e-10);
});
