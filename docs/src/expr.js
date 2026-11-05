// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// The restricted expression grammar (CMS-02), defined once in spec/grammar/expr.ebnf, with its one parser,
// an evaluator built from closures (no eval, no new Function), and generators to Modelica equations and
// SPICE behavioural expressions together with parsers that read those forms back, so that
// parse(text) and parseModelica(toModelica(ast)) and parseSpice(toSpice(ast)) give the same syntax tree.
//
// Syntax tree nodes (plain objects, JSON-serialisable):
//   { type: 'num', value }            a non-negative finite number literal
//   { type: 'ident', name }           a variable or parameter; 't' is the independent variable (time)
//   { type: 'neg', arg }              unary minus
//   { type: 'bin', op, left, right }  op is one of + - * / ^
//   { type: 'call', fn, args }        fn is one of FUNCTIONS
// Precedence, lowest first: + - (left), * / (left), unary -, ^ (right; its exponent may carry a unary minus).

import { SubcoreError } from './errors.js';
import { canonicalJson } from './hash.js';

export const GRAMMAR_VERSION = '1.0.0';

// name: [arity, implementation, Modelica name, SPICE (ngspice B-source) name]
const FN = {
  sin: [1, Math.sin, 'sin', 'sin'],
  cos: [1, Math.cos, 'cos', 'cos'],
  tan: [1, Math.tan, 'tan', 'tan'],
  asin: [1, Math.asin, 'asin', 'asin'],
  acos: [1, Math.acos, 'acos', 'acos'],
  atan: [1, Math.atan, 'atan', 'atan'],
  sinh: [1, Math.sinh, 'sinh', 'sinh'],
  cosh: [1, Math.cosh, 'cosh', 'cosh'],
  tanh: [1, Math.tanh, 'tanh', 'tanh'],
  exp: [1, Math.exp, 'exp', 'exp'],
  log: [1, Math.log, 'log', 'ln'],          // natural logarithm; ngspice's ln (its log is also natural)
  log10: [1, Math.log10, 'log10', 'log10'],
  sqrt: [1, Math.sqrt, 'sqrt', 'sqrt'],
  abs: [1, Math.abs, 'abs', 'abs'],
  sign: [1, Math.sign, 'sign', 'sgn'],
  min: [2, Math.min, 'min', 'min'],
  max: [2, Math.max, 'max', 'max'],
};
export const FUNCTIONS = Object.freeze(Object.keys(FN));

// Words that cannot name a variable: the functions, Modelica's reserved words, and the names the generated
// forms use for time.
export const RESERVED = Object.freeze(new Set([
  ...FUNCTIONS, 'time', 'der', 'ln', 'sgn',
  'algorithm', 'and', 'annotation', 'block', 'break', 'class', 'connect', 'connector', 'constant', 'constrainedby',
  'der', 'discrete', 'each', 'else', 'elseif', 'elsewhen', 'encapsulated', 'end', 'enumeration', 'equation', 'expandable',
  'extends', 'external', 'false', 'final', 'flow', 'for', 'function', 'if', 'import', 'impure', 'in', 'initial', 'inner',
  'input', 'loop', 'model', 'not', 'operator', 'or', 'outer', 'output', 'package', 'parameter', 'partial', 'protected',
  'public', 'pure', 'record', 'redeclare', 'replaceable', 'return', 'stream', 'then', 'true', 'type', 'when', 'while', 'within',
  'Real', 'Integer', 'Boolean', 'String',
]));

export const INDEPENDENT = 't';

// ---------------------------------------------------------------- tokens

const NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*/;

