// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Vendors a library from its npm registry tarball as readable source (Guidelines 6.1, steps 1 to 3).
//   node tools/vendor.mjs <name> [--check]
// The tarball is fetched with `npm pack` into .cache/npm/, its sha512 integrity is checked against the
// value pinned below, the chosen files are copied unchanged into docs/vendor/<name>/<version>/, and
// PROVENANCE is written with the sha256 of every file. --check recomputes and compares without writing.
// Vendored files are never edited; LICENCE is a byte copy of the upstream licence file.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from './record.mjs';

export const LIBRARIES = {
  mathjs: {
    version: '15.2.0', npm: 'mathjs@15.2.0', spdx: 'Apache-2.0',
    upstream: 'https://github.com/josdejong/mathjs', tag: 'v15.2.0', commit: 'fee4561840043a7473962367bbae6f15bbb3cebb',
    integrity: 'sha512-UAQzSVob9rNLdGpqcFMYmSu9dkuLYy7Lr2hBEQS5SHQdknA9VppJz3cy2KkpMzTODunad6V6cNv+5kOLsePLow==',
    licence: 'LICENSE', include: ['lib/esm', 'NOTICE', 'package.json'],
    note: 'ES module build (lib/esm) as published in the npm tarball; upstream compiles src/ with Babel. '
      + 'Its modules import bare specifiers of its npm dependencies (typed-function, decimal.js, complex.js, '
      + 'fraction.js, @babel/runtime and others), which are not vendored here.',
  },
  'js-yaml': {
    version: '5.5.0', npm: 'js-yaml@5.5.0', spdx: 'MIT',
    upstream: 'https://github.com/nodeca/js-yaml', tag: '5.5.0', commit: 'cb62b2dbbaa0b3e7379d83a5d69d8d52d21b6efb',
    integrity: 'sha512-paNr4LFIFPjeeSmwNYdrb8FafLLG/Cr2Af3GjbsHJ5CxIjH4r0c2emlmRdAtpPAieP1gRVzk6buBbVP5gBMGAg==',
    licence: 'LICENSE', include: ['dist/js-yaml.mjs', 'package.json'],
    note: 'Single readable ES module (dist/js-yaml.mjs, unminified, comments kept) as published in the npm '
      + 'tarball; upstream writes the source in TypeScript (src/*.ts) and builds this file. It has no imports.',
  },
};

function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }

function walk(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base)); else out.push(path.relative(base, p));
  }
  return out;
}

function fetchTarball(lib) {
  const cache = path.join(REPO, '.cache', 'npm');
  fs.mkdirSync(cache, { recursive: true });
  const out = execFileSync('npm', ['pack', lib.npm, '--json'], { cwd: cache, encoding: 'utf8' });
  const info = JSON.parse(out)[0];
  if (info.integrity !== lib.integrity) {
    throw new Error(`vendor: integrity mismatch for ${lib.npm}: got ${info.integrity}, pinned ${lib.integrity}`);
  }
  const tgz = path.join(cache, info.filename);
  const x = path.join(cache, `x_${info.filename.replace(/\.tgz$/, '')}`);
  fs.rmSync(x, { recursive: true, force: true });
  fs.mkdirSync(x, { recursive: true });
  execFileSync('tar', ['-xzf', tgz, '-C', x]);
  return { root: path.join(x, 'package'), tgz, tgzSha256: sha256(fs.readFileSync(tgz)) };
}

export function provenanceText(name, lib, tgzSha256, files) {
  const lines = [
    '© 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI. (this PROVENANCE file only)',
    'SPDX-License-Identifier: CC0-1.0 (this PROVENANCE file only; the vendored files keep their own licence)',
    '',
    `library: ${name}`,
    `version: ${lib.version}`,
    `licence: ${lib.spdx} (LICENCE is a byte copy of upstream ${lib.licence})`,
    `upstream: ${lib.upstream}`,
    `tag: ${lib.tag}`,
    `commit: ${lib.commit} (gitHead recorded in the npm registry metadata)`,
    `fetched_from: npm registry tarball ${lib.npm}`,
    `tarball_integrity: ${lib.integrity}`,
    `tarball_sha256: ${tgzSha256}`,
    `generator: tools/vendor.mjs`,
    `note: ${lib.note}`,
    '',
    'sha256 of every vendored file (path relative to this folder):',
  ];
  for (const [f, h] of files) lines.push(`${h}  ${f}`);
  return lines.join('\n') + '\n';
}

export function vendor(name, check = false) {
  const lib = LIBRARIES[name];
  if (!lib) throw new Error(`vendor: unknown library ${name}`);
  const { root, tgzSha256 } = fetchTarball(lib);
  const dest = path.join(REPO, 'docs', 'vendor', name, lib.version);
  const plan = [];
  for (const inc of lib.include) {
    const src = path.join(root, inc);
    if (fs.statSync(src).isDirectory()) {
      for (const f of walk(src)) plan.push([path.join(inc, f), path.join(src, f)]);
    } else plan.push([inc, src]);
  }
  plan.push(['LICENCE', path.join(root, lib.licence)]);
  plan.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const files = plan.map(([rel, src]) => [rel, sha256(fs.readFileSync(src))]);
  const prov = provenanceText(name, lib, tgzSha256, files);
  if (check) {
    let bad = 0;
    for (const [rel, h] of files) {
      const p = path.join(dest, rel);
      if (!fs.existsSync(p) || sha256(fs.readFileSync(p)) !== h) { console.log(`differs: ${rel}`); bad++; }
    }
    const provNow = fs.existsSync(path.join(dest, 'PROVENANCE')) ? fs.readFileSync(path.join(dest, 'PROVENANCE'), 'utf8') : '';
    if (provNow !== prov) { console.log('differs: PROVENANCE'); bad++; }
    console.log(`vendor --check ${name} ${lib.version}: ${files.length} files, ${bad} differ`);
    return bad;
  }
  fs.rmSync(dest, { recursive: true, force: true });
  for (const [rel, src] of plan) {
    const d = path.join(dest, rel);
    fs.mkdirSync(path.dirname(d), { recursive: true });
    fs.copyFileSync(src, d);
  }
  fs.writeFileSync(path.join(dest, 'PROVENANCE'), prov);
  console.log(`vendored ${name} ${lib.version}: ${files.length} files into ${path.relative(REPO, dest)}`);
  return 0;
}

const args = process.argv.slice(2);
if (args.length && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const check = args.includes('--check');
  const names = args.filter((a) => !a.startsWith('--'));
  let bad = 0;
  for (const n of (names.length ? names : Object.keys(LIBRARIES))) bad += vendor(n, check);
  process.exit(bad ? 1 : 0);
}
