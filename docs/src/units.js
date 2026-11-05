// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// UCUM units (The Unified Code for Units of Measure, case-sensitive form c/s), the subset the substrate
// and model specifications use. Quantities are held in SI base units at run time; a UCUM code is converted
// once, at load (Guidelines 5). A code this module does not know raises UNIT with the code as path; it is
// never guessed.
//
// Grammar read here (UCUM section 2, simplified): term := ['/'] component (('.' | '/') component)*
//   component := '(' term ')' [exponent] | atom-with-prefix [exponent] | integer | annotation
//   exponent := ['+' | '-'] digits ; annotation := '{' text '}' (dimensionless, factor 1)

import { SubcoreError } from './errors.js';

// Dimensions, in this order: length, mass, time, electric current, temperature, amount, luminous intensity, plane angle.
// UCUM keeps the radian as a base unit; so does this module, so angles are never silently dropped.
export const DIMENSIONS = ['m', 'kg', 's', 'A', 'K', 'mol', 'cd', 'rad'];

const D = (o) => DIMENSIONS.map((k) => o[k] || 0);

// factor: value of one unit in SI base units (kilogram, not gram)
const ATOMS = {
  // base units (UCUM section 4.2) with the gram's factor expressed in kilograms
  m: { f: 1, d: D({ m: 1 }), metric: true },
  s: { f: 1, d: D({ s: 1 }), metric: true },
  g: { f: 1e-3, d: D({ kg: 1 }), metric: true },
  rad: { f: 1, d: D({ rad: 1 }), metric: true },
  K: { f: 1, d: D({ K: 1 }), metric: true },
  C: { f: 1, d: D({ A: 1, s: 1 }), metric: true },
  cd: { f: 1, d: D({ cd: 1 }), metric: true },
  // derived SI units (UCUM table 6)
  mol: { f: 1, d: D({ mol: 1 }), metric: true },
  sr: { f: 1, d: D({ rad: 2 }), metric: true },
  Hz: { f: 1, d: D({ s: -1 }), metric: true },
  N: { f: 1, d: D({ kg: 1, m: 1, s: -2 }), metric: true },
  Pa: { f: 1, d: D({ kg: 1, m: -1, s: -2 }), metric: true },
  J: { f: 1, d: D({ kg: 1, m: 2, s: -2 }), metric: true },
  W: { f: 1, d: D({ kg: 1, m: 2, s: -3 }), metric: true },
  A: { f: 1, d: D({ A: 1 }), metric: true },
  V: { f: 1, d: D({ kg: 1, m: 2, s: -3, A: -1 }), metric: true },
  F: { f: 1, d: D({ kg: -1, m: -2, s: 4, A: 2 }), metric: true },
  Ohm: { f: 1, d: D({ kg: 1, m: 2, s: -3, A: -2 }), metric: true },
  S: { f: 1, d: D({ kg: -1, m: -2, s: 3, A: 2 }), metric: true },
  Wb: { f: 1, d: D({ kg: 1, m: 2, s: -2, A: -1 }), metric: true },
  T: { f: 1, d: D({ kg: 1, s: -2, A: -1 }), metric: true },
  H: { f: 1, d: D({ kg: 1, m: 2, s: -2, A: -2 }), metric: true },
  Cel: { f: 1, d: D({ K: 1 }), metric: true, offset: 273.15 },
  l: { f: 1e-3, d: D({ m: 3 }), metric: true },
  L: { f: 1e-3, d: D({ m: 3 }), metric: true },
  t: { f: 1e3, d: D({ kg: 1 }), metric: true },
  eV: { f: 1.602176634e-19, d: D({ kg: 1, m: 2, s: -2 }), metric: true },
  bit: { f: 1, d: D({}), metric: true },
  By: { f: 8, d: D({}), metric: true },
  // non-metric units (UCUM tables 7 and following)
  min: { f: 60, d: D({ s: 1 }) },
  h: { f: 3600, d: D({ s: 1 }) },
  d: { f: 86400, d: D({ s: 1 }) },
  deg: { f: Math.PI / 180, d: D({ rad: 1 }) },
  circ: { f: 2 * Math.PI, d: D({ rad: 1 }) },
  '%': { f: 1e-2, d: D({}) },
  '[ppm]': { f: 1e-6, d: D({}) },
  '[in_i]': { f: 0.0254, d: D({ m: 1 }) },
  '[pi]': { f: Math.PI, d: D({}) },
};

const PREFIXES = {
  Y: 1e24, Z: 1e21, E: 1e18, P: 1e15, T: 1e12, G: 1e9, M: 1e6, k: 1e3, h: 1e2, da: 1e1,
  d: 1e-1, c: 1e-2, m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15, a: 1e-18, z: 1e-21, y: 1e-24,
};

export const UNIT_ATOMS = Object.freeze(Object.keys(ATOMS));

