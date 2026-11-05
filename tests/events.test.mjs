// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
// Event location by bisection to within 1e-12 of the step (Guidelines 7).
import test from 'node:test';
import assert from 'node:assert/strict';
import { bisect, integrateWithEvents } from '../docs/src/events.js';
import { rk4Step } from '../docs/src/solve.js';

test('bisection closes the bracket to 1e-12 of the step', () => {
  const f = (t, y, d) => { d[0] = 1; };
  const g = (t, y) => y[0] - 0.3141592653589793;
  const r = bisect(g, 0, Float64Array.of(0), 1, (dt) => rk4Step(f, 0, Float64Array.of(0), dt, new Float64Array(1)));
  assert.ok(r.t - r.tLow <= 1e-12, `width ${r.t - r.tLow}`);
  assert.ok(Math.abs(r.t - 0.3141592653589793) <= 1e-12);
});

test('a falling ball bounces at the analytic times (restart from the event)', () => {
  const gacc = 9.81, h0 = 10, e = 0.5;
  const f = (t, y, d) => { d[0] = y[1]; d[1] = -gacc; };
  const r = integrateWithEvents({
    f, y0: [h0, 0], h: 0.05, steps: 80,
    events: [{ name: 'ground', g: (t, y) => y[0], direction: 'falling', action: (t, y) => ({ y: [0, -e * y[1]] }) }],
  });
  const t1 = Math.sqrt(2 * h0 / gacc);
  const v1 = gacc * t1;
  const t2 = t1 + 2 * e * v1 / gacc;
  assert.ok(r.events.length >= 2);
  assert.ok(Math.abs(r.events[0].t - t1) < 1e-9, `first ${r.events[0].t} vs ${t1}`);
  assert.ok(Math.abs(r.events[1].t - t2) < 1e-9, `second ${r.events[1].t} vs ${t2}`);
  // the output grid is unchanged by the events
  r.t.forEach((t, k) => assert.ok(Math.abs(t - k * 0.05) < 1e-12));
});

test('an event can stop the run', () => {
  const f = (t, y, d) => { d[0] = 1; };
  const r = integrateWithEvents({ f, y0: [0], h: 0.1, steps: 100, events: [{ name: 'limit', g: (t, y) => y[0] - 1.234, action: () => ({ stop: true }) }] });
  assert.ok(r.stopped);
  assert.ok(Math.abs(r.t[r.t.length - 1] - 1.234) < 1e-12);
});
