// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Integrators for y' = f(t, y) (Guidelines 7).
//   rk4Step, integrateFixed:  classical fixed-step fourth-order Runge-Kutta, for parity vectors and
//                             interactive runs. Byte-identical between Node.js and Chromium (one engine).
//   dopri54:                  adaptive Dormand-Prince 5(4) (Dormand and Prince 1980, J. Comput. Appl. Math.
//                             6(1):19-26), FSAL, local extrapolation, error control in the scaled RMS norm
//                             (Hairer, Norsett and Wanner, Solving ODEs I, section II.4), output at requested
//                             times by landing steps on them. Written here because math.js 15.2.0 (whose
//                             solveODE also offers RK45) is not admitted: it is pending BURP (P9.1), and its ES
//                             modules import npm packages by bare name that are not vendored.
//
// The derivative function has the signature f(t, y, dydt): it reads y (a Float64Array) and writes dydt.
// Every step checks finiteness; a non-finite value stops the run with NONFINITE naming the state and time.
// Stiffness shows as step-size collapse (STEP_COLLAPSE), never hidden by a looser tolerance.

import { SubcoreError } from './errors.js';

export const SOLVER_VERSION = '1.0.0';

function checkFinite(y, t, names, where) {
  for (let i = 0; i < y.length; i++) {
    if (!Number.isFinite(y[i])) {
      const n = names && names[i] !== undefined ? names[i] : `y[${i}]`;
      throw new SubcoreError('NONFINITE', n, `${where}: state ${n} is ${y[i]} at t=${t}`, { t, index: i, value: y[i] });
    }
  }
}

// Workspace for rk4Step, so a run allocates nothing per step.
export function rk4Work(n) {
  return { k1: new Float64Array(n), k2: new Float64Array(n), k3: new Float64Array(n), k4: new Float64Array(n), tmp: new Float64Array(n) };
}

// One classical RK4 step from (t, y) with step h; writes the result into out (may be y itself).
//   k1 = f(t, y); k2 = f(t + h/2, y + h/2 k1); k3 = f(t + h/2, y + h/2 k2); k4 = f(t + h, y + h k3)
//   y1 = y + h/6 (k1 + 2 k2 + 2 k3 + k4)
export function rk4Step(f, t, y, h, out, w = rk4Work(y.length)) {
  const n = y.length, { k1, k2, k3, k4, tmp } = w;
  const h2 = h / 2;
  f(t, y, k1);
  for (let i = 0; i < n; i++) tmp[i] = y[i] + h2 * k1[i];
  f(t + h2, tmp, k2);
  for (let i = 0; i < n; i++) tmp[i] = y[i] + h2 * k2[i];
  f(t + h2, tmp, k3);
  for (let i = 0; i < n; i++) tmp[i] = y[i] + h * k3[i];
  f(t + h, tmp, k4);
  const h6 = h / 6;
  for (let i = 0; i < n; i++) out[i] = y[i] + h6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  return out;
}

// Fixed-step integration from t0 over `steps` steps of size h. Time is computed as t0 + k h, never
// accumulated. Returns { t: number[], y: Float64Array[] } with every `every`-th point (and the last).
// opts: { f, t0, y0, h, steps, every = 1, names, onStep(t, y, k) }
export function integrateFixed(opts) {
  const { f, t0 = 0, h, steps, every = 1, names, onStep } = opts;
  if (!(h > 0) || !Number.isFinite(h)) throw new SubcoreError('SOLVER', 'h', `step must be positive and finite, got ${h}`);
  if (!Number.isInteger(steps) || steps < 0) throw new SubcoreError('SOLVER', 'steps', `steps must be a non-negative integer, got ${steps}`);
  const y = Float64Array.from(opts.y0);
  checkFinite(y, t0, names, 'initial state');
  const w = rk4Work(y.length);
  const ts = [t0], ys = [Float64Array.from(y)];
  for (let k = 1; k <= steps; k++) {
    const t = t0 + (k - 1) * h;
    rk4Step(f, t, y, h, y, w);
    const tn = t0 + k * h;
    checkFinite(y, tn, names, 'rk4');
    if (onStep) onStep(tn, y, k);
    if (k % every === 0 || k === steps) { ts.push(tn); ys.push(Float64Array.from(y)); }
  }
  return { t: ts, y: ys, stats: { steps, fevals: 4 * steps, h } };
}

