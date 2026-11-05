#!/usr/bin/env python3
# © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
# SPDX-License-Identifier: GPL-3.0-or-later
"""The BURP JavaScript probe (P9.1, T-30).

For each subject (a minimal ES module, a C control, the vendored libraries, the other candidate libraries and
subcore's own sources) it runs, per subject:

    burp check <subject folder> --langs <every language `burp languages` lists> --translators glossary
               --out .cache/tmp/burp/<subject> --json .cache/tmp/burp/<subject>.json --jobs 3

and then checks BURP's result independently: for every language folder BURP wrote, every source file is
compared byte for byte with the file BURP reversed (out/.back/<language>/...), and with the ingested file
(to tell a file BURP localised from one it copied unchanged). Nothing is inferred from BURP's own summary
alone. Results go to reports/burp/ (table.csv, TABLE.md, per-subject JSON with the command, exit code and
output, and an issue text per gap) and docs/vendor/ADMISSIONS.csv is rewritten from them.

    python3 tools/burp_probe.py [--subjects a,b] [--langs hindi,tamil] [--keep]
"""
import argparse, csv, hashlib, json, os, shutil, subprocess, sys, time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CACHE = REPO / ".cache"
OUT = REPO / "reports" / "burp"
NOTICE = "© 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI."

# subject: (source folder relative to the repository, kind, library name for ADMISSIONS or None, note)
SUBJECTS = {
    "minimal-esm": ("tests/burp/minimal-esm", "probe", None, "A minimal ES module, as .mjs and .js"),
    "control-c": ("tests/burp/control-c", "control", None,
                  "The same function in C: shows that the probe sees localisation when BURP reads a language"),
    "mathjs": ("docs/vendor/mathjs/15.2.0", "vendored", "mathjs", "Vendored here: lib/esm, 1262 modules"),
    "js-yaml": ("docs/vendor/js-yaml/5.5.0", "vendored", "js-yaml", "Vendored here: dist/js-yaml.mjs"),
    "uplot": (".cache/npm/x_uplot-1.6.32/package/dist/uPlot.esm.js", "candidate", "uplot",
              "npm uplot@1.6.32, dist/uPlot.esm.js; vendored by hmnsq/anasim, not here"),
    "three": (".cache/npm/x_three-0.187.0/package/src", "candidate", "three",
              "npm three@0.187.0, the readable src tree; vendored by hmnsq/mechsim, not here"),
    "jscad-modeling": (".cache/npm/x_jscad-modeling-2.13.0/package/src", "candidate", "jscad-modeling",
                       "npm @jscad/modeling@2.13.0, src tree; it is CommonJS (require), not an ES module"),
    "planck": (".cache/npm/x_planck-1.5.1/package/dist/planck.mjs", "candidate", "planck",
               "npm planck@1.5.1, dist/planck.mjs (upstream source is TypeScript)"),
    "quantum-circuit": (".cache/npm/x_quantum-circuit-0.9.251/package/lib", "candidate", "quantum-circuit",
                        "npm quantum-circuit@0.9.251, lib tree; it is CommonJS (require), not an ES module"),
    "quirk": (".cache/quirk/src", "candidate", "quirk",
              "github.com/Strilanc/Quirk at 8833791294e642795c8717038e84940a74b19a64, src tree"),
    "subcore-src": ("docs/src", "own", "subcore", "subcore's own modules (D12)"),
    "subcore-tools": ("tools", "own", None, "subcore's own tools (.mjs and .py)"),
}

JS_SUFFIXES = {".js", ".mjs", ".cjs"}


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def burp_version():
    r = subprocess.run(["burp", "--version"], capture_output=True, text=True)
    return r.stdout.splitlines()[0] if r.stdout else "unknown"


def all_languages():
    r = subprocess.run(["burp", "languages"], capture_output=True, text=True, check=True)
    return r.stdout.split()


def stage(subject, src):
    """BURP reads a folder; a single file is staged into a folder of its own (the file is copied unchanged)."""
    if src.is_dir():
        return src
    d = CACHE / "tmp" / "burp-stage" / subject
    shutil.rmtree(d, ignore_errors=True)
    d.mkdir(parents=True)
    shutil.copy2(src, d / src.name)
    return d


