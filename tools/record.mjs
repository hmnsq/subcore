// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Run records (PRV-01) for hmnsq/subcore.
//
// As a library:  import { writeRecord, sha256File } from './record.mjs'
// As a command:  node tools/record.mjs --packet P9.4 --step parity [--inputs a,b] [--outputs c,d]
//                  [--results results.json] [--tool name=version ...] -- <command> <args...>
// The command runs with inherited working directory; its output goes to the terminal and to
// records/logs/<stamp>_<packet>_<step>.log. The record's state is done when the command exits 0
// and failed otherwise, unless --state overrides it (for example wired_unproven).

import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function sha256File(p) {
  return createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function listFiles(p) {
  const st = fs.statSync(p);
  if (st.isFile()) return [p];
  const out = [];
  for (const e of fs.readdirSync(p).sort()) {
    if (e === '.git' || e === '.cache' || e === 'node_modules') continue;
    out.push(...listFiles(path.join(p, e)));
  }
  return out;
}

// Map of repository-relative path to sha256 for every file under the given paths.
export function hashPaths(paths) {
  const m = {};
  for (const p of paths || []) {
    const abs = path.resolve(REPO, p);
    if (!fs.existsSync(abs)) { m[p] = 'missing'; continue; }
    for (const f of listFiles(abs)) m[path.relative(REPO, f)] = sha256File(f);
  }
  return m;
}

export function compactUtc(d = new Date()) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

function versionOf(cmd, args) {
  try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).split('\n')[0].trim(); } catch (e) { return undefined; }
}

// Versions of the tools a command uses, read from the tools themselves (never recalled).
export function toolVersions(extra = {}, command = '') {
  const v = { node: process.version };
  if (/python3|\.py\b|selftest|regen_check/.test(command)) v.python = versionOf('python3', ['--version']);
  if (/burp/.test(command)) v.burp = versionOf('burp', ['--version']);
  if (/ngspice|ref\.sh/.test(command)) v.ngspice = versionOf('sh', ['-c', 'ngspice --version 2>&1 | grep -m1 ngspice']);
  if (/parity|mathcheck/.test(command)) {
    try { v.playwright = createRequire(import.meta.url)('playwright/package.json').version; } catch (e) { v.playwright = 'not found'; }
  }
  for (const k of Object.keys(v)) if (v[k] === undefined) delete v[k];
  return { ...v, ...extra };
}

// The container image a step ran in, passed by ops/run.sh in SUBCORE_IMAGE and SUBCORE_IMAGE_ID.
export function imageDigests() {
  return process.env.SUBCORE_IMAGE ? { [process.env.SUBCORE_IMAGE]: process.env.SUBCORE_IMAGE_ID || 'unknown' } : {};
}

const STATES = new Set(['done', 'wired_unproven', 'not_built', 'failed']);

export function writeRecord(rec) {
  for (const k of ['packet', 'step', 'command', 'exit_code', 'started_utc', 'finished_utc', 'state']) {
    if (rec[k] === undefined) throw new Error(`record: missing key ${k}`);
  }
  if (!STATES.has(rec.state)) throw new Error(`record: bad state ${rec.state}`);
  const full = {
    packet: rec.packet,
    step: rec.step,
    command: rec.command,
    exit_code: rec.exit_code,
    started_utc: rec.started_utc,
    finished_utc: rec.finished_utc,
    inputs: rec.inputs || {},
    outputs: rec.outputs || {},
    tool_versions: rec.tool_versions || toolVersions({}, rec.command),
    image_digests: rec.image_digests || imageDigests(),
    results: rec.results || {},
    state: rec.state,
    notes: rec.notes || '',
  };
  const dir = path.join(REPO, 'records');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = compactUtc(new Date(rec.started_utc));
  const safeStep = String(rec.step).replace(/[^A-Za-z0-9_.-]/g, '_');
  let file = path.join(dir, `${stamp}_${rec.packet}_${safeStep}.json`);
  let k = 2;
  while (fs.existsSync(file)) file = path.join(dir, `${stamp}_${rec.packet}_${safeStep}_${k++}.json`);
  fs.writeFileSync(file, JSON.stringify(full, null, 1) + '\n');
  return path.relative(REPO, file);
}

function parseArgs(argv) {
  const a = { inputs: [], outputs: [], tools: {}, results: null, state: null, notes: '' };
  let i = 0;
  for (; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--') { i++; break; }
    const v = argv[i + 1];
    if (x === '--packet') { a.packet = v; i++; }
    else if (x === '--step') { a.step = v; i++; }
    else if (x === '--inputs') { a.inputs = v.split(',').filter(Boolean); i++; }
    else if (x === '--outputs') { a.outputs = v.split(',').filter(Boolean); i++; }
    else if (x === '--results') { a.results = v; i++; }
    else if (x === '--state') { a.state = v; i++; }
    else if (x === '--notes') { a.notes = v; i++; }
    else if (x === '--tool') { const [n, ...r] = v.split('='); a.tools[n] = r.join('='); i++; }
    else throw new Error(`record.mjs: unknown option ${x}`);
  }
  a.cmd = argv.slice(i);
  if (!a.packet || !a.step || a.cmd.length === 0) {
    throw new Error('usage: node tools/record.mjs --packet P --step S [--inputs ..] [--outputs ..] [--results f] -- cmd ...');
  }
  return a;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const started = new Date();
  const logDir = path.join(REPO, 'records', 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const logRel = path.join('records', 'logs', `${compactUtc(started)}_${a.packet}_${a.step.replace(/[^A-Za-z0-9_.-]/g, '_')}.log`);
  const log = fs.createWriteStream(path.join(REPO, logRel));
  log.write(`$ ${a.cmd.join(' ')}\n`);
  console.error(`[record] ${a.packet} ${a.step}: ${a.cmd.join(' ')}`);
  const code = await new Promise((resolve) => {
    const p = spawn(a.cmd[0], a.cmd.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', (d) => { process.stdout.write(d); log.write(d); });
    p.stderr.on('data', (d) => { process.stderr.write(d); log.write(d); });
    p.on('error', (e) => { log.write(`spawn error: ${e.message}\n`); resolve(127); });
    p.on('close', (c, sig) => resolve(c === null ? 128 : c));
  });
  const finished = new Date();
  log.write(`\n[exit ${code}]\n`);
  await new Promise((r) => log.end(r));
  let results = {};
  if (a.results && fs.existsSync(path.resolve(REPO, a.results))) {
    results = JSON.parse(fs.readFileSync(path.resolve(REPO, a.results), 'utf8'));
  }
  const outputs = hashPaths(a.outputs);
  outputs[logRel] = sha256File(path.join(REPO, logRel));
  const rec = writeRecord({
    packet: a.packet, step: a.step, command: a.cmd.join(' '), exit_code: code,
    started_utc: started.toISOString(), finished_utc: finished.toISOString(),
    inputs: hashPaths(a.inputs), outputs, tool_versions: toolVersions(a.tools, a.cmd.join(' ')),
    results, state: a.state || (code === 0 ? 'done' : 'failed'),
    notes: a.notes + (a.notes ? ' ' : '') + `log: ${logRel}`,
  });
  console.error(`[record] ${a.packet} ${a.step}: exit ${code}; record ${rec}`);
  process.exit(code);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(2); });
}
