#!/usr/bin/env python3
# © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
# SPDX-License-Identifier: GPL-3.0-or-later
"""Validate specifications (P9.2, P9.3; T-31).

    python3 tools/validate.py                      every substrate, model and realisation file
    python3 tools/validate.py --defects            also plant the defects and show each one refused
    python3 tools/validate.py --json out.json      write the results as JSON (for the run record)

Checks, in order: JSON Schema 2020-12 (jsonschema, Draft202012Validator); every UCUM code and every expression
through the core's own reader (node tools/speccheck.mjs); cross-references (a quantity that names a parameter
names one that exists with the same unit; noise models name existing parameters; capabilities name existing
operations). Errors are printed with their paths. Exit 0 only when every file is valid and, with --defects,
every planted defect is refused with the expected path.
"""
import argparse, copy, json, subprocess, sys
from pathlib import Path

import yaml
from jsonschema import Draft202012Validator

REPO = Path(__file__).resolve().parent.parent
SCHEMAS = {
    "substrate": ("spec/schema/substrate.schema.json", "spec/substrates"),
    "model": ("spec/schema/model.schema.json", "spec/models"),
    "realisation": ("spec/schema/realisation.schema.json", "spec/realisations"),
}


def jpath(parts):
    out = ""
    for p in parts:
        out += f"[{p}]" if isinstance(p, int) else (f".{p}" if out else str(p))
    return out or "(root)"


def schema_errors(validator, doc):
    errs = []
    for e in sorted(validator.iter_errors(doc), key=lambda e: list(map(str, e.absolute_path))):
        path = jpath(list(e.absolute_path))
        if e.validator == "required":
            missing = e.message.split("'")[1] if "'" in e.message else ""
            path = f"{path}.{missing}" if path != "(root)" else missing
        errs.append((path, f"schema {e.validator}: {e.message[:300]}"))
    return errs


def walk(doc, path=()):
    if isinstance(doc, dict):
        for k, v in doc.items():
            yield path + (k,), k, v
            yield from walk(v, path + (k,))
    elif isinstance(doc, list):
        for i, v in enumerate(doc):
            yield from walk(v, path + (i,))


def core_checks(kind, doc):
    """UCUM codes, expressions and (for models) the core's model checks, through node."""
    units, exprs, models = [], [], []
    for p, k, v in walk(doc):
        if k in ("unit", "code") and isinstance(v, str):
            units.append([jpath(list(p)), v])
        if kind == "model" and k == "expression" and isinstance(v, str):
            exprs.append([jpath(list(p)), v])
        if kind == "substrate" and k == "relation" and isinstance(v, str):
            exprs.append([jpath(list(p)), v])
    if kind == "model":
        models.append(["model", doc])
    r = subprocess.run(["node", str(REPO / "tools/speccheck.mjs")], input=json.dumps({"units": units, "expressions": exprs, "models": models}),
                       capture_output=True, text=True)
    if r.returncode != 0:
        return [("(core)", f"speccheck failed: {r.stderr[-500:]}")]
    return [tuple(e) for e in json.loads(r.stdout)["errors"]]


def cross_checks(kind, doc):
    errs = []
    if kind != "substrate" or not isinstance(doc, dict):
        return errs
    params = {p.get("name"): p for p in doc.get("parameters", []) if isinstance(p, dict)}
    ops = {o.get("name") for o in doc.get("operations", []) if isinstance(o, dict)}
    for p, k, v in walk(doc):
        if k == "parameter" and isinstance(v, str) and p[0] != "parameters":
            q = doc
            for s in p[:-1]:
                q = q[s]
            if v not in params:
                errs.append((jpath(list(p)), f"names parameter '{v}', which is not declared"))
            elif q.get("unit") != params[v].get("unit"):
                errs.append((jpath(list(p)), f"unit '{q.get('unit')}' differs from parameter '{v}' unit '{params[v].get('unit')}'"))
    for i, n in enumerate(doc.get("noise_and_uncertainty", [])):
        for j, pn in enumerate(n.get("parameters", []) if isinstance(n, dict) else []):
            if pn not in params:
                errs.append((f"noise_and_uncertainty[{i}].parameters[{j}]", f"names parameter '{pn}', which is not declared"))
    for i, c in enumerate(doc.get("capabilities", [])):
        for j, on in enumerate(c.get("realised_by", []) if isinstance(c, dict) else []):
            if on not in ops:
                errs.append((f"capabilities[{i}].realised_by[{j}]", f"names operation '{on}', which is not declared"))
    return errs