function tokenize(text, dialect) {
  const toks = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    let m;
    if ((m = NUMBER.exec(text.slice(i)))) {
      toks.push({ k: 'num', v: m[0], pos: i });
      i += m[0].length;
      if (IDENT.test(text.slice(i))) {
        throw new SubcoreError('PARSE', `${dialect}:${i}`, `a number is followed directly by a name ('${text.slice(i - m[0].length, i + 3)}')`);
      }
      continue;
    }
    if ((m = IDENT.exec(text.slice(i)))) { toks.push({ k: 'id', v: m[0], pos: i }); i += m[0].length; continue; }
    if (dialect === 'spice' && text.startsWith('**', i)) { toks.push({ k: 'op', v: '^', pos: i }); i += 2; continue; }
    const ops = dialect === 'spice' ? '+-*/^(),{}' : '+-*/^(),';
    if (ops.includes(c)) { toks.push({ k: 'op', v: c, pos: i }); i++; continue; }
    throw new SubcoreError('PARSE', `${dialect}:${i}`, `unexpected character '${c}'`);
  }
  toks.push({ k: 'end', v: '', pos: text.length });
  return toks;
}

// ---------------------------------------------------------------- parser (recursive descent, one per grammar rule)

function makeParser(text, dialect) {
  const toks = tokenize(text, dialect);
  let p = 0;
  const peek = () => toks[p];
  const fail = (msg, t = peek()) => { throw new SubcoreError('PARSE', `${dialect}:${t.pos}`, msg); };
  const accept = (v) => { if (peek().k === 'op' && peek().v === v) { p++; return true; } return false; };
  const expect = (v) => { if (!accept(v)) fail(`expected '${v}' but found '${peek().v || 'end of input'}'`); };

  // expression = term { ("+" | "-") term }
  function expression() {
    let left = term();
    for (;;) {
      if (accept('+')) left = { type: 'bin', op: '+', left, right: term() };
      else if (accept('-')) left = { type: 'bin', op: '-', left, right: term() };
      else return left;
    }
  }
  // term = unary { ("*" | "/") unary }
  function term() {
    let left = unary();
    for (;;) {
      if (accept('*')) left = { type: 'bin', op: '*', left, right: unary() };
      else if (accept('/')) left = { type: 'bin', op: '/', left, right: unary() };
      else return left;
    }
  }
  // unary = "-" unary | power
  function unary() {
    if (accept('-')) return { type: 'neg', arg: unary() };
    return power();
  }
  // power = primary [ "^" unary ]
  function power() {
    const base = primary();
    if (accept('^')) return { type: 'bin', op: '^', left: base, right: unary() };
    return base;
  }
  function identName(t) {
    if (dialect !== 'expr' && t.v === 'time') return INDEPENDENT;
    if (RESERVED.has(t.v)) fail(`'${t.v}' is reserved and cannot name a variable`, t);
    return t.v;
  }
  // primary = number | call | identifier | "(" expression ")"
  //   SPICE form also: "v" "(" identifier ")" | "{" identifier "}"
  function primary() {
    const t = peek();
    if (t.k === 'num') {
      p++;
      const value = Number(t.v);
      if (!Number.isFinite(value)) fail(`number '${t.v}' is not finite`, t);
      return { type: 'num', value };
    }
    if (t.k === 'op' && t.v === '(') { p++; const e = expression(); expect(')'); return e; }
    if (dialect === 'spice' && t.k === 'op' && t.v === '{') {
      p++;
      const id = peek();
      if (id.k !== 'id') fail('expected a parameter name inside { }');
      p++;
      expect('}');
      return { type: 'ident', name: identName(id) };
    }
    if (t.k === 'id') {
      p++;
      if (dialect === 'spice' && (t.v === 'v' || t.v === 'V') && peek().v === '(') {
        p++;
        const id = peek();
        if (id.k !== 'id') fail('expected a node name inside v( )');
        p++;
        expect(')');
        return { type: 'ident', name: identName(id) };
      }
      let fn = null;
      if (dialect === 'spice') fn = Object.keys(FN).find((k) => FN[k][3] === t.v) || null;
      else if (dialect === 'modelica') fn = Object.keys(FN).find((k) => FN[k][2] === t.v) || null;
      else fn = Object.prototype.hasOwnProperty.call(FN, t.v) ? t.v : null;
      if (fn) {
        if (!accept('(')) fail(`function '${t.v}' must be called with arguments`, t);
        const args = [expression()];
        while (accept(',')) args.push(expression());
        expect(')');
        if (args.length !== FN[fn][0]) fail(`function '${fn}' takes ${FN[fn][0]} argument(s), given ${args.length}`, t);
        return { type: 'call', fn, args };
      }
      if (peek().k === 'op' && peek().v === '(') fail(`unknown function '${t.v}'`, t);
      return { type: 'ident', name: identName(t) };
    }
    fail(`expected a number, a name or '(' but found '${t.v || 'end of input'}'`);
  }
  return {
    parseAll() {
      const e = expression();
      if (peek().k !== 'end') fail(`unexpected '${peek().v}' after the expression`);
      return e;
    },
  };
}

