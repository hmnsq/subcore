<!-- © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI. SPDX-License-Identifier: CC-BY-SA-4.0 -->

# subcore API, version 0.1.0

The shared web core for hmnsq/mechsim and hmnsq/anasim. Plain ES2020 modules under `docs/src/`, no build
step, relative imports with extensions. Every numerical module imports unchanged in Node.js and in a
browser; none touches the DOM. Simulators vendor the core under `docs/vendor/subcore/<version>/` (Guidelines
4.1) and import it by relative path, for example
`import { integrateFixed } from '../vendor/subcore/0.1.0/src/solve.js'`.

Conventions that hold everywhere:

- Errors are `SubcoreError` (from `errors.js`) with `.code` (for example `PARSE`, `UNIT`, `NONFINITE`,
  `STEP_COLLAPSE`, `UNBOUND`, `MODEL`, `TRACE`) and `.path` (the element or field that caused it).
- Quantities are SI base units at run time; UCUM codes are converted once, at load (`units.js`).
- Derivative functions have the signature `f(t, y, dydt)`: read `y` (Float64Array), write `dydt`.
- Nothing calls `Math.random`, `eval` or `new Function`.

This API is stable for S1: names and signatures below do not change without a new minor version and a
note here. Additions may appear.

## errors.js

| Export | Signature | Meaning |
|---|---|---|
| `SubcoreError` | `new SubcoreError(code, path, message, detail?)` | Error with `.code`, `.path`, optional `.detail` |
| `notImplemented` | `notImplemented(what)` | Always throws `NOT_IMPLEMENTED` |

## units.js (UCUM)

| Export | Signature | Meaning |
|---|---|---|
| `parseUnit` | `parseUnit(code) -> { code, factor, offset, dim, dimensionless }` | Parse a UCUM code (prefixes, `.`, `/`, integer exponents, parentheses, `{annotations}`); `dim` is the exponent vector over `DIMENSIONS` |
| `toSI` / `fromSI` | `toSI(value, code)`, `fromSI(value, code)` | Convert to and from SI base units (Cel carries its offset) |
| `convert` | `convert(value, from, to)` | Checked conversion; throws `UNIT` on a dimension mismatch |
| `sameDimension` | `sameDimension(a, b) -> boolean` | |
| `dimensionString` | `dimensionString(code) -> 'kg.m2.s-2'` | |
| `isUnitCode` | `isUnitCode(code) -> boolean` | |
| `DIMENSIONS` | `['m','kg','s','A','K','mol','cd','rad']` | The radian is kept as a base dimension, as in UCUM |
| `UNIT_ATOMS` | array of known atoms | m s g rad K C cd mol sr Hz N Pa J W A V F Ohm S Wb T H Cel l L t eV bit By min h d deg circ % [ppm] [in_i] [pi] |

An unknown code throws `UNIT`; it is never guessed. Dimensionless is `1`.

## expr.js (the restricted expression grammar, CMS-02)

Grammar: `spec/grammar/expr.ebnf`. Precedence, lowest first: `+ -` (left), `* /` (left), unary `-`,
`^` (right; its exponent may carry a unary minus). Functions: `sin cos tan asin acos atan sinh cosh tanh exp
log log10 sqrt abs sign min max` (`min`, `max` take two arguments). The independent variable is `t`.

Syntax tree nodes: `{type:'num', value}`, `{type:'ident', name}`, `{type:'neg', arg}`,
`{type:'bin', op, left, right}` (op in `+ - * / ^`), `{type:'call', fn, args}`.

| Export | Signature | Meaning |
|---|---|---|
| `parse` | `parse(text) -> ast` | The grammar's own text form |
| `parseModelica` | `parseModelica(text) -> ast` | Reads a generated Modelica expression (`time` is `t`) |
| `parseSpice` | `parseSpice(text) -> ast` | Reads a generated ngspice B-source expression (`v(x)` and `{p}` are names, `ln` is `log`, `sgn` is `sign`, `time` is `t`) |
| `toText` | `toText(ast) -> string` | |
| `toModelica` | `toModelica(ast) -> string` | |
| `toSpice` | `toSpice(ast, nodes = []) -> string` | Names in `nodes` become `v(name)`, other names `{name}` |
| `roundTrip` | `roundTrip(ast, nodes) -> { text, modelica, spice, same }` | `same` is true when all three forms re-parse to `ast` |
| `astEqual` | `astEqual(a, b) -> boolean` | Structural equality (numbers by `Object.is`) |
| `astCanonical` | `astCanonical(ast) -> string` | Canonical JSON |
| `identifiers` | `identifiers(ast) -> Set` | Names read |
| `substitute` | `substitute(ast, {name: ast})` | |
| `compile` | `compile(ast, slots) -> (env) => number` | `slots` is a Map or object from name to index in `env`; closures, no eval; an unbound name throws `UNBOUND` at compile time |
| `evaluate` | `evaluate(ast, scope) -> number` | Slow path with a plain object |
| `FUNCTIONS`, `RESERVED`, `INDEPENDENT`, `GRAMMAR_VERSION` | constants | |

Generated Modelica and SPICE forms parenthesise every compound operand of `^` (ngspice reads `2^3^2` as 64,
left to right) and every negation used as an operand (Modelica allows a leading minus only at the start).

## solve.js (integrators)