def validate_doc(kind, doc):
    schema = json.loads((REPO / SCHEMAS[kind][0]).read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    v = Draft202012Validator(schema)
    return schema_errors(v, doc) + core_checks(kind, doc) + cross_checks(kind, doc)


def load(p):
    return yaml.safe_load(p.read_text(encoding="utf-8"))


# Planted defects (T-31, and the model-side checks of T-32): each mutates a valid file and must be refused
# with an error whose path starts with the expected path.
def defects():
    sub = load(REPO / "spec/substrates/mechanical.yaml")
    mod = load(REPO / "spec/models/harmonic-oscillator.yaml")
    out = []

    d = copy.deepcopy(sub); del d["parameters"][2]["evidence"]
    out.append(("parameter without an evidence state", "substrate", d, "parameters[2].evidence"))
    d = copy.deepcopy(sub); del d["temporal_behaviour"]["latency"]["unit"]
    out.append(("quantity without a unit", "substrate", d, "temporal_behaviour.latency.unit"))
    d = copy.deepcopy(sub); del d["parameters"][0]["unit"]
    out.append(("parameter without a unit", "substrate", d, "parameters[0].unit"))
    d = copy.deepcopy(sub); d["parameters"][4]["value"] = 0.2
    out.append(("not_established parameter carrying a guessed value", "substrate", d, "parameters[4]"))
    d = copy.deepcopy(sub); d["parameters"][0]["evidence"] = {"state": "sourced"}
    out.append(("sourced parameter without its citation", "substrate", d, "parameters[0].evidence.citation"))
    d = copy.deepcopy(sub); d["parameters"][0]["unit"] = "furlong"
    out.append(("unknown UCUM code", "substrate", d, "parameters[0].unit"))
    d = copy.deepcopy(sub); del d["noise_and_uncertainty"]
    out.append(("missing section", "substrate", d, "noise_and_uncertainty"))
    d = copy.deepcopy(sub); d["capabilities"][0]["realised_by"] = ["flux_capacitor"]
    out.append(("capability realised by an undeclared operation", "substrate", d, "capabilities[0].realised_by[0]"))
    d = copy.deepcopy(mod); del d["states"][0]["unit"]
    out.append(("model state without a unit", "model", d, "states[0].unit"))
    d = copy.deepcopy(mod); d["equations"][1]["expression"] = "-omega^^2*x"
    out.append(("model equation that does not parse", "model", d, "equations[1].expression"))
    d = copy.deepcopy(mod); d["equations"][1]["expression"] = "-omegaa^2*x"
    out.append(("model equation reading an undeclared name", "model", d, "model:equations[1].expression"))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--defects", action="store_true")
    ap.add_argument("--json")
    a = ap.parse_args()
    results = {"files": {}, "defects": []}
    bad = 0
    for kind, (_, folder) in SCHEMAS.items():
        for p in sorted((REPO / folder).glob("*.yaml")):
            errs = validate_doc(kind, load(p))
            rel = str(p.relative_to(REPO))
            results["files"][rel] = {"kind": kind, "errors": [list(e) for e in errs]}
            print(f"{'valid  ' if not errs else 'INVALID'} {kind:11} {rel}")
            for path, msg in errs:
                print(f"        {path}: {msg}")
            bad += bool(errs)
    if a.defects:
        print("planted defects:")
        for name, kind, doc, expect in defects():
            errs = validate_doc(kind, doc)
            hit = [e for e in errs if e[0].startswith(expect)]
            ok = bool(hit)
            results["defects"].append({"defect": name, "kind": kind, "expected_path": expect, "refused": ok,
                                       "errors": [list(e) for e in errs]})
            print(f"  {'refused' if ok else 'NOT REFUSED'}: {name} (expected path {expect})")
            for path, msg in (hit or errs)[:3]:
                print(f"        {path}: {msg[:200]}")
            bad += not ok
    if a.json:
        Path(a.json).write_text(json.dumps({"_notice": "© 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI. SPDX-License-Identifier: CC0-1.0", **results}, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"validate: {len(results['files'])} files, {sum(1 for f in results['files'].values() if f['errors'])} invalid; "
          f"{sum(1 for d in results['defects'] if d['refused'])}/{len(results['defects'])} planted defects refused")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
