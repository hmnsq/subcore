// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Event location (Guidelines 7): comparator switching, overloads, detents, carries and mode changes are
// located by bisection on the event function to within 1e-12 of the step, and integration restarts from
// the event. The state inside a step is recomputed by one RK4 sub-step from the step's start, so the
// located state is consistent with the integrator.

import { SubcoreError } from './errors.js';
import { rk4Step, rk4Work } from './solve.js';

export const EVENTS_VERSION = '1.0.0';

function crossed(ga, gb, direction) {
  if (direction === 'rising') return ga < 0 && gb >= 0;
  if (direction === 'falling') return ga > 0 && gb <= 0;
  return (ga < 0 && gb >= 0) || (ga > 0 && gb <= 0);
}

// Bisection on g between (ta, ya) and tb. advance(dt) returns the state at ta + dt.
// Returns { t, y, tLow, iterations } where t is the first bracketing time at or after the crossing,
// and t - tLow <= tol * (tb - ta).
export function bisect(g, ta, ya, tb, advance, { tol = 1e-12, direction = 'both', maxIter = 200 } = {}) {
  let lo = ta, hi = tb;
  const ga = g(ta, ya);
  let yhi = advance(tb - ta);
  const gb = g(tb, yhi);
  if (!crossed(ga, gb, direction)) throw new SubcoreError('EVENT', 'bisect', `no sign change of the event function between t=${ta} and t=${tb}`);
  const width = (tb - ta) * tol;
  let it = 0;
  while (hi - lo > width && it < maxIter) {
    const mid = lo + (hi - lo) / 2;
    if (mid <= lo || mid >= hi) break; // no representable midpoint left
    const ym = advance(mid - ta);
    const gm = g(mid, ym);
    if (crossed(ga, gm, direction)) { hi = mid; yhi = ym; } else lo = mid;
    it++;
  }
  return { t: hi, y: yhi, tLow: lo, iterations: it };
}

// Fixed-step RK4 with events. Each event: { name, g(t, y), direction: 'rising'|'falling'|'both',
// action(t, y) -> undefined | { y?: array, stop?: boolean } }. After an event the step is completed from the
// event time to the grid point, so the output grid is unchanged; later events in the same step are found too.
// Returns { t, y, events: [{ name, t, y }], stopped }.
export function integrateWithEvents(opts) {
  const { f, t0 = 0, h, steps, events = [], names, tol = 1e-12, every = 1 } = opts;
  const n = opts.y0.length;
  const w = rk4Work(n);
  const y = Float64Array.from(opts.y0);
  const ts = [t0], ys = [Float64Array.from(y)], log = [];
  const ystart = new Float64Array(n), yend = new Float64Array(n);
  let stopped = false;
  for (let k = 1; k <= steps && !stopped; k++) {
    let t = t0 + (k - 1) * h;
    const tn = t0 + k * h;
    for (let guard = 0; guard < 1000; guard++) {
      ystart.set(y);
      const dt = tn - t;
      rk4Step(f, t, ystart, dt, yend, w);
      for (let i = 0; i < n; i++) {
        if (!Number.isFinite(yend[i])) {
          const nm = names ? names[i] : `y[${i}]`;
          throw new SubcoreError('NONFINITE', nm, `state ${nm} is ${yend[i]} at t=${tn}`, { t: tn, index: i });
        }
      }
      let first = null;
      for (const ev of events) {
        if (crossed(ev.g(t, ystart), ev.g(tn, yend), ev.direction || 'both')) {
          const tStart = t, y0 = Float64Array.from(ystart);
          const r = bisect(ev.g, tStart, y0, tn, (d) => rk4Step(f, tStart, y0, d, new Float64Array(n), w), { tol, direction: ev.direction || 'both' });
          if (!first || r.t < first.r.t) first = { ev, r };
        }
      }
      if (!first) { y.set(yend); break; }
      const { ev, r } = first;
      y.set(r.y);
      t = r.t;
      const rec = { name: ev.name, t, y: Array.from(y) };
      const res = ev.action ? ev.action(t, y) : undefined;
      if (res && res.y) y.set(res.y);
      rec.yAfter = Array.from(y);
      log.push(rec);
      if (res && res.stop) { stopped = true; ts.push(t); ys.push(Float64Array.from(y)); break; }
      if (t >= tn) break;
    }
    if (!stopped && (k % every === 0 || k === steps)) { ts.push(tn); ys.push(Float64Array.from(y)); }
  }
  return { t: ts, y: ys, events: log, stopped };
}
