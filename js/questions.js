/*
 * questions.js — QUESTION GENERATION
 *
 * Builds the bank of yes/no mathematical-property questions for one range and
 * validates that no question is a direct number check or a disguised cutoff.
 * Pure functions only: no DOM, no randomness, no I/O.
 *
 * Every question has a stable, parametric id (for example "mod:7:3") so a
 * history of answers can always be re-evaluated from ids alone.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MRQuestions = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SUPPORTED_RANGES = Object.freeze([50, 100, 250, 1000]);

  // Residue questions up to this modulus belong to the standard bank.
  // Larger moduli are only generated adaptively (see adaptive()).
  var BASE_MAX_MODULUS = 30;

  // A question is "legitimate" only if, over the FULL range 1..max:
  //  - both the yes-set and the no-set contain at least MIN_SIDE_SIZE numbers
  //    (so it can never be "is it N?" or "is it one of these two?"), and
  //  - both sets consist of at least MIN_RUNS separate stretches of consecutive
  //    integers (so it can never be a cutoff such as "n >= 100",
  //    "n <= 10" or "exactly two digits" in disguise).
  var MIN_SIDE_SIZE = 3;
  var MIN_RUNS = 3;

  // Wording that would signal a direct check or an ordering/cutoff question.
  var FORBIDDEN_TEXT = /\b(greater|less|higher|lower|bigger|smaller|larger|above|below|between|at least|at most|more than|fewer|exceeds?|equals?|equal to)\b|\bis (it|your number) (exactly )?\d+\b/i;

  /* ---------- exact integer helpers ---------- */

  function isqrt(n) {
    var r = Math.floor(Math.sqrt(n));
    while (r * r > n) r--;
    while ((r + 1) * (r + 1) <= n) r++;
    return r;
  }
  function icbrt(n) {
    var r = Math.round(Math.cbrt(n));
    while (r * r * r > n) r--;
    while ((r + 1) * (r + 1) * (r + 1) <= n) r++;
    return r;
  }
  function isPrime(n) {
    if (n < 2) return false;
    if (n % 2 === 0) return n === 2;
    for (var i = 3; i * i <= n; i += 2) if (n % i === 0) return false;
    return true;
  }
  function isSquare(n) { var r = isqrt(n); return r * r === n; }
  function isCube(n) { var r = icbrt(n); return r * r * r === n; }
  function isSquareFree(n) {
    for (var p = 2; p * p <= n; p++) if (n % (p * p) === 0) return false;
    return true;
  }
  function digitsOf(n) {
    var d = [];
    for (var x = n; x > 0; x = Math.floor(x / 10)) d.push(x % 10);
    return d.reverse();
  }
  function digitSum(n) {
    var s = 0;
    for (var x = n; x > 0; x = Math.floor(x / 10)) s += x % 10;
    return s;
  }
  function hasRepeatedDigit(n) {
    var d = digitsOf(n), seen = {};
    for (var i = 0; i < d.length; i++) { if (seen[d[i]]) return true; seen[d[i]] = true; }
    return false;
  }
  function isPalindrome(n) {
    var s = String(n);
    return s === s.split('').reverse().join('');
  }

  /* ---------- question constructors ---------- */

  function def(id, text, tag, complexity, test, adaptive) {
    return Object.freeze({ id: id, text: text, tag: tag, complexity: complexity, test: test, adaptive: !!adaptive });
  }

  function modQuestion(m, r) {
    var adaptive = m > BASE_MAX_MODULUS;
    var text, tag, complexity;
    if (r === 0) {
      text = 'Is your number divisible by ' + m + '?';
      tag = 'Divisibility';
      complexity = m <= 10 ? 1 : 2;
    } else if (m === 10) {
      text = 'Does your number end in the digit ' + r + '?';
      tag = 'Digit property';
      complexity = 1;
    } else {
      text = 'When your number is divided by ' + m + ', is the remainder ' + r + '?';
      tag = 'Remainder';
      complexity = m <= 13 ? 2 : 3;
    }
    return def('mod:' + m + ':' + r, text, tag, adaptive ? 4 : complexity,
      function (n) { return n % m === r; }, adaptive);
  }

  function digitSumModQuestion(k, r) {
    var text = r === 0
      ? 'When you add up the digits of your number, is the total divisible by ' + k + '?'
      : 'When you add up the digits of your number and divide the total by ' + k + ', is the remainder ' + r + '?';
    return def('dsm:' + k + ':' + r, text, 'Digit property', 4,
      function (n) { return digitSum(n) % k === r; }, true);
  }

  // Every definition the standard bank may contain, in priority order.
  // Earlier definitions win when two questions split the range identically.
  function baseDefinitions() {
    var d = [];
    d.push(def('even', 'Is your number even?', 'Parity', 1, function (n) { return n % 2 === 0; }));
    d.push(def('prime', 'Is your number a prime number?', 'Prime', 2, isPrime));
    d.push(def('square', 'Is your number a perfect square?', 'Perfect power', 2, isSquare));
    d.push(def('cube', 'Is your number a perfect cube?', 'Perfect power', 2, isCube));
    for (var m = 3; m <= BASE_MAX_MODULUS; m++) {
      for (var r = 0; r < m; r++) d.push(modQuestion(m, r));
    }
    d.push(def('dsum:even', 'Is the sum of its digits even?', 'Digit property', 2,
      function (n) { return digitSum(n) % 2 === 0; }));
    d.push(def('dsum:prime', 'Is the sum of its digits a prime number?', 'Digit property', 2,
      function (n) { return isPrime(digitSum(n)); }));
    d.push(def('dsum:square', 'Is the sum of its digits a perfect square?', 'Digit property', 2,
      function (n) { return isSquare(digitSum(n)); }));
    for (var dg = 0; dg <= 9; dg++) {
      (function (digit) {
        d.push(def('has:' + digit, 'Does your number contain the digit ' + digit + '?', 'Digit property', 1,
          function (n) { return digitsOf(n).indexOf(digit) !== -1; }));
      })(dg);
    }
    d.push(def('rep', 'Does your number contain a repeated digit?', 'Digit property', 2, hasRepeatedDigit));
    d.push(def('allodd', 'Are all the digits of your number odd?', 'Digit property', 1,
      function (n) { return digitsOf(n).every(function (x) { return x % 2 === 1; }); }));
    d.push(def('alleven', 'Are all the digits of your number even?', 'Digit property', 1,
      function (n) { return digitsOf(n).every(function (x) { return x % 2 === 0; }); }));
    d.push(def('firsteven', 'Is the first (leftmost) digit of your number even?', 'Digit property', 2,
      function (n) { return digitsOf(n)[0] % 2 === 0; }));
    d.push(def('palin', 'Does your number read the same forwards and backwards?', 'Digit property', 2, isPalindrome));
    d.push(def('squarefree', 'Is your number square-free (not divisible by any perfect square except 1)?', 'Factors', 3, isSquareFree));
    return d;
  }

  /* ---------- legitimacy analysis ---------- */

  // One pass over 1..max: counts and runs for both sides plus a bitmap signature.
  function profile(test, max) {
    var yes = 0, runsYes = 0, runsNo = 0, prev = -1, bits = new Array(max);
    for (var n = 1; n <= max; n++) {
      var v = test(n) ? 1 : 0;
      bits[n - 1] = v;
      yes += v;
      if (v !== prev) { if (v) runsYes++; else runsNo++; }
      prev = v;
    }
    return { yes: yes, no: max - yes, runsYes: runsYes, runsNo: runsNo, sig: bits.join('') };
  }
  function isLegitProfile(p) {
    return p.yes >= MIN_SIDE_SIZE && p.no >= MIN_SIDE_SIZE && p.runsYes >= MIN_RUNS && p.runsNo >= MIN_RUNS;
  }
  function complementSig(sig) {
    return sig.replace(/[01]/g, function (c) { return c === '1' ? '0' : '1'; });
  }
  function isLegitQuestion(q, max) {
    return !FORBIDDEN_TEXT.test(q.text) && isLegitProfile(profile(q.test, max));
  }

  // Size of the residue class {n in 1..max : n % m === r}.
  function modClassSize(max, m, r) {
    if (r === 0) return Math.floor(max / m);
    if (r > max) return 0;
    return Math.floor((max - r) / m) + 1;
  }

  /* ---------- question source for one range ---------- */

  var sourceCache = {};

  /**
   * createQuestionSource(max, options?)
   *   base           standard bank: legitimate, de-duplicated questions
   *   byId(id)       resolve any question id (standard or adaptive) or null
   *   adaptive(candidates, usedIds)
   *                  generate further legitimate questions that split the
   *                  given candidates; only used when `base` cannot.
   *   options.baseFilter(def) -> boolean   (tests only: restrict the bank)
   */
  function createQuestionSource(max, options) {
    if (SUPPORTED_RANGES.indexOf(max) === -1) throw new RangeError('Unsupported range: ' + max);
    var filter = options && options.baseFilter;
    if (!filter && sourceCache[max]) return sourceCache[max];

    var defs = baseDefinitions();
    var allById = new Map();
    defs.forEach(function (q) { allById.set(q.id, q); });

    var base = [];
    var seen = new Set();
    defs.forEach(function (q) {
      if (filter && !filter(q)) return;
      var p = profile(q.test, max);
      if (!isLegitProfile(p)) return;
      if (seen.has(p.sig) || seen.has(complementSig(p.sig))) return; // redundant partition
      seen.add(p.sig);
      base.push(q);
    });
    var baseIds = new Set(base.map(function (q) { return q.id; }));
    var extra = new Map();

    function parseExtra(id) {
      var parts = id.split(':');
      if (parts.length !== 3) return null;
      var a = Number(parts[1]), b = Number(parts[2]);
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 3 || b < 0 || b >= a) return null;
      var q = null;
      if (parts[0] === 'mod' && a <= Math.floor(max / MIN_SIDE_SIZE)) q = modQuestion(a, b);
      else if (parts[0] === 'dsm' && a <= 12) q = digitSumModQuestion(a, b);
      return q && isLegitQuestion(q, max) ? q : null;
    }

    function byId(id) {
      if (allById.has(id)) return allById.get(id);
      if (extra.has(id)) return extra.get(id);
      var q = parseExtra(id);
      if (q) extra.set(id, q);
      return q;
    }

    // Adaptive generation: search wider residue / digit-sum families for
    // legitimate questions that split THESE candidates, best splits first.
    function adaptive(candidates, usedIds) {
      var total = candidates.length;
      var found = [];
      var mMax = Math.floor(max / MIN_SIDE_SIZE);
      var m, k, r, i;

      function consider(id, yes) {
        if (yes === total || usedIds.has(id) || baseIds.has(id)) return;
        found.push({ id: id, cost: yes * yes + (total - yes) * (total - yes) });
      }

      for (m = 3; m <= mMax; m++) {
        var counts = new Map();
        for (i = 0; i < total; i++) {
          r = candidates[i] % m;
          counts.set(r, (counts.get(r) || 0) + 1);
        }
        counts.forEach(function (yes, res) {
          var size = modClassSize(max, m, res);
          if (size < MIN_SIDE_SIZE || max - size < MIN_SIDE_SIZE) return;
          consider('mod:' + m + ':' + res, yes);
        });
      }
      for (k = 3; k <= 12; k++) {
        var dcounts = new Map();
        for (i = 0; i < total; i++) {
          r = digitSum(candidates[i]) % k;
          dcounts.set(r, (dcounts.get(r) || 0) + 1);
        }
        dcounts.forEach(function (yes, res) { consider('dsm:' + k + ':' + res, yes); });
      }

      found.sort(function (a, b) { return a.cost - b.cost || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); });
      var out = [];
      for (var f = 0; f < found.length && out.length < 40; f++) {
        var q = byId(found[f].id);
        if (q && isLegitQuestion(q, max)) out.push(q);
      }
      return out;
    }

    var source = {
      max: max,
      base: Object.freeze(base),
      byId: byId,
      adaptive: adaptive,
      selectionCache: new Map()
    };
    if (!filter) sourceCache[max] = source;
    return source;
  }

  return {
    SUPPORTED_RANGES: SUPPORTED_RANGES,
    BASE_MAX_MODULUS: BASE_MAX_MODULUS,
    MIN_SIDE_SIZE: MIN_SIDE_SIZE,
    MIN_RUNS: MIN_RUNS,
    FORBIDDEN_TEXT: FORBIDDEN_TEXT,
    createQuestionSource: createQuestionSource,
    profile: profile,
    isLegitProfile: isLegitProfile,
    isLegitQuestion: isLegitQuestion,
    helpers: {
      isPrime: isPrime, isSquare: isSquare, isCube: isCube, isSquareFree: isSquareFree,
      digitSum: digitSum, digitsOf: digitsOf, isqrt: isqrt, icbrt: icbrt
    }
  };
});
