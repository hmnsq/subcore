#!/usr/bin/env python3
# © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
# SPDX-License-Identifier: GPL-3.0-or-later
"""Analytic and high-precision oracles (P9.6; T-34 to T-36) and their vector files.

    python3 tools/oracles.py [--out vectors] [--only analytic,functions,lorenz,stats]

- Analytic models (exponential decay, harmonic oscillator, damped driven oscillator): the closed-form solution
  written in the model file, as a syntax tree from the core's parser (tools/ast_dump.mjs), is evaluated by mpmath
  at 40 decimal digits at binary64 times and rounded to the nearest binary64: error at most half a unit in the
  last place of each value.
- Function generation: every function of the model, the same way.
- Lorenz to t = 5: mpmath.odefun (Taylor series) at 30 and at 40 decimal digits from the binary64 parameters;
  the largest difference between the two runs, over every value written, is recorded as the error bound.
- Lorenz attractor statistics, t from 50 to 500: an independent long run in Python (classical RK4 in binary64 at
  h = 0.001, sampled every 0.01), means and standard deviations of x, y and z.

Every file is written deterministically (no timestamps); rerunning gives the same bytes (checked by
tests/oracles.test.mjs through tools/oracles_check.sh).
"""
import argparse, hashlib, json, math, subprocess, sys
from pathlib import Path

import mpmath as mp

REPO = Path(__file__).resolve().parent.parent
VERSION = "1.0.0"
NOTICE = "© 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI."

FN = {"sin": mp.sin, "cos": mp.cos, "tan": mp.tan, "asin": mp.asin, "acos": mp.acos, "atan": mp.atan,
      "sinh": mp.sinh, "cosh": mp.cosh, "tanh": mp.tanh, "exp": mp.exp, "log": mp.log, "log10": mp.log10,
      "sqrt": mp.sqrt, "abs": mp.fabs, "sign": mp.sign, "min": min, "max": max}


def ev(ast, env):
    t = ast["type"]
    if t == "num":
        return mp.mpf(ast["value"])
    if t == "ident":
        return env[ast["name"]]
    if t == "neg":
        return -ev(ast["arg"], env)
    if t == "bin":
        a, b = ev(ast["left"], env), ev(ast["right"], env)
        op = ast["op"]
        return a + b if op == "+" else a - b if op == "-" else a * b if op == "*" else a / b if op == "/" else mp.power(a, b)
    if t == "call":
        return FN[ast["fn"]](*[ev(x, env) for x in ast["args"]])
    raise ValueError(f"unknown node {t}")


def f17(x):
    return format(float(x), ".16e")