// Dormand-Prince 5(4) tableau (Dormand and Prince 1980, table 2; Hairer, Norsett and Wanner, table II.5.2).
export const DOPRI = Object.freeze({
  c: [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1],
  a: [
    [],
    [1 / 5],
    [3 / 40, 9 / 40],
    [44 / 45, -56 / 15, 32 / 9],
    [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
    [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
    [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84],
  ],
  b: [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0],
  bhat: [5179 / 57600, 0, 7571 / 16695, 393 / 640, -92097 / 339200, 187 / 2100, 1 / 40],
});

// Adaptive integration to each time in tOut (increasing, the first >= t0).
// opts: { f, t0, y0, tOut, rtol = 1e-10, atol = 1e-12, h0, hmax = Infinity, hminFactor = 1e-14,
//         maxSteps = 1e7, names }
// Returns { t: number[], y: Float64Array[], stats: { steps, accepted, rejected, fevals, hminUsed, hmaxUsed, rtol, atol } }
export function dopri54(opts) {
  const { f, t0 = 0, tOut, rtol = 1e-10, atol = 1e-12, hmax = Infinity, hminFactor = 1e-14, maxSteps = 1e7, names } = opts;
  if (!(rtol > 0) || !(atol >= 0)) throw new SubcoreError('SOLVER', 'tolerance', 'rtol must be positive and atol non-negative');
  const n = opts.y0.length;
  const { c, a, b, bhat } = DOPRI;
  const e = b.map((x, i) => x - bhat[i]);
  let t = t0;
  const y = Float64Array.from(opts.y0);
  checkFinite(y, t, names, 'initial state');
  const K = Array.from({ length: 7 }, () => new Float64Array(n));
  const ytmp = new Float64Array(n), ynew = new Float64Array(n), err = new Float64Array(n);
  const stats = { steps: 0, accepted: 0, rejected: 0, fevals: 0, hminUsed: Infinity, hmaxUsed: 0, rtol, atol };
  const scaledNorm = (v, y0, y1) => {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const sc = atol + rtol * Math.max(Math.abs(y0[i]), Math.abs(y1[i]));
      const q = v[i] / sc;
      s += q * q;
    }
    return Math.sqrt(s / n);
  };
  f(t, y, K[0]); stats.fevals++;
  // starting step (Hairer, Norsett and Wanner, section II.4, algorithm for the initial step size)
  let h = opts.h0;
  const tEnd = tOut.length ? tOut[tOut.length - 1] : t0;
  if (!h) {
    const d0 = scaledNorm(y, y, y), d1 = scaledNorm(K[0], y, y);
    let h0 = d0 < 1e-5 || d1 < 1e-5 ? 1e-6 : 0.01 * (d0 / d1);
    h0 = Math.min(h0, Math.abs(tEnd - t0) || h0);
    for (let i = 0; i < n; i++) ytmp[i] = y[i] + h0 * K[0][i];
    f(t + h0, ytmp, K[1]); stats.fevals++;
    for (let i = 0; i < n; i++) err[i] = (K[1][i] - K[0][i]) / h0;
    const d2 = scaledNorm(err, y, y);
    const h1 = Math.max(d1, d2) <= 1e-15 ? Math.max(1e-6, h0 * 1e-3) : Math.pow(0.01 / Math.max(d1, d2), 1 / 5);
    h = Math.min(100 * h0, h1);
  }
  h = Math.min(h, hmax);
  const ts = [], ys = [];
  let oi = 0;
  while (oi < tOut.length && tOut[oi] <= t) { ts.push(tOut[oi]); ys.push(Float64Array.from(y)); oi++; }
  while (oi < tOut.length) {
    if (stats.steps >= maxSteps) throw new SubcoreError('MAX_STEPS', 'dopri54', `more than ${maxSteps} steps before t=${tOut[oi]}`);
    const target = tOut[oi];
    let hs = Math.min(h, hmax);
    let land = false;
    if (t + hs >= target) { hs = target - t; land = true; }
    const hmin = hminFactor * Math.max(Math.abs(t), 1);
    if (hs < hmin && !land) {
      throw new SubcoreError('STEP_COLLAPSE', names ? names.join(',') : 'dopri54',
        `step size ${hs} fell below ${hmin} at t=${t}: the problem is stiff or singular here`, { t, h: hs });
    }
    for (let s = 1; s < 7; s++) {
      for (let i = 0; i < n; i++) {
        let acc = y[i];
        for (let j = 0; j < s; j++) acc += hs * a[s][j] * K[j][i];
        ytmp[i] = acc;
      }
      f(t + c[s] * hs, ytmp, K[s]); stats.fevals++;
    }
    // K[6] was evaluated at the fifth-order solution (row 7 of a equals b): ytmp holds it
    for (let i = 0; i < n; i++) {
      ynew[i] = ytmp[i];
      let s = 0;
      for (let j = 0; j < 7; j++) s += e[j] * K[j][i];
      err[i] = hs * s;
    }
    stats.steps++;
    const en = scaledNorm(err, y, ynew);
    const fac = en === 0 ? 5 : Math.min(5, Math.max(0.2, 0.9 * Math.pow(en, -1 / 5)));
    if (en <= 1) {
      checkFinite(ynew, t + hs, names, 'dopri54');
      t = land ? target : t + hs;
      y.set(ynew);
      K[0].set(K[6]); // FSAL
      stats.accepted++;
      stats.hminUsed = Math.min(stats.hminUsed, hs);
      stats.hmaxUsed = Math.max(stats.hmaxUsed, hs);
      if (!land) h = hs * fac;
      while (oi < tOut.length && tOut[oi] <= t) { ts.push(tOut[oi]); ys.push(Float64Array.from(y)); oi++; }
    } else {
      if (!Number.isFinite(en)) h = hs * 0.2; else h = hs * Math.max(0.2, 0.9 * Math.pow(en, -1 / 5));
      stats.rejected++;
    }
  }
  return { t: ts, y: ys, stats };
}

// A uniform grid of output times t0, t0 + dt, ..., t1 (computed as t0 + k dt).
export function grid(t0, t1, n) {
  const out = [];
  for (let k = 0; k <= n; k++) out.push(k === n ? t1 : t0 + (k * (t1 - t0)) / n);
  return out;
}