export function parse(text) { return makeParser(String(text), 'expr').parseAll(); }
export function parseModelica(text) { return makeParser(String(text), 'modelica').parseAll(); }
export function parseSpice(text) { return makeParser(String(text), 'spice').parseAll(); }

// ---------------------------------------------------------------- printing

function numText(x) {
  if (!Number.isFinite(x) || x < 0) throw new SubcoreError('PRINT', String(x), 'a literal must be finite and non-negative');
  return String(x);
}

// One printer; dialects differ only in how names, time and functions are spelt. Parentheses are placed so
// that every dialect reads the tree back unchanged: a compound operand of ^ is always parenthesised
// (ngspice reads ^ left to right, Modelica forbids a^b^c), and a negation used as an operand is
// parenthesised (Modelica allows a leading minus only at the start of an expression).
function printer(dialect, opts = {}) {
  const nodes = opts.nodes || null; // SPICE: names written v(name); every other name is written {name}
  const name = (n) => {
    if (n === INDEPENDENT) return dialect === 'expr' ? 't' : 'time';
    if (dialect === 'spice') return nodes && nodes.has(n) ? `v(${n})` : `{${n}}`;
    return n;
  };
  const fname = (f) => (dialect === 'spice' ? FN[f][3] : dialect === 'modelica' ? FN[f][2] : f);
  function pr(e, ctx) {
    switch (e.type) {
      case 'num': return numText(e.value);
      case 'ident': return name(e.name);
      case 'call': return `${fname(e.fn)}(${e.args.map((a) => pr(a, 'top')).join(', ')})`;
      case 'neg': {
        const inner = e.arg.type === 'num' || e.arg.type === 'ident' || e.arg.type === 'call' ? pr(e.arg, 'x') : `(${pr(e.arg, 'top')})`;
        return ctx === 'top' ? `-${inner}` : `(-${inner})`;
      }
      case 'bin': {
        const { op, left, right } = e;
        const isAdd = (n) => n.type === 'bin' && (n.op === '+' || n.op === '-');
        const isMul = (n) => n.type === 'bin' && (n.op === '*' || n.op === '/');
        const wrap = (n, need) => (need ? `(${pr(n, 'top')})` : pr(n, 'operand'));
        let l, r;
        if (op === '+' || op === '-') {
          l = wrap(left, false);
          r = wrap(right, isAdd(right));
        } else if (op === '*' || op === '/') {
          l = wrap(left, isAdd(left));
          r = wrap(right, isAdd(right) || isMul(right));
        } else if (op === '^') {
          l = wrap(left, left.type === 'bin' || left.type === 'neg');
          r = wrap(right, right.type === 'bin' || right.type === 'neg');
        } else throw new SubcoreError('PRINT', op, 'unknown operator');
        const s = op === '^' ? `${l}^${r}` : `${l} ${op} ${r}`;
        return s;
      }
      default: throw new SubcoreError('PRINT', String(e.type), 'unknown node');
    }
  }
  return (ast) => pr(ast, 'top');
}

// The grammar's own text form.
export function toText(ast) { return printer('expr')(ast); }
// A Modelica expression (time is 'time').
export function toModelica(ast) { return printer('modelica')(ast); }
// An ngspice behavioural (B-source) expression; names in nodes are node voltages v(name), others are {name}.
export function toSpice(ast, nodes = []) { return printer('spice', { nodes: new Set(nodes) })(ast); }

// ---------------------------------------------------------------- trees

