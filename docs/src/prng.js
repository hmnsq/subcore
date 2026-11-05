// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Seeded random numbers (Guidelines 5 and 6.2). Math.random is never used.
//   SplitMix64 (Steele, Lea and Flood 2014; Vigna's reference splitmix64.c), in BigInt, exact.
//   xoshiro128** 1.1 (Blackman and Vigna 2018; reference xoshiro128starstar.c), in 32-bit integer arithmetic.
// Both are checked against published reference vectors (vectors/prng/, from the tests of the rand_xoshiro
// 0.6.0 crate, which state they were produced with the reference C implementations).
// createRng(seed) seeds xoshiro128** from SplitMix64 as the xoshiro authors recommend: two SplitMix64 outputs,
// each split into its low and high 32-bit words, give the four state words.

const M64 = (1n << 64n) - 1n;

export class SplitMix64 {
  constructor(seed) { this.x = BigInt.asUintN(64, BigInt(seed)); }
  // next 64-bit output as a BigInt
  next() {
    this.x = (this.x + 0x9e3779b97f4a7c15n) & M64;
    let z = this.x;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & M64;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & M64;
    return z ^ (z >> 31n);
  }
}

const rotl = (x, k) => ((x << k) | (x >>> (32 - k))) >>> 0;

export class Xoshiro128ss {
  // state: four unsigned 32-bit words, not all zero
  constructor(state) {
    this.s = Uint32Array.from(state);
    if (this.s.every((w) => w === 0)) throw new Error('xoshiro128**: the state must not be all zero');
  }
  // next unsigned 32-bit output
  nextU32() {
    const s = this.s;
    const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1] << 9) >>> 0;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 11);
    return result;
  }
  // uniform double in [0, 1) with 53 random bits (two outputs: 27 high bits and 26 low bits)
  nextFloat() {
    const a = this.nextU32() >>> 5, b = this.nextU32() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  }
  // standard normal deviate by the Box-Muller transform (uses Math.log, Math.sqrt, Math.cos)
  nextNormal() {
    let u = 0;
    while (u === 0) u = this.nextFloat();
    const v = this.nextFloat();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

export function createRng(seed) {
  const sm = new SplitMix64(seed);
  const a = sm.next(), b = sm.next();
  const w = [a & 0xffffffffn, a >> 32n, b & 0xffffffffn, b >> 32n].map(Number);
  return new Xoshiro128ss(w);
}
