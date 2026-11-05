#!/usr/bin/env python3
# © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
# SPDX-License-Identifier: GPL-3.0-or-later
"""The reference runner behind tools/ref.sh (P9.5). See tools/ref.sh for usage."""
import glob, hashlib, json, os, shlex, shutil, subprocess, sys
from pathlib import Path

CORE = Path(__file__).resolve().parent.parent
NOTICE = "© 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI. SPDX-License-Identifier: CC0-1.0"
PYQ = os.environ.get("SUBCORE_PY_QUANTUM", "python3")
PYC = os.environ.get("SUBCORE_PY_CHRONO", "python3")
OMC = os.environ.get("SUBCORE_OMC", "omc")


def sh(cmd, cwd=None):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, shell=isinstance(cmd, str))
    return r.returncode, r.stdout, r.stderr


def first(cmd):
    try:
        c, o, e = sh(cmd)
        return (o or e).strip().splitlines()[0] if (o or e).strip() else None
    except Exception:
        return None


def versions():
    v = {}
    v["openmodelica"] = first(f"{OMC} --version") if shutil.which(OMC.split()[0]) else None
    v["ngspice"] = first("ngspice --version 2>&1 | grep -m1 -i 'ngspice-'") if shutil.which("ngspice") else None
    q = first([PYQ, "-c", "import qiskit, qiskit_aer, qutip; print('qiskit', qiskit.__version__, 'qiskit-aer', qiskit_aer.__version__, 'qutip', qutip.__version__)"])
    v["qiskit-aer"] = q if q and q.startswith("qiskit") else None
    v["qutip"] = v["qiskit-aer"]
    meta = glob.glob(str(Path(PYC).resolve().parent.parent / "conda-meta" / "pychrono-*.json"))
    if meta:
        d = json.loads(Path(meta[0]).read_text())
        v["chrono"] = f"pychrono {d['version']} {d['build']} ({d.get('channel', '')})"
    else:
        v["chrono"] = None
    return v


def image():
    return {"image": os.environ.get("SUBCORE_IMAGE", "native"), "image_id": os.environ.get("SUBCORE_IMAGE_ID", "none"),
            "image_size_bytes": int(os.environ["SUBCORE_IMAGE_SIZE"]) if os.environ.get("SUBCORE_IMAGE_SIZE") else None}


def hashes(d):
    return {str(p.relative_to(d)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(d.rglob("*")) if p.is_file() and p.name != "ref.json"}


def run_tool(tool, sample, out):
    out.mkdir(parents=True, exist_ok=True)
    if tool in ("ngspice", "openmodelica"):
        model = CORE / "spec" / "models" / f"{sample}.yaml"
        if not model.exists():
            raise SystemExit(f"ref: no model {sample}")
        form = "spice" if tool == "ngspice" else "modelica"
        c, o, e = sh(["node", str(CORE / "tools/ref_gen.mjs"), str(model), form, str(out)])
        if c:
            raise SystemExit(f"ref: input generation failed: {e}")
        if tool == "ngspice":
            cmd = "ngspice -b model.cir"
        else:
            cmd = f"{OMC} run.mos"
        c, o, e = sh(cmd, cwd=out)
        (out / "tool.log").write_text(o + e, encoding="utf-8")
        if tool == "openmodelica":   # keep the result and the inputs; drop the generated C build
            for p in out.iterdir():
                if p.name not in ("run.mos", "tool.log") and not p.name.endswith((".mo", "_res.csv")):
                    shutil.rmtree(p) if p.is_dir() else p.unlink()
        return cmd, c, compare(tool, sample, out)
    if tool == "qiskit-aer":
        cmd = f"{PYQ} {CORE / 'tools/ref/qiskit_bell.py'} {CORE / 'spec/circuits/bell.qasm'} ."
    elif tool == "qutip":
        cmd = f"{PYQ} {CORE / 'tools/ref/qutip_oscillator.py'} ."
    elif tool == "chrono":
        cmd = f"{PYC} {CORE / 'tools/ref/chrono_gear.py'} ."
    else:
        raise SystemExit(f"ref: unknown tool {tool}")
    c, o, e = sh(cmd, cwd=out)
    (out / "tool.log").write_text(o + e, encoding="utf-8")
    return cmd.replace(str(CORE) + "/", ""), c, (o.strip().splitlines() or [""])[-1]


def compare(tool, sample, out):
    """For a model with an analytic oracle, the largest absolute difference of the reference's output from it."""
    c, o, e = sh(["node", "--input-type=module", "-e", f"""
import fs from 'node:fs'; import {{ loadYaml, analyticSolution }} from '{CORE}/docs/src/spec.js';
const m = loadYaml(fs.readFileSync('{CORE}/spec/models/{sample}.yaml', 'utf8'));
if (!m.oracle || m.oracle.kind !== 'analytic') {{ console.log('no analytic oracle'); process.exit(0); }}
const a = analyticSolution(m); const names = m.states.map((s) => s.name);
let rows;
if ('{tool}' === 'ngspice') rows = fs.readFileSync('{out}/out.txt', 'utf8').trim().split('\\n').slice(1).map((l) => l.trim().split(/\\s+/).map(Number));
else {{ const t = fs.readFileSync(fs.readdirSync('{out}').filter((f) => f.endsWith('_res.csv')).map((f) => '{out}/' + f)[0], 'utf8').trim().split('\\n');
  const h = t[0].split(',').map((s) => s.replace(/"/g, '')); const idx = ['time', ...names].map((n) => h.indexOf(n));
  rows = t.slice(1).map((l) => {{ const f = l.split(',').map(Number); return idx.map((i) => f[i]); }}); }}
let worst = 0; for (const [t, ...ys] of rows) a.at(t).forEach((v, j) => {{ if (j < ys.length) worst = Math.max(worst, Math.abs(v - ys[j])); }});
console.log(`${{rows.length}} rows; largest absolute difference from the analytic solution ${{worst.toExponential(3)}}`);
"""])
    return (o or e).strip()


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(open(CORE / "tools/ref.sh").read().split("set -uo")[0]); return 2
    repo = Path(argv[argv.index("--repo") + 1]).resolve() if "--repo" in argv else Path.cwd()
    if argv[0] == "--list":
        v = versions()
        img = image()
        doc = {"_notice": NOTICE, **img, "tools": v}
        (repo / "refs").mkdir(parents=True, exist_ok=True)
        (repo / "refs" / "tools.json").write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        size = f"{img['image_size_bytes'] / 1e9:.2f} GB" if img["image_size_bytes"] else "not in a container"
        print(f"image {img['image']} ({img['image_id'][:19]}), size {size}")
        for k, x in v.items():
            print(f"  {k:13} {x or 'NOT AVAILABLE'}")
        return 0 if all(v.values()) else 3
    tool, sample = argv[0], argv[1]
    v = versions()
    if not v.get(tool):
        print(f"ref: {tool} is not available here"); return 3
    out = repo / "refs" / tool / sample
    shutil.rmtree(out, ignore_errors=True)
    cmd, code, summary = run_tool(tool, sample, out)
    doc = {"_notice": NOTICE, "tool": tool, "tool_version": v[tool], "sample": sample, **image(), "command": cmd,
           "exit_code": code, "summary": summary, "files_sha256": hashes(out)}
    (out / "ref.json").write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{tool} {sample}: exit {code}; {summary}")
    for f, h in doc["files_sha256"].items():
        print(f"  {h}  {f}")
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
