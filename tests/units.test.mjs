// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
// UCUM units (SUB-05). Expected factors are the definitions in UCUM (unitsofmeasure.org, ucum-essence.xml):
// min = 60 s, h = 60 min, d = 24 h, deg = pi/180 rad, Cel = K + 273.15, l = dm3, t = 1000 kg, % = 1/100.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUnit, toSI, fromSI, convert, sameDimension, dimensionString } from '../docs/src/units.js';

const close = (a, b, rel = 1e-15) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${a} vs ${b}`);

test('time units', () => {
  assert.equal(toSI(1, 'min'), 60);
  assert.equal(toSI(1, 'h'), 3600);
  assert.equal(toSI(1, 'd'), 86400);
  assert.equal(toSI(1, 'ms'), 1e-3);
  close(toSI(2, 'us'), 2e-6);
});

test('prefixes and compound units', () => {
  assert.equal(toSI(1, 'kg'), 1);
  assert.equal(toSI(1, 'g'), 1e-3);
  assert.equal(toSI(1, 'mm'), 1e-3);
  assert.equal(toSI(1, 'kOhm'), 1e3);
  close(toSI(1, 'nF'), 1e-9);
  close(convert(36, 'km/h', 'm/s'), 10);
  assert.equal(dimensionString('N.m'), 'm2.kg.s-2');
  assert.equal(dimensionString('kg.m2/s2'), 'm2.kg.s-2');
  assert.ok(sameDimension('J', 'N.m'));
  assert.ok(sameDimension('W', 'V.A'));
  assert.ok(sameDimension('Hz', 's-1'));
  assert.ok(sameDimension('Hz', '/s'));
  assert.equal(dimensionString('rad/s'), 's-1.rad');
  assert.equal(toSI(1, 'l'), 1e-3);
  assert.equal(toSI(1, 't'), 1000);
  assert.equal(toSI(8, 'bit'), toSI(1, 'By'));
});

test('angles, percent, temperature, dimensionless', () => {
  close(toSI(180, 'deg'), Math.PI);
  close(toSI(1, 'circ'), 2 * Math.PI);
  assert.equal(toSI(5, '%'), 0.05);
  close(toSI(25, 'Cel'), 298.15);
  close(fromSI(273.15, 'Cel'), 0);
  assert.ok(parseUnit('1').dimensionless);
  assert.ok(parseUnit('{rev}').dimensionless);
  assert.ok(!parseUnit('rad').dimensionless, 'UCUM keeps the radian as a base unit');
});

test('refusals', () => {
  assert.throws(() => parseUnit('furlong'), { code: 'UNIT' });
  assert.throws(() => parseUnit(''), { code: 'UNIT' });
  assert.throws(() => parseUnit('Cel2'), { code: 'UNIT' });
  assert.throws(() => parseUnit('m/'), { code: 'UNIT' });
  assert.throws(() => convert(1, 'm', 's'), { code: 'UNIT' });
});