def models():
    files = sorted(str(p.relative_to(REPO)) for p in (REPO / "spec/models").glob("*.yaml"))
    r = subprocess.run(["node", str(REPO / "tools/ast_dump.mjs"), *files], cwd=REPO, capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


def write_vec(path, header, fields, rows):
    lines = ["# subcore-vectors 1", f"# {NOTICE} SPDX-License-Identifier: CC0-1.0"]
    lines += [f"# {k}: {v}" for k, v in header]
    lines += [f"# fields: {' '.join(fields)}", f"# generator: subcore tools/oracles.py {VERSION}, mpmath {mp.__version__}",
              f"# cases: {len(rows)}"]
    lines += [" ".join(f17(v) for v in row) for row in rows]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {path.relative_to(REPO)} ({len(rows)} cases, sha256 {hashlib.sha256(path.read_bytes()).hexdigest()[:16]})")


def grid(t0, t1, n):
    # the same binary64 operations as docs/src/solve.js grid()
    return [t1 if k == n else t0 + (k * (t1 - t0)) / n for k in range(n + 1)]


def analytic(ms, out):
    for key, m in ms.items():
        if "solution" not in m:
            continue
        mp.mp.dps = 40
        env = {k: mp.mpf(v) for k, v in m["params"].items()}
        for s in m["states"]:
            env[s["name"] + "_0"] = mp.mpf(s["initial"])
        rows = []
        for t in grid(m["horizon"]["t0"], m["horizon"]["t1"], 400):
            env["t"] = mp.mpf(t)
            rows.append([t] + [ev(s["ast"], env) for s in m["solution"]])
        write_vec(out / m["id"] / f"{m['id']}.analytic.vec",
                  [("model", m["id"]), ("version", m["version"]), ("model_sha256", m["sha256"]),
                   ("oracle", "analytic solution of the model file, evaluated by mpmath at 40 decimal digits at binary64 times"),
                   ("error_bound", "half a unit in the last place of each value (rounding of a 40-digit value to binary64)")],
                  ["t"] + [s["name"] for s in m["solution"]], rows)


def functions(ms, out):
    for key, m in ms.items():
        if m["kind"] != "function":
            continue
        mp.mp.dps = 40
        env = {k: mp.mpf(v) for k, v in m["params"].items()}
        d = m["domain"]
        rows = []
        for x in grid(d["from"], d["to"], d["points"] - 1):
            env[m["independent"]] = mp.mpf(x)
            rows.append([x] + [ev(o["ast"], env) for o in m["outputs"]])
        write_vec(out / m["id"] / f"{m['id']}.vec",
                  [("model", m["id"]), ("version", m["version"]), ("model_sha256", m["sha256"]),
                   ("oracle", "each function evaluated by mpmath at 40 decimal digits at binary64 arguments"),
                   ("error_bound", "half a unit in the last place of each value")],
                  [m["independent"]] + [o["name"] for o in m["outputs"]], rows)


def lorenz_run(m, dps, times):
    mp.mp.dps = dps
    p = {k: mp.mpf(v) for k, v in m["params"].items()}
    names = [s["name"] for s in m["states"]]
    eqs = {e["der"]: e["ast"] for e in m["equations"]}

    def F(t, y):
        env = dict(p); env["t"] = t
        env.update({n: y[i] for i, n in enumerate(names)})
        return [ev(eqs[n], env) for n in names]
    f = mp.odefun(F, mp.mpf(m["horizon"]["t0"]), [mp.mpf(s["initial"]) for s in m["states"]])
    return [[mp.mpf(t)] + list(f(mp.mpf(t))) for t in times]


def lorenz(ms, out):
    m = ms["lorenz"]
    times = grid(0.0, 5.0, 100)
    lo = lorenz_run(m, 30, times)
    hi = lorenz_run(m, 40, times)
    mp.mp.dps = 40
    diff = max(abs(a - b) for ra, rb in zip(lo, hi) for a, b in zip(ra[1:], rb[1:]))
    bound = mp.nstr(diff * 10, 3) if diff > 0 else "1e-40"
    write_vec(out / "lorenz" / "lorenz.t5.vec",
              [("model", m["id"]), ("version", m["version"]), ("model_sha256", m["sha256"]),
               ("oracle", "mpmath.odefun (Taylor series) at 40 decimal digits; checked against the same run at 30 digits"),
               ("error_bound", f"absolute, below {bound} (ten times the largest difference between the 30- and 40-digit runs, {mp.nstr(diff, 3)}), "
                               "plus half a unit in the last place from rounding to binary64")],
              ["t", "x", "y", "z"], hi)


def lorenz_stats(ms, out):
    m = ms["lorenz"]
    p = m["params"]
    s, r, b = p["sigma"], p["rho"], p["beta"]

    def F(y):
        x, yy, z = y
        return (s * (yy - x), x * (r - z) - yy, x * yy - b * z)
    h, t_end, t_from, every = 0.001, 500.0, 50.0, 10
    y = tuple(st["initial"] for st in m["states"])
    acc = [[0.0, 0.0] for _ in range(3)]
    n = 0
    steps = int(round(t_end / h))
    k_from = int(round(t_from / h))
    for k in range(1, steps + 1):
        k1 = F(y)
        k2 = F(tuple(y[i] + h / 2 * k1[i] for i in range(3)))
        k3 = F(tuple(y[i] + h / 2 * k2[i] for i in range(3)))
        k4 = F(tuple(y[i] + h * k3[i] for i in range(3)))
        y = tuple(y[i] + h / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]) for i in range(3))
        if k >= k_from and k % every == 0:
            for i in range(3):
                acc[i][0] += y[i]; acc[i][1] += y[i] * y[i]
            n += 1
    stats = {}
    for i, name in enumerate("xyz"):
        mean = acc[i][0] / n
        std = math.sqrt(max(acc[i][1] / n - mean * mean, 0.0))
        stats[name] = {"mean": float(f17(mean)), "std": float(f17(std))}
    doc = {"_notice": f"{NOTICE} SPDX-License-Identifier: CC0-1.0", "model": m["id"], "version": m["version"],
           "model_sha256": m["sha256"],
           "oracle": "independent long run in Python: classical RK4 in binary64, h = 0.001, from the model's initial state",
           "window": {"from": t_from, "to": t_end, "sample_every": h * every}, "samples": n, "statistics": stats,
           "comparison": "Test Plan T-36: means and standard deviations within 2 per cent; for a mean, 2 per cent of the "
                         "variable's standard deviation, since the means of x and y are near zero by the system's symmetry",
           "generator": f"subcore tools/oracles.py {VERSION}"}
    p_ = out / "lorenz" / "lorenz.stats.json"
    p_.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {p_.relative_to(REPO)} ({n} samples)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="vectors")
    ap.add_argument("--only", default="analytic,functions,lorenz,stats")
    a = ap.parse_args()
    out = REPO / a.out
    ms = models()
    only = a.only.split(",")
    if "analytic" in only: analytic(ms, out)
    if "functions" in only: functions(ms, out)
    if "lorenz" in only: lorenz(ms, out)
    if "stats" in only: lorenz_stats(ms, out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