function atom(sym, code) {
  if (Object.prototype.hasOwnProperty.call(ATOMS, sym)) return { ...ATOMS[sym], sym };
  for (const p of ['da', ...Object.keys(PREFIXES).filter((k) => k.length === 1)]) {
    if (sym.startsWith(p)) {
      const rest = sym.slice(p.length);
      const a = Object.prototype.hasOwnProperty.call(ATOMS, rest) ? ATOMS[rest] : null;
      if (a && a.metric) return { ...a, f: a.f * PREFIXES[p], sym };
    }
  }
  throw new SubcoreError('UNIT', code, `unknown UCUM unit symbol '${sym}'`);
}

const cache = new Map();

// Returns { code, factor, offset, dim: number[8], dimensionless }
export function parseUnit(code) {
  if (typeof code !== 'string' || code.length === 0) {
    throw new SubcoreError('UNIT', String(code), 'a unit must be a non-empty UCUM code (use 1 for dimensionless)');
  }
  if (cache.has(code)) return cache.get(code);
  let i = 0;
  const s = code;
  const fail = (msg) => { throw new SubcoreError('UNIT', code, `${msg} at character ${i}`); };

  function exponent() {
    const m = /^[+-]?\d+/.exec(s.slice(i));
    if (!m) return 1;
    i += m[0].length;
    return parseInt(m[0], 10);
  }
  function component() {
    if (s[i] === '(') {
      i++;
      const r = term();
      if (s[i] !== ')') fail("expected ')'");
      i++;
      return power(r, exponent());
    }
    if (s[i] === '{') {
      const j = s.indexOf('}', i);
      if (j < 0) fail("unclosed '{'");
      i = j + 1;
      return { f: 1, d: D({}), offset: 0 };
    }
    if (/\d/.test(s[i])) {
      const m = /^\d+/.exec(s.slice(i));
      // a bare integer is a factor (UCUM 2.2.2), unless an exponent context makes it one; here it is a factor
      i += m[0].length;
      return { f: parseInt(m[0], 10), d: D({}), offset: 0 };
    }
    let m;
    if (s[i] === '[') {
      const j = s.indexOf(']', i);
      if (j < 0) fail("unclosed '['");
      m = s.slice(i, j + 1);
    } else {
      const r = /^[A-Za-z%]+/.exec(s.slice(i));
      if (!r) fail('expected a unit symbol');
      m = r[0];
    }
    i += m.length;
    const a = atom(m, code);
    let e = exponent();
    if (s[i] === '{') component(); // annotation directly after a symbol
    return power({ f: a.f, d: a.d.slice(), offset: a.offset || 0 }, e);
  }
  function power(r, e) {
    if (e === 1) return r;
    if (r.offset) fail('a unit with an offset (Cel) cannot carry an exponent');
    return { f: Math.pow(r.f, e), d: r.d.map((x) => x * e), offset: 0 };
  }
  function combine(a, b, sign) {
    if (a.offset || b.offset) fail('a unit with an offset (Cel) cannot be combined with another');
    return { f: sign > 0 ? a.f * b.f : a.f / b.f, d: a.d.map((x, k) => x + sign * b.d[k]), offset: 0 };
  }
  function term() {
    let r;
    if (s[i] === '/') { i++; r = combine({ f: 1, d: D({}), offset: 0 }, component(), -1); }
    else r = component();
    while (i < s.length && (s[i] === '.' || s[i] === '/')) {
      const op = s[i++];
      r = combine(r, component(), op === '.' ? 1 : -1);
    }
    return r;
  }
  const r = term();
  if (i !== s.length) fail(`unexpected '${s[i]}'`);
  const out = Object.freeze({
    code, factor: r.f, offset: r.offset || 0, dim: Object.freeze(r.d),
    dimensionless: r.d.every((x) => x === 0),
  });
  cache.set(code, out);
  return out;
}

export function isUnitCode(code) {
  try { parseUnit(code); return true; } catch (e) { return false; }
}

// value in the given unit to SI base units
export function toSI(value, code) {
  const u = parseUnit(code);
  return value * u.factor + u.offset;
}

// value in SI base units to the given unit
export function fromSI(value, code) {
  const u = parseUnit(code);
  return (value - u.offset) / u.factor;
}

export function sameDimension(a, b) {
  const ua = parseUnit(a), ub = parseUnit(b);
  return ua.dim.every((x, k) => x === ub.dim[k]);
}

export function convert(value, from, to) {
  if (!sameDimension(from, to)) {
    throw new SubcoreError('UNIT', `${from}->${to}`, `cannot convert ${from} (${dimensionString(from)}) to ${to} (${dimensionString(to)})`);
  }
  return fromSI(toSI(value, from), to);
}

// The dimension as a UCUM-style product of SI base units, for messages and records: 'kg.m2.s-2'; '1' if none.
export function dimensionString(code) {
  const u = parseUnit(code);
  const parts = DIMENSIONS.map((k, j) => (u.dim[j] === 0 ? '' : u.dim[j] === 1 ? k : `${k}${u.dim[j]}`)).filter(Boolean);
  return parts.length ? parts.join('.') : '1';
}
