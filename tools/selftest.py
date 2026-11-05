#!/usr/bin/env python3
# © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
# SPDX-License-Identifier: GPL-3.0-or-later
"""Mutation self-test of the core (P9.7, T-37; Test Plan section 8, substrate core row).

Each mutation replaces one exact anchor (which must occur exactly once) in a copy of the repository, then runs
the check named for it in the copy. A mutation is caught when that check fails. Run through ops/selftest.sh.
"""
import json, re, shutil, subprocess, sys, time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
WORK = REPO / ".cache" / "selftest"
TESTS = ["node", "--test", "tests/*.test.mjs"]

MUTATIONS = [
    # (name, Test Plan defect, file, anchor, replacement, command)
    ("rk4-weight", "a wrong RK4 coefficient (weight of k3 is 3, not 2)", "docs/src/solve.js",
     "out[i] = y[i] + h6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);",
     "out[i] = y[i] + h6 * (k1[i] + 2 * k2[i] + 3 * k3[i] + k4[i]);", TESTS),
    ("rk4-weight-subtle", "a wrong RK4 coefficient (weight of k2 is 2.001)", "docs/src/solve.js",
     "out[i] = y[i] + h6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);",
     "out[i] = y[i] + h6 * (k1[i] + 2.001 * k2[i] + 2 * k3[i] + k4[i]);", TESTS),
    ("rk4-node", "a wrong RK4 coefficient (k4 evaluated at y + h/2 k3)", "docs/src/solve.js",
     "for (let i = 0; i < n; i++) tmp[i] = y[i] + h * k3[i];",
     "for (let i = 0; i < n; i++) tmp[i] = y[i] + h2 * k3[i];", TESTS),
    ("dopri-coefficient", "a wrong Dormand-Prince coefficient (a32 = 9/41)", "docs/src/solve.js",
     "[3 / 40, 9 / 40],", "[3 / 40, 9 / 41],", TESTS),
    ("unit-minute", "a wrong unit factor (min = 61 s)", "docs/src/units.js",
     "min: { f: 60, d: D({ s: 1 }) },", "min: { f: 61, d: D({ s: 1 }) },", TESTS),
    ("unit-milli", "a wrong unit factor (prefix m = 1e-4)", "docs/src/units.js",
     "d: 1e-1, c: 1e-2, m: 1e-3,", "d: 1e-1, c: 1e-2, m: 1e-4,", TESTS),
    ("parser-add-mul", "a parser precedence error (+ binds tighter than *)", "docs/src/expr.js",
     "if (accept('+')) left = { type: 'bin', op: '+', left, right: term() };\n      else if (accept('-')) left = { type: 'bin', op: '-', left, right: term() };",
     "if (accept('-')) left = { type: 'bin', op: '-', left, right: term() };", None),
    ("parser-neg-pow", "a parser precedence error (unary minus binds tighter than ^)", "docs/src/expr.js",
     "if (accept('-')) return { type: 'neg', arg: unary() };",
     "if (accept('-')) { const a = { type: 'neg', arg: primary() }; return accept('^') ? { type: 'bin', op: '^', left: a, right: unary() } : a; }", TESTS),
    ("parser-pow-left", "a parser precedence error (^ left associative)", "docs/src/expr.js",
     "if (accept('^')) return { type: 'bin', op: '^', left: base, right: unary() };\n    return base;",
     "let b = base;\n    while (accept('^')) b = { type: 'bin', op: '^', left: b, right: primary() };\n    return b;", TESTS),
    ("vector-stale", "a vector file that no longer regenerates (one digit changed)", "vectors/harmonic-oscillator/harmonic-oscillator.analytic.vec",
     "5.0000000000000003e-02 9.9500416527802582e-01", "5.0000000000000003e-02 9.9500416527802583e-01", ["bash", "ops/regen_check.sh"]),
]


def fix_parser_add_mul(text):
    """+ moved into term() and * into expression(): two anchors, applied together."""
    a1 = ("if (accept('+')) left = { type: 'bin', op: '+', left, right: term() };",
          "if (accept('*')) left = { type: 'bin', op: '*', left, right: term() };")
    a2 = ("if (accept('*')) left = { type: 'bin', op: '*', left, right: unary() };",
          "if (accept('+')) left = { type: 'bin', op: '+', left, right: unary() };")
    for a, b in (a1, a2):
        if text.count(a) != 1:
            raise SystemExit(f"anchor not found exactly once: {a}")
    return text.replace(a1[0], "\0A").replace(a2[0], a2[1]).replace("\0A", a1[1])


def copy_repo(dst):
    shutil.rmtree(dst, ignore_errors=True)
    files = subprocess.run(["git", "ls-files", "-co", "--exclude-standard"], cwd=REPO, capture_output=True, text=True, check=True).stdout.split("\n")
    for f in files:
        if not f or f.startswith("docs/vendor/mathjs/"):
            continue
        s = REPO / f
        if s.is_file():
            d = dst / f
            d.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(s, d)


def run(cmd, cwd):
    t0 = time.monotonic()
    shell = cmd == TESTS
    r = subprocess.run(" ".join(cmd) if shell else cmd, cwd=cwd, capture_output=True, text=True, shell=shell)
    failing = [m for m in re.findall(r"^not ok \d+ - (.*)$", r.stdout, re.M) if "# TODO" not in m]
    return r.returncode, round(time.monotonic() - t0, 1), failing, (r.stdout + r.stderr)[-1500:]


def main():
    results = {"baseline": None, "mutations": []}
    base = WORK / "baseline"
    copy_repo(base)
    code, secs, failing, tail = run(TESTS, base)
    results["baseline"] = {"command": " ".join(TESTS), "exit_code": code, "seconds": secs, "failing": failing}
    print(f"baseline: tests exit {code} ({secs} s)")
    if code != 0:
        print(tail)
        print("selftest: the unmutated copy fails; nothing can be concluded")
        return 2
    caught_all = True
    for name, defect, f, anchor, repl, cmd in MUTATIONS:
        d = WORK / name
        copy_repo(d)
        p = d / f
        text = p.read_text(encoding="utf-8")
        if name == "parser-add-mul":
            text = fix_parser_add_mul(text)
            cmd = TESTS
        else:
            if text.count(anchor) != 1:
                print(f"{name}: anchor not found exactly once in {f}")
                return 2
            text = text.replace(anchor, repl)
        p.write_text(text, encoding="utf-8")
        code, secs, failing, tail = run(cmd, d)
        caught = code != 0
        caught_all &= caught
        results["mutations"].append({"name": name, "defect": defect, "file": f, "command": " ".join(cmd), "exit_code": code,
                                     "seconds": secs, "caught": caught, "failing_tests": failing[:12],
                                     "output_tail": "" if failing else tail[-600:]})
        print(f"{'caught    ' if caught else 'NOT CAUGHT'} {name}: {defect}; exit {code}; {len(failing)} failing" + (f": {failing[:3]}" if failing else ""))
    out = REPO / "reports" / "selftest" / "S1.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    results["caught"] = f"{sum(m['caught'] for m in results['mutations'])}/{len(results['mutations'])}"
    out.write_text(json.dumps({"_notice": "© 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI. SPDX-License-Identifier: CC0-1.0", **results},
                              indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"selftest: {results['caught']} planted defects caught")
    return 0 if caught_all else 1


if __name__ == "__main__":
    sys.exit(main())
