/*
 * calculator.js — DIVISION CALCULATOR (pure logic)
 *
 * A standalone convenience tool. It knows nothing about the Mind Reader game:
 * it takes two strings typed by the player and returns a result description.
 *
 *   dividend = divisor × quotient + remainder,   0 ≤ remainder < |divisor|
 *
 * (Euclidean division: the remainder is never negative. For a positive divisor
 *  this is the usual floor division, e.g. -58 ÷ 7 = -9 remainder 5.)
 *
 * All arithmetic is done with BigInt, so results are exact, and every result
 * is re-checked against the identity above before it is returned.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MRCalculator = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER); // 9007199254740991
  var MAX_SAFE_TEXT = '9,007,199,254,740,991';
  var INTEGER_PATTERN = /^[+-]?[0-9]+$/;

  /**
   * Classify one text field.
   * Returns { state: 'empty' | 'invalid' | 'out-of-range' | 'ok', value: BigInt | null }
   */
  function parseField(text) {
    var s = typeof text === 'string' ? text.trim() : (text === null || text === undefined ? '' : String(text).trim());
    if (s === '') return { state: 'empty', value: null };
    if (!INTEGER_PATTERN.test(s)) return { state: 'invalid', value: null };
    var digits = s.replace(/^[+-]/, '').replace(/^0+/, '');
    if (digits.length > 16) return { state: 'out-of-range', value: null }; // too long to be safe; avoids parsing huge strings
    var v = BigInt(s);
    if (v > MAX_SAFE || v < -MAX_SAFE) return { state: 'out-of-range', value: null };
    return { state: 'ok', value: v };
  }

  function fieldMessage(label, state) {
    if (state === 'invalid') {
      return label + ' must be a whole number: digits only, with an optional leading minus sign (no decimals, commas, spaces or letters).';
    }
    if (state === 'out-of-range') {
      return label + ' is outside the safe integer range (−' + MAX_SAFE_TEXT + ' to ' + MAX_SAFE_TEXT + '), so it cannot be divided exactly.';
    }
    return '';
  }

  function blank(status, fields, message) {
    return {
      status: status, fields: fields, message: message,
      dividend: null, divisor: null, quotient: null, remainder: null, equation: null
    };
  }

  /**
   * calculate(dividendText, divisorText)
   * status: 'ok' | 'empty' | 'invalid' | 'out-of-range' | 'zero-divisor' | 'error'
   * Only when status === 'ok' are dividend/divisor/quotient/remainder (Numbers) and equation (string) set.
   */
  function calculate(dividendText, divisorText) {
    var a = parseField(dividendText);
    var b = parseField(divisorText);
    var fields = { dividend: a.state, divisor: b.state };

    // 1. Field errors take priority (dividend first, both reported).
    var problems = [];
    var dMsg = fieldMessage('Dividend', a.state);
    var vMsg = fieldMessage('Divisor', b.state);
    if (dMsg) problems.push(dMsg);
    if (vMsg) problems.push(vMsg);
    if (problems.length) {
      var kind = (a.state === 'invalid' || b.state === 'invalid') ? 'invalid' : 'out-of-range';
      return blank(kind, fields, problems.join(' '));
    }

    // 2. A zero divisor is rejected even if the dividend is still empty.
    if (b.state === 'ok' && b.value === 0n) {
      fields.divisor = 'zero';
      return blank('zero-divisor', fields,
        'Divisor cannot be zero. Division by zero is undefined, so no quotient or remainder is shown.');
    }

    // 3. Missing input.
    if (a.state === 'empty' && b.state === 'empty') {
      return blank('empty', fields, 'Enter a dividend and a divisor to see the quotient and remainder.');
    }
    if (a.state === 'empty') return blank('empty', fields, 'Enter a dividend to see the quotient and remainder.');
    if (b.state === 'empty') return blank('empty', fields, 'Enter a divisor to see the quotient and remainder.');

    // 4. Exact Euclidean division with BigInt (remainder always 0 ≤ r < |divisor|).
    var x = a.value, y = b.value;
    var q = x / y;
    var r = x % y;
    if (r < 0n) {
      if (y > 0n) { q -= 1n; r += y; } else { q += 1n; r -= y; }
    }

    // 5. Never return something that violates the defining identity or the safe range.
    var absY = y < 0n ? -y : y;
    var consistent = (x === y * q + r) && r >= 0n && r < absY &&
      q <= MAX_SAFE && q >= -MAX_SAFE && r <= MAX_SAFE;
    if (!consistent) {
      return blank('error', fields, 'This calculation could not be verified, so no result is shown.');
    }

    var out = {
      status: 'ok', fields: fields,
      dividend: Number(x), divisor: Number(y), quotient: Number(q), remainder: Number(r)
    };
    out.equation = out.dividend + ' = ' + out.divisor + ' × ' + out.quotient + ' + ' + out.remainder;
    out.message = out.equation + (x < 0n || y < 0n ? ' (the remainder is never negative)' : '');
    return out;
  }

  return {
    calculate: calculate,
    parseField: parseField,
    MAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER
  };
});
