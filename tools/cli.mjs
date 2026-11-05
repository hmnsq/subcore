#!/usr/bin/env node
// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// The headless command surface for Node.js: the same runCli as the page, with file-system io.
//   node tools/cli.mjs run spec/models/lorenz.yaml --solver rk4 --out lorenz.csv
import fs from 'node:fs';
import { runCli } from '../docs/src/cli.js';

const io = {
  readText: (p) => fs.readFileSync(p, 'utf8'),
  writeText: (p, t) => (p === '-' ? process.stdout.write(t) : fs.writeFileSync(p, t)),
  log: (l) => process.stderr.write(l + '\n'),
};
process.exitCode = runCli(process.argv.slice(2), io);
