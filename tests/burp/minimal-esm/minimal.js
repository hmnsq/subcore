// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
// A minimal ES module for the BURP probe: a function, a constant, a loop, a string and comments.

/* Multiply-free sum of the first n integers. */
export const LIMIT = 100;

export function sumTo(count) {
  let total = 0;
  for (let index = 1; index <= count && index <= LIMIT; index++) {
    total += index; // add the next integer
  }
  return total;
}

export default function describe(count) {
  return `sum of 1..${count} is ${sumTo(count)}`;
}
