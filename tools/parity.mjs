// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Node.js against browsers (WEB-06, T-33). Serves the repository from a local static server on 127.0.0.1,
// runs tests/parity_cases.mjs in Node.js and in each browser through Playwright (headless), and compares the
// required cases (fixed-step traces and integer generator output): Chromium must give byte-identical texts;
// Firefox and WebKit must stay within the Test Plan's cross-engine bound (maximum relative difference 1e-12,
// floor 1e-300) on every number. Other cases (adaptive runs, function tables, normal deviates) are recorded
// with their largest difference and are not part of the criterion.
//   node tools/parity.mjs [--browsers chromium,firefox,webkit] [--out reports/parity/S1.json]
// Exit 0 when every browser that ran met its criterion and Chromium ran; a browser that cannot be launched
// here is recorded as not run, with the launcher's message.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { REPO } from './record.mjs';
import { runCases, REQUIRED } from '../tests/parity_cases.mjs';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const browsers = opt('--browsers', 'chromium,firefox,webkit').split(',');
const outFile = path.resolve(REPO, opt('--out', 'reports/parity/S1.json'));
const sha = (t) => createHash('sha256').update(t).digest('hex');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.yaml': 'text/plain', '.json': 'application/json', '.css': 'text/css' };

function serve() {
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const p = path.normalize(path.join(REPO, u));
    if (!p.startsWith(REPO) || p.includes(`${path.sep}.cache`) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

function numbers(text) {
  return text.split('\n').filter((l) => l && !l.startsWith('#')).flatMap((l) => l.split(/[,\s]+/)).map(Number).filter((x) => !Number.isNaN(x));
}

function maxRel(a, b) {
  const x = numbers(a), y = numbers(b);
  if (x.length !== y.length) return Infinity;
  let m = 0;
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i] - y[i]) / Math.max(Math.abs(y[i]), 1e-300));
  return m;
}

const node = await runCases(async (p) => fs.readFileSync(path.join(REPO, p), 'utf8'));
console.log(`node ${process.version}: ${Object.keys(node).length} cases`);
const server = await serve();
const port = server.address().port;
const pw = require('playwright');
const report = { node: process.version, playwright: require('playwright/package.json').version, cases: {}, browsers: {} };
for (const [k, t] of Object.entries(node)) report.cases[k] = { node_sha256: sha(t), bytes: t.length };
let ok = true;
for (const name of browsers) {
  const b = { ran: false };
  report.browsers[name] = b;
  let browser;
  try {
    browser = await pw[name].launch();
  } catch (e) {
    b.not_run = e.message.split('\n')[0];
    console.log(`${name}: not run: ${b.not_run}`);
    if (name === 'chromium') ok = false;
    continue;
  }
  b.version = browser.version();
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(m.text()));
  await page.goto(`http://127.0.0.1:${port}/tests/parity.html`);
  await page.waitForFunction(() => document.getElementById('state').textContent !== 'running', null, { timeout: 120000 });
  const err = await page.evaluate(() => window.parityError || null);
  if (err) { b.error = err; ok = false; console.log(`${name}: error ${err}`); await browser.close(); continue; }
  const res = await page.evaluate(() => window.parityResult);
  await browser.close();
  b.ran = true;
  b.cases = {};
  let identical = 0, within = 0;
  for (const [k, t] of Object.entries(node)) {
    const bt = res[k];
    const same = bt === t;
    const rel = same ? 0 : (k === 'prng.u32.txt' ? 'differs' : maxRel(bt, t));
    b.cases[k] = { required: REQUIRED.includes(k), sha256: sha(bt || ''), identical: same, max_relative_difference: rel };
    if (REQUIRED.includes(k)) { identical += same; within += rel === 0 || rel <= 1e-12; }
  }
  const n = REQUIRED.length;
  b.identical = `${identical}/${n}`;
  b.within_cross_engine_bound = `${within}/${n}`;
  b.criterion = name === 'chromium' ? 'byte-identical' : 'maximum relative difference 1e-12';
  b.passed = name === 'chromium' ? identical === n : within === n;
  if (!b.passed) ok = false;
  console.log(`${name} ${b.version}: required cases ${identical}/${n} byte-identical, ${within}/${n} within 1e-12: ${b.passed ? 'pass' : 'FAIL'}`);
  for (const [k, c] of Object.entries(b.cases)) console.log(`  ${c.required ? 'required ' : 'reported '} ${k}: ${c.identical ? 'byte-identical' : `differs, max relative ${c.max_relative_difference}`}`);
}
server.close();
report.passed = ok;
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify({ _notice: '© 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI. SPDX-License-Identifier: CC0-1.0', ...report }, null, 1) + '\n');
console.log(`parity: ${ok ? 'pass' : 'FAIL'}; report ${path.relative(REPO, outFile)}`);
process.exit(ok ? 0 : 1);
