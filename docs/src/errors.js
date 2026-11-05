// © 1993–2026 Abhishek Choudhary. All rights reserved. AyeAI.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Errors carry a code and the path of the element or field that caused them (Guidelines 5).

export class SubcoreError extends Error {
  // code: a short upper-case identifier such as PARSE, UNIT, NONFINITE; path: where it happened
  constructor(code, path, message, detail = undefined) {
    super(`${code} at ${path || '(root)'}: ${message}`);
    this.name = 'SubcoreError';
    this.code = code;
    this.path = path || '';
    if (detail !== undefined) this.detail = detail;
  }
}

// An unimplemented function raises rather than returning a plausible value.
export function notImplemented(what) {
  throw new SubcoreError('NOT_IMPLEMENTED', what, 'not implemented');
}