def probe(subject, langs, keep):
    rel, kind, lib, note = SUBJECTS[subject]
    src = REPO / rel
    if not src.exists():
        return {"subject": subject, "kind": kind, "library": lib, "note": note, "source": rel,
                "error": f"source {rel} does not exist here; fetch it first (see tools/burp_probe.py)"}
    folder = stage(subject, src)
    out = CACHE / "tmp" / "burp" / subject
    js = CACHE / "tmp" / "burp" / f"{subject}.json"
    shutil.rmtree(out, ignore_errors=True)
    out.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["burp", "check", str(folder), "--langs", ",".join(langs), "--translators", "glossary",
           "--out", str(out), "--json", str(js), "--jobs", "3"]
    t0 = time.monotonic()
    r = subprocess.run(cmd, capture_output=True, text=True)
    secs = round(time.monotonic() - t0, 3)
    files = sorted(p for p in folder.rglob("*") if p.is_file())
    rels = [str(p.relative_to(folder)) for p in files]
    src_hash = {f: sha(folder / f) for f in rels}
    per_lang = {}
    for lang in langs:
        lf, back = out / lang, out / ".back" / lang
        if not lf.exists():
            per_lang[lang] = {"state": "missing", "files": len(rels), "exact": 0, "localised": 0, "copied": 0}
            continue
        dct = json.loads((lf / ".hindawi/dictionary.json").read_text(encoding="utf-8"))
        exact = localised = copied = 0
        differ = []
        for f in rels:
            b = back / f
            if b.exists() and sha(b) == src_hash[f]:
                exact += 1
            else:
                differ.append(f)
            ing = lf / dct.get("files", {}).get(f, f)
            if ing.exists() and sha(ing) == src_hash[f]:
                copied += 1
            else:
                localised += 1
        js_files = [f for f in rels if Path(f).suffix in JS_SUFFIXES]
        js_localised = sum(1 for f in js_files if sha(lf / dct.get("files", {}).get(f, f)) != src_hash[f]) \
            if all((lf / dct.get("files", {}).get(f, f)).exists() for f in js_files) else None
        gaps = json.loads((lf / ".hindawi/gaps.json").read_text(encoding="utf-8"))
        if exact != len(rels):
            state = "differs"
        elif js_files and js_localised == 0 and localised > 0:
            state = "exact_mixed"          # back byte for byte; other files localised, the JavaScript copied unchanged
        elif js_files and js_localised == 0:
            state = "exact_copied"         # back byte for byte, because BURP copied the JavaScript unchanged
        else:
            state = "exact_localised"
        per_lang[lang] = {"state": state, "files": len(rels), "exact": exact, "localised": localised, "copied": copied,
                          "js_files": len(js_files), "js_localised": js_localised,
                          "unsupported": gaps.get("unsupported", {}), "differ": differ[:20]}
    burp_report = json.loads(js.read_text(encoding="utf-8")) if js.exists() else None
    res = {"subject": subject, "kind": kind, "library": lib, "note": note, "source": rel,
           "files": len(rels), "source_sha256": hashlib.sha256("".join(f"{src_hash[f]}  {f}\n" for f in rels).encode()).hexdigest(),
           "command": " ".join(cmd).replace(str(REPO) + "/", ""), "exit_code": r.returncode, "seconds": secs,
           "stdout_tail": r.stdout[-3000:], "stderr_tail": r.stderr[-3000:],
           "burp_summary": [{k: x[k] for k in ("folder", "files", "exact")} for x in (burp_report or [])],
           "languages": per_lang}
    if not keep:
        shutil.rmtree(out, ignore_errors=True)
    return res


def issue_text(gid, title, body):
    p = OUT / "issues" / f"{gid}.md"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(f"<!-- {NOTICE} SPDX-License-Identifier: CC-BY-SA-4.0 -->\n\n# {title}\n\n{body}\n", encoding="utf-8")
    return str(p.relative_to(REPO))