| Export | Signature | Meaning |
|---|---|---|
| `rk4Step` | `rk4Step(f, t, y, h, out, work?) -> out` | One classical RK4 step; `out` may be `y` |
| `rk4Work` | `rk4Work(n)` | Workspace so a run allocates nothing per step |
| `integrateFixed` | `integrateFixed({ f, t0=0, y0, h, steps, every=1, names?, onStep? }) -> { t, y, stats }` | Fixed-step RK4; `t[k] = t0 + k h` exactly as computed, never accumulated; `y[k]` is a Float64Array |
| `dopri54` | `dopri54({ f, t0=0, y0, tOut, rtol=1e-10, atol=1e-12, h0?, hmax=Infinity, hminFactor=1e-14, maxSteps=1e7, names? }) -> { t, y, stats }` | Adaptive Dormand-Prince 5(4), FSAL, steps land on each `tOut`; `stats` has steps, accepted, rejected, fevals, hminUsed, hmaxUsed, rtol, atol |
| `grid` | `grid(t0, t1, n) -> number[]` | `n + 1` points |
| `DOPRI` | tableau `{ c, a, b, bhat }` | |

Non-finite states throw `NONFINITE` with the state name and time. Step-size collapse throws
`STEP_COLLAPSE` with the time (stiffness is reported, never hidden).

## events.js

| Export | Signature | Meaning |
|---|---|---|
| `bisect` | `bisect(g, ta, ya, tb, advance, { tol=1e-12, direction='both' }) -> { t, y, tLow, iterations }` | `advance(dt)` gives the state at `ta + dt`; the bracket closes to `tol * (tb - ta)` |
| `integrateWithEvents` | `integrateWithEvents({ f, t0, y0, h, steps, events, names?, tol?, every? }) -> { t, y, events, stopped }` | Fixed-step RK4; each event `{ name, g(t, y), direction: 'rising'|'falling'|'both', action(t, y) -> { y?, stop? } }`; after an event the step completes from the event time, so the output grid is unchanged |

## prng.js

| Export | Signature | Meaning |
|---|---|---|
| `SplitMix64` | `new SplitMix64(seed).next() -> BigInt` | Exact 64-bit SplitMix64 |
| `Xoshiro128ss` | `new Xoshiro128ss([s0, s1, s2, s3])` with `nextU32()`, `nextFloat()` (53 bits, [0,1)), `nextNormal()` (Box-Muller) | xoshiro128** 1.1 |
| `createRng` | `createRng(seed) -> Xoshiro128ss` | Seeded from two SplitMix64 outputs (low then high word of each) |

Both reproduce published reference vectors (`vectors/prng/`, from the rand_xoshiro 0.6.0 crate's tests).

## trace.js

| Export | Signature | Meaning |
|---|---|---|
| `writeTrace` | `writeTrace(meta, columns, rows) -> string` | `meta`: `{ model, model_sha256?, substrate?, parameter_sha256, solver, step? or tolerances?, seed?, extra? }`; numbers as `toExponential(16)` |
| `parseTrace` | `parseTrace(text) -> { meta, columns, rows }` | |
| `compareTraces` | `compareTraces(a, b, { floor=1e-9 }) -> { maxAbs, maxRel, per }` | |
| `rowsFrom` | `rowsFrom({ t, y }) -> rows` | |
| `fmt17`, `parseNum`, `NOTICE`, `TRACE_VERSION` | | |

## vectors.js

| Export | Signature | Meaning |
|---|---|---|
| `parseVectors` | `parseVectors(text) -> { kind, meta, fields, cases }` | Reads `repsynth-vectors 1` (hexadecimal, cases as BigInt) and `subcore-vectors 1` (doubles) |

## spec.js

| Export | Signature | Meaning |
|---|---|---|
| `loadYaml` | `loadYaml(text, path?) -> object` | js-yaml 5.5.0 core schema; write floats as `1.0e-10` so PyYAML reads them as numbers too |
| `checkModel` | `checkModel(model) -> [{ code, path, message }]` | Structural checks: names (unique ignoring case), units, one equation per state, expressions parse and bind |
| `compileModel` | `compileModel(model, overrides?) -> { id, version, hash, stateNames, params, y0, f, outputs(t, y), outputNames, horizon, defaults, parameterHash }` | Continuous models; values in SI |
| `analyticSolution` | `analyticSolution(model) -> { names, at(t) }` | The model's analytic oracle; initial values are available as `<state>_0` |
| `compileFunctions` | `compileFunctions(model) -> { names, at(x) }` | Function-generation models |
| `specHash` | `specHash(doc) -> hex` | sha256 of canonical JSON without `_notice` |

## hash.js

`sha256Hex(bytes | string)`, `canonicalJson(value)`, `utf8(text)`. Synchronous; equal to Node's crypto.

## cli.js

`runCli(argv, io) -> exit code` with `io = { readText(path), writeText(path, text), log(line) }`, and
`runModel(model, { solver, h, t1, every, points, rtol, atol, log }) -> { text, stats, compiled }`.
Commands: `run`, `check`, `expr`, `hash`, `prng`, `compare`, `version`. Node.js: `node tools/cli.mjs ...`.

## Models and schemas

- `spec/models/*.yaml`: the CMS-03 models (exponential-decay, harmonic-oscillator, damped-driven-oscillator,
  lorenz, function-generation, balanced-ternary-addition).
- `spec/schema/model.schema.json`, `spec/schema/substrate.schema.json` (JSON Schema 2020-12).
