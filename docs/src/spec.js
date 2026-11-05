// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Specifications and computational models (CMS-01): YAML loading, structural checks with error paths, the
// canonical hash, and compilation of a continuous model into a derivative function for the integrators.
// The full JSON Schema check is spec/schema/model.schema.json (tools/validate.py); the checks here are the
// ones the core needs to run a model safely, and they run identically in Node.js and the browser.
// YAML is read by js-yaml 5.5.0, vendored under docs/vendor/js-yaml/5.5.0 (admission state: see
// docs/vendor/ADMISSIONS.csv).

import { load as yamlLoad, CORE_SCHEMA } from '../vendor/js-yaml/5.5.0/dist/js-yaml.mjs';
import { SubcoreError } from './errors.js';
import { canonicalJson, sha256Hex } from './hash.js';
import { parse, compile, identifiers, substitute, INDEPENDENT, RESERVED } from './expr.js';
import { toSI, parseUnit } from './units.js';

export const SPEC_VERSION = '1.0.0';

export function loadYaml(text, path = '') {
  try {
    return yamlLoad(text, { schema: CORE_SCHEMA });
  } catch (e) {
    throw new SubcoreError('YAML', path, e.message);
  }
}

// sha256 of the canonical JSON of a document, without its _notice
export function specHash(doc) {
  const { _notice, ...rest } = doc;
  return sha256Hex(canonicalJson(rest));
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Structural checks for a computational model. Returns a list of { code, path, message }; empty when valid.
export function checkModel(m) {
  const errs = [];
  const err = (code, path, message) => errs.push({ code, path, message });
  if (!m || typeof m !== 'object') { err('MODEL', '', 'a model is a mapping'); return errs; }
  const id = m.identity || {};
  if (!id.id) err('MODEL', 'identity.id', 'missing');
  if (!id.version) err('MODEL', 'identity.version', 'missing');
  const kind = m.kind;
  if (!['continuous', 'function', 'discrete', 'quantum'].includes(kind)) err('MODEL', 'kind', `unknown kind '${kind}'`);
  if (kind !== 'continuous' && kind !== 'function') return errs;
  const seen = new Map();
  const declare = (name, path) => {
    if (typeof name !== 'string' || !NAME.test(name)) { err('NAME', path, `'${name}' is not a valid name`); return; }
    if (RESERVED.has(name) || name === INDEPENDENT && path !== 'independent.name') err('NAME', path, `'${name}' is reserved`);
    const low = name.toLowerCase(); // SPICE reads names without regard to case
    if (seen.has(low)) err('NAME', path, `'${name}' clashes with the name at ${seen.get(low)} (names must differ by more than case, since SPICE ignores case)`);
    else seen.set(low, path);
  };
  const unit = (u, path) => {
    if (u === undefined) { err('UNIT', path, 'quantity without a unit (use 1 for dimensionless)'); return; }
    try { parseUnit(u); } catch (e) { err('UNIT', path, e.message); }
  };
  const indep = m.independent || {};
  if (!indep.name) err('MODEL', 'independent.name', 'missing');
  if (kind === 'continuous' && indep.name !== INDEPENDENT) err('MODEL', 'independent.name', `a continuous model's independent variable is '${INDEPENDENT}'`);
  unit(indep.unit, 'independent.unit');
  (m.parameters || []).forEach((p, k) => {
    declare(p.name, `parameters[${k}].name`);
    if (typeof p.value !== 'number' || !Number.isFinite(p.value)) err('VALUE', `parameters[${k}].value`, 'a parameter value is a finite number');
    unit(p.unit, `parameters[${k}].unit`);
  });
  const states = m.states || [];
  states.forEach((s, k) => {
    declare(s.name, `states[${k}].name`);
    unit(s.unit, `states[${k}].unit`);
    if (typeof s.initial !== 'number' || !Number.isFinite(s.initial)) err('VALUE', `states[${k}].initial`, 'an initial value is a finite number');
  });
  (m.inputs || []).forEach((u, k) => { declare(u.name, `inputs[${k}].name`); unit(u.unit, `inputs[${k}].unit`); });
  const known = new Set([indep.name, ...(m.parameters || []).map((p) => p.name), ...states.map((s) => s.name), ...(m.inputs || []).map((u) => u.name)]);
  const checkExpr = (text, path, allowed) => {
    try {
      const ast = parse(text);
      for (const n of identifiers(ast)) if (!allowed.has(n)) err('UNBOUND', path, `name '${n}' is not declared`);
    } catch (e) { err(e.code || 'PARSE', path, e.message); }
  };
  (m.inputs || []).forEach((u, k) => checkExpr(u.expression, `inputs[${k}].expression`,
    new Set([indep.name, ...(m.parameters || []).map((p) => p.name)])));
  if (kind === 'continuous') {
    const eqs = m.equations || [];
    const covered = new Set();
    eqs.forEach((e, k) => {
      if (!states.some((s) => s.name === e.der)) err('EQUATION', `equations[${k}].der`, `'${e.der}' is not a state`);
      if (covered.has(e.der)) err('EQUATION', `equations[${k}].der`, `a second equation for '${e.der}'`);
      covered.add(e.der);
      checkExpr(e.expression, `equations[${k}].expression`, known);
    });
    states.forEach((s, k) => { if (!covered.has(s.name)) err('EQUATION', `states[${k}]`, `state '${s.name}' has no equation`); });
  }
  (m.outputs || []).forEach((o, k) => {
    if (typeof o.name !== 'string' || !NAME.test(o.name)) err('NAME', `outputs[${k}].name`, 'invalid name');
    unit(o.unit, `outputs[${k}].unit`);
    checkExpr(o.expression, `outputs[${k}].expression`, known);
  });
  return errs;
}

function assertModel(m) {
  const errs = checkModel(m);
  if (errs.length) throw new SubcoreError(errs[0].code, errs[0].path, errs[0].message, errs);
}

// Compile a continuous model. Values are converted to SI base units once, here. overrides: { name: SI value }.
// Returns { id, version, hash, stateNames, params, y0, f(t, y, dydt), outputs(t, y) -> number[], outputNames,
//           horizon: { t0, t1 } in SI, defaults }
export function compileModel(m, overrides = {}) {
  assertModel(m);
  if (m.kind !== 'continuous') throw new SubcoreError('MODEL', 'kind', `compileModel needs a continuous model, not ${m.kind}`);
  const stateNames = m.states.map((s) => s.name);
  const params = {};
  for (const p of m.parameters || []) params[p.name] = toSI(p.value, p.unit);
  for (const [k, v] of Object.entries(overrides)) {
    if (!Object.prototype.hasOwnProperty.call(params, k)) throw new SubcoreError('MODEL', `overrides.${k}`, 'not a parameter of the model');
    params[k] = v;
  }
  // env layout: [t, states..., parameters..., inputs...]
  const names = [INDEPENDENT, ...stateNames, ...Object.keys(params), ...(m.inputs || []).map((u) => u.name)];
  const slots = new Map(names.map((n, k) => [n, k]));
  const env = new Float64Array(names.length);
  Object.entries(params).forEach(([k, v]) => { env[slots.get(k)] = v; });
  const ns = stateNames.length;
  const inputs = (m.inputs || []).map((u) => ({ slot: slots.get(u.name), fn: compile(parse(u.expression), slots) }));
  const rhs = new Array(ns);
  for (const e of m.equations) rhs[stateNames.indexOf(e.der)] = compile(parse(e.expression), slots);
  const f = (t, y, dydt) => {
    env[0] = t;
    for (let i = 0; i < ns; i++) env[1 + i] = y[i];
    for (const u of inputs) env[u.slot] = u.fn(env);
    for (let i = 0; i < ns; i++) dydt[i] = rhs[i](env);
  };
  const outs = (m.outputs || []).map((o) => compile(parse(o.expression), slots));
  const outputs = (t, y) => {
    env[0] = t;
    for (let i = 0; i < ns; i++) env[1 + i] = y[i];
    for (const u of inputs) env[u.slot] = u.fn(env);
    return outs.map((g) => g(env));
  };
  const y0 = m.states.map((s) => toSI(s.initial, s.unit));
  const hz = m.horizon || {};
  const horizon = { t0: toSI(hz.t0 ?? 0, hz.unit || 's'), t1: toSI(hz.t1 ?? 0, hz.unit || 's') };
  return {
    id: m.identity.id, version: m.identity.version, hash: specHash(m), stateNames, params, y0, f, outputs,
    outputNames: (m.outputs || []).map((o) => o.name), horizon, defaults: m.solver_defaults || {},
    parameterHash: sha256Hex(canonicalJson(params)),
  };
}

// The analytic oracle of a model (oracle.kind == 'analytic'): its definitions are substituted into its
// solution expressions, which are compiled over t and the parameters. Returns { names, at(t) -> number[] }.
export function analyticSolution(m, overrides = {}) {
  const o = m.oracle;
  if (!o || o.kind !== 'analytic') throw new SubcoreError('MODEL', 'oracle.kind', 'the model has no analytic oracle');
  const params = {};
  for (const p of m.parameters || []) params[p.name] = toSI(p.value, p.unit);
  Object.assign(params, overrides);
  for (const s of m.states || []) params[`${s.name}_0`] = toSI(s.initial, s.unit);
  const defs = {};
  for (const d of o.definitions || []) defs[d.name] = substitute(parse(d.expression), defs);
  const indep = (m.independent && m.independent.name) || INDEPENDENT;
  const names = [indep, ...Object.keys(params)];
  const slots = new Map(names.map((n, k) => [n, k]));
  const env = new Float64Array(names.length);
  Object.entries(params).forEach(([k, v]) => { env[slots.get(k)] = v; });
  const fns = o.solution.map((s) => compile(substitute(parse(s.expression), defs), slots));
  return {
    names: o.solution.map((s) => s.name),
    at(t) { env[0] = t; return fns.map((g) => g(env)); },
  };
}

// The outputs of a function-generation model (kind 'function') as functions of its independent variable.
export function compileFunctions(m) {
  assertModel(m);
  if (m.kind !== 'function') throw new SubcoreError('MODEL', 'kind', `compileFunctions needs a function model, not ${m.kind}`);
  const x = m.independent.name;
  const params = {};
  for (const p of m.parameters || []) params[p.name] = toSI(p.value, p.unit);
  const names = [x, ...Object.keys(params)];
  const slots = new Map(names.map((n, k) => [n, k]));
  const env = new Float64Array(names.length);
  Object.entries(params).forEach(([k, v]) => { env[slots.get(k)] = v; });
  const fns = m.outputs.map((o) => compile(parse(o.expression), slots));
  return { names: m.outputs.map((o) => o.name), at(v) { env[0] = v; return fns.map((g) => g(env)); } };
}