def admission(res):
    """WEB-03: admitted only when BURP returns the sources byte for byte. A return that is byte for byte only because
    BURP copied files it cannot read is recorded as exact_copied and the library stays pending BURP: the round trip
    then proves nothing about ingestion into the language."""
    states = {v["state"] for v in res["languages"].values()}
    if "error" in res or "missing" in states or "differs" in states:
        return "pending BURP", "round trip not exact in every language (see table)"
    if states == {"exact_localised"}:
        return "admitted", "exact round trip with localisation in every language"
    return "pending BURP", ("every language returns the sources byte for byte, but only because BURP 2026.10.1 copies "
                            ".js and .mjs files unchanged (UNSUPPORTED in burp.py); the JavaScript is not ingested")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--subjects", default=",".join(SUBJECTS))
    ap.add_argument("--langs", default="all")
    ap.add_argument("--keep", action="store_true")
    a = ap.parse_args()
    langs = all_languages() if a.langs == "all" else a.langs.split(",")
    OUT.mkdir(parents=True, exist_ok=True)
    version = burp_version()
    results = []
    for s in a.subjects.split(","):
        print(f"[probe] {s}: burp check on {SUBJECTS[s][0]} in {len(langs)} languages", flush=True)
        res = probe(s, langs, a.keep)
        res["burp_version"] = version
        (OUT / f"{s}.json").write_text(json.dumps({"_notice": NOTICE + " SPDX-License-Identifier: CC0-1.0", **res},
                                                  ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        st = {}
        for v in res.get("languages", {}).values():
            st[v["state"]] = st.get(v["state"], 0) + 1
        print(f"[probe] {s}: exit {res.get('exit_code')}, {res.get('files')} files, {res.get('seconds')} s, states {st}", flush=True)
        results.append(res)
    # merge with earlier results for subjects not rerun, so the table always covers every subject probed
    allres = {}
    for p in sorted(OUT.glob("*.json")):
        d = json.loads(p.read_text(encoding="utf-8"))
        if "subject" in d:
            allres[d["subject"]] = d
    write_tables(allres, langs, version)
    bad = [r["subject"] for r in results if "error" in r]
    return 1 if bad else 0


def write_tables(allres, langs, version):
    subjects = [s for s in SUBJECTS if s in allres]
    with open(OUT / "table.csv", "w", newline="", encoding="utf-8") as f:
        f.write(f"# {NOTICE} SPDX-License-Identifier: CC0-1.0\n")
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["subject", "language", "state", "files", "exact", "localised", "copied", "js_files", "js_localised"])
        for s in subjects:
            for lang, v in sorted(allres[s].get("languages", {}).items()):
                w.writerow([s, lang, v["state"], v["files"], v["exact"], v["localised"], v["copied"],
                            v.get("js_files", ""), v.get("js_localised", "")])
    abbrev = {"exact_copied": "copied", "exact_mixed": "mixed", "exact_localised": "LOCAL", "differs": "DIFFERS", "missing": "missing"}
    md = [f"<!-- {NOTICE} SPDX-License-Identifier: CC-BY-SA-4.0 -->", "", "# BURP probe: library by language", "",
          f"Generated by tools/burp_probe.py from reports/burp/<subject>.json. BURP: {version}.", "",
          "Cell values: `LOCAL` means the round trip is byte for byte and BURP localised the files; `copied` means the "
          "round trip is byte for byte only because BURP copied the files unchanged (it does not read .js or .mjs); "
          "`mixed` means byte for byte, with the files in languages BURP reads localised and the JavaScript copied; "
          "`DIFFERS` means a reversed file differs from its source; `missing` means BURP wrote no folder for the language.", "",
          "## Per subject", "", "| subject | kind | files | burp check exit | seconds | languages exact | languages localised | admission |",
          "|---|---|---|---|---|---|---|---|"]
    for s in subjects:
        r = allres[s]
        L = r.get("languages", {})
        ex = sum(1 for v in L.values() if v["state"] in ("exact_copied", "exact_mixed", "exact_localised"))
        lo = sum(1 for v in L.values() if v["state"] == "exact_localised")
        adm = admission(r)[0] if r["kind"] in ("vendored", "candidate", "own") else r["kind"]
        md.append(f"| {s} | {r['kind']} | {r.get('files')} | {r.get('exit_code')} | {r.get('seconds')} | {ex}/{len(L)} | {lo}/{len(L)} | {adm} |")
    md += ["", "## Commands", ""]
    for s in subjects:
        md.append(f"- {s}: `{allres[s].get('command')}` exit {allres[s].get('exit_code')}")
    md += ["", "## Language by subject", "", "| language | " + " | ".join(subjects) + " |", "|---|" + "---|" * len(subjects)]
    for lang in langs:
        md.append(f"| {lang} | " + " | ".join(abbrev.get(allres[s].get('languages', {}).get(lang, {}).get('state'), '-')
                                             for s in subjects) + " |")
    (OUT / "TABLE.md").write_text("\n".join(md) + "\n", encoding="utf-8")

    # issue texts: one per distinct gap
    issues = []
    js_subjects = [s for s in subjects if any(v["state"] in ("exact_copied", "exact_mixed") for v in allres[s].get("languages", {}).values())]
    if js_subjects:
        ex = allres[js_subjects[0]]
        lang0 = sorted(ex["languages"])[0]
        body = (f"BURP version: {version}\n\n"
                "What happens: `burp check` and `burp ingest` copy every `.js` and `.mjs` file unchanged. burp.py lists both "
                "suffixes in `UNSUPPORTED` (src/burp_ilm/burp/burp.py, line 364 at commit 888778fa34e1540347c2d8b8a763b88da9c937b1) "
                "and `ingest_one` copies such files with `shutil.copy2`, counting them under \"files in languages BURP cannot "
                "read yet\". The reverse then returns them byte for byte, so `burp check` reports success, but no keyword, "
                "identifier or comment of the JavaScript is put into the language.\n\n"
                "Reproduce:\n\n```\n" + ex["command"] + f"\n```\n\nExit code: {ex['exit_code']}\n\n"
                f"Output (tail):\n\n```\n{ex['stdout_tail'][-1500:]}\n{ex['stderr_tail'][-500:]}\n```\n\n"
                f"Subjects affected ({len(js_subjects)}): " + ", ".join(js_subjects) + ".\n\n"
                f"Example, language {lang0}: {json.dumps(ex['languages'][lang0], ensure_ascii=False)}\n\n"
                "The control (tests/burp/control-c, the same function in C) is localised in the same run, which shows the "
                "probe sees localisation where BURP reads the language.\n\n"
                "Asked of BURP's next round: a JavaScript paradigm (ECMAScript 2020 modules: keywords, template literals, "
                "regular-expression literals, `//` and `/* */` comments, import and export names kept as externals when they "
                "name another module's exports), with the byte-for-byte reverse that the other paradigms have.")
        issues.append(issue_text("burp-js-unsupported", "BURP does not read JavaScript: .js and .mjs are copied, not ingested", body))
    for s in subjects:
        r = allres[s]
        bad = {l: v for l, v in r.get("languages", {}).items() if v["state"] in ("differs", "missing")}
        if bad or "error" in r:
            body = (f"BURP version: {version}\n\nCommand:\n\n```\n{r.get('command')}\n```\n\nExit code: {r.get('exit_code')}\n\n"
                    f"Output (tail):\n\n```\n{r.get('stdout_tail', '')[-2000:]}\n{r.get('stderr_tail', '')[-1000:]}\n```\n\n"
                    f"Languages whose reverse differs or is missing: {json.dumps(bad, ensure_ascii=False)[:4000]}\n"
                    + (f"\nError: {r['error']}\n" if "error" in r else ""))
            issues.append(issue_text(f"burp-{s}-differs", f"BURP round trip not exact for {s}", body))

    # ADMISSIONS.csv (Guidelines 4.3; kept at docs/vendor/ADMISSIONS.csv beside the vendored sources)
    adm_path = REPO / "docs" / "vendor" / "ADMISSIONS.csv"
    rows = []
    for s in subjects:
        r = allres[s]
        if r["kind"] not in ("vendored", "candidate") or not r.get("library"):
            continue
        state, why = admission(r)
        L = r.get("languages", {})
        ex = sum(1 for v in L.values() if v["state"] in ("exact_copied", "exact_mixed", "exact_localised"))
        lo = sum(1 for v in L.values() if v["state"] == "exact_localised")
        rows.append([r["library"], r["note"], r["kind"], r["source"], r.get("files"), r.get("source_sha256"), version,
                     f"{ex}/{len(L)}", f"{lo}/{len(L)}", r.get("exit_code"), state, why, f"reports/burp/{s}.json"])
    with open(adm_path, "w", newline="", encoding="utf-8") as f:
        f.write(f"# {NOTICE} SPDX-License-Identifier: CC0-1.0. Generated by tools/burp_probe.py; never edited by hand.\n")
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["library", "what", "where", "source", "files", "files_sha256", "burp", "languages_exact",
                    "languages_localised", "burp_check_exit", "state", "reason", "evidence"])
        w.writerows(rows)
    (OUT / "issues.json").write_text(json.dumps({"_notice": NOTICE + " SPDX-License-Identifier: CC0-1.0", "issues": issues},
                                                indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