export function astEqual(a, b) {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'num': return Object.is(a.value, b.value);
    case 'ident': return a.name === b.name;
    case 'neg': return astEqual(a.arg, b.arg);
    case 'bin': return a.op === b.op && astEqual(a.left, b.left) && astEqual(a.right, b.right);
    case 'call': return a.fn === b.fn && a.args.length === b.args.length && a.args.every((x, k) => astEqual(x, b.args[k]));
    default: return false;
  }
}

export function astCanonical(ast) { return canonicalJson(ast); }

// The names an expression reads, sorted.
export function identifiers(ast, out = new Set()) {
  switch (ast.type) {
    case 'ident': out.add(ast.name); break;
    case 'neg': identifiers(ast.arg, out); break;
    case 'bin': identifiers(ast.left, out); identifiers(ast.right, out); break;
    case 'call': ast.args.forEach((a) => identifiers(a, out)); break;
    default: break;
  }
  return out;
}

// Replace names by trees (for derived parameters and definitions).
export function substitute(ast, map) {
  switch (ast.type) {
    case 'ident': return Object.prototype.hasOwnProperty.call(map, ast.name) ? map[ast.name] : ast;
    case 'neg': return { type: 'neg', arg: substitute(ast.arg, map) };
    case 'bin': return { type: 'bin', op: ast.op, left: substitute(ast.left, map), right: substitute(ast.right, map) };
    case 'call': return { type: 'call', fn: ast.fn, args: ast.args.map((a) => substitute(a, map)) };
    default: return ast;
  }
}

// ---------------------------------------------------------------- evaluation

// compile(ast, slots) returns a function of one Float64Array (or array) env that evaluates the tree.
// slots maps each name to its index in env. A name with no slot raises at compile time, never at run time.
export function compile(ast, slots) {
  const get = (name) => {
    const k = slots instanceof Map ? slots.get(name) : slots[name];
    if (k === undefined) throw new SubcoreError('UNBOUND', name, `name '${name}' has no value`);
    return k;
  };
  function c(e) {
    switch (e.type) {
      case 'num': { const v = e.value; return () => v; }
      case 'ident': { const k = get(e.name); return (env) => env[k]; }
      case 'neg': { const a = c(e.arg); return (env) => -a(env); }
      case 'bin': {
        const l = c(e.left), r = c(e.right);
        switch (e.op) {
          case '+': return (env) => l(env) + r(env);
          case '-': return (env) => l(env) - r(env);
          case '*': return (env) => l(env) * r(env);
          case '/': return (env) => l(env) / r(env);
          case '^': return (env) => Math.pow(l(env), r(env));
          default: throw new SubcoreError('EVAL', e.op, 'unknown operator');
        }
      }
      case 'call': {
        const f = FN[e.fn][1];
        if (e.args.length === 1) { const a = c(e.args[0]); return (env) => f(a(env)); }
        const a = c(e.args[0]), b = c(e.args[1]);
        return (env) => f(a(env), b(env));
      }
      default: throw new SubcoreError('EVAL', String(e.type), 'unknown node');
    }
  }
  return c(ast);
}

// evaluate(ast, scope) with a plain object scope; slower than compile, for one-off use.
export function evaluate(ast, scope) {
  const names = [...identifiers(ast)];
  const slots = {};
  const env = new Float64Array(names.length);
  names.forEach((n, k) => {
    if (!Object.prototype.hasOwnProperty.call(scope, n)) throw new SubcoreError('UNBOUND', n, `name '${n}' has no value`);
    slots[n] = k; env[k] = scope[n];
  });
  return compile(ast, slots)(env);
}

// Round trip check used by the model tests (T-32): returns { modelica, spice, same } for one tree.
export function roundTrip(ast, nodes = []) {
  const modelica = toModelica(ast);
  const spice = toSpice(ast, nodes);
  const text = toText(ast);
  const same = astEqual(parse(text), ast) && astEqual(parseModelica(modelica), ast) && astEqual(parseSpice(spice), ast);
  return { text, modelica, spice, same };
}
