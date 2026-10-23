#!/usr/bin/env node
/*
 * Division Calculator tests (no dependencies, Node 14+).
 *
 *   node tests/calculator-test.js                 run, print summary
 *   node tests/calculator-test.js --write-report  also write tests/CALCULATOR_RESULTS.md
 *
 * Exit code is 0 only if every check passed.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var ROOT = path.join(__dirname, '..');
var C = require(path.join(ROOT, 'js', 'calculator.js'));
var WRITE_REPORT = process.argv.indexOf('--write-report') !== -1;

var results = [];
var group = '';
function section(name) { group = name; console.log('\n== ' + name); }
function check(name, cond, detail) {
  results.push({ group: group, name: name, pass: !!cond, detail: detail || '' });
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (detail ? '  — ' + detail : ''));
}
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
var MAX = Number.MAX_SAFE_INTEGER;
var MAXS = String(MAX);              // "9007199254740991"
var OVER = '9007199254740992';       // MAX + 1 written as text (not representable-safe)

function qr(a, b) { var r = C.calculate(String(a), String(b)); return r.status === 'ok' ? [r.quotient, r.remainder] : r.status; }
function same(x, y) { return JSON.stringify(x) === JSON.stringify(y); }

/* Every result, whatever the input, must satisfy these invariants. */
function invariantProblems(r) {
  var p = [];
  var ints = [r.dividend, r.divisor, r.quotient, r.remainder];
  if (r.status === 'ok') {
    ints.forEach(function (v) {
      if (typeof v !== 'number' || !Number.isSafeInteger(v)) p.push('non-safe-integer ' + v);
      if (Object.is(v, -0)) p.push('negative zero');
    });
    if (r.divisor === 0) p.push('ok with zero divisor');
    if (!(r.remainder >= 0 && r.remainder < Math.abs(r.divisor))) p.push('remainder out of range');
    if (ints.every(Number.isSafeInteger)) {   // only meaningful (and BigInt-safe) when all four are integers
      if (BigInt(r.dividend) !== BigInt(r.divisor) * BigInt(r.quotient) + BigInt(r.remainder)) p.push('identity violated');
    }
    if (typeof r.equation !== 'string') p.push('no equation');
  } else {
    ints.forEach(function (v) { if (v !== null) p.push('value shown despite status ' + r.status + ': ' + v); });
    if (r.equation !== null) p.push('equation shown despite status ' + r.status);
  }
  var shown = [r.dividend, r.divisor, r.quotient, r.remainder, r.message, r.equation].filter(function (v) { return v !== null; }).map(String).join(' | ');
  // The English sentence "Division by zero is undefined" is legitimate wording; a leaked JS value is not.
  var scan = shown.replace('Division by zero is undefined,', '');
  if (/NaN|Infinity|undefined|e\+|\bnull\b/.test(scan)) p.push('forbidden token in output: ' + shown);
  if (typeof r.message !== 'string' || !r.message.length) p.push('no message');
  return p;
}

/* ------------------------------------------------------------------ */
section('1. Normal division');
check('58 ÷ 7 → quotient 8, remainder 2 (the specification example)', same(qr(58, 7), [8, 2]));
check('the full result for 58 ÷ 7 echoes dividend 58 and divisor 7 and shows "58 = 7 × 8 + 2"', (function () {
  var r = C.calculate('58', '7');
  return r.status === 'ok' && r.dividend === 58 && r.divisor === 7 && r.quotient === 8 && r.remainder === 2 && r.equation === '58 = 7 × 8 + 2' && r.message === '58 = 7 × 8 + 2';
})());
check('100 ÷ 7 → 14 r 2', same(qr(100, 7), [14, 2]));
check('1000 ÷ 13 → 76 r 12', same(qr(1000, 13), [76, 12]));
check('999 ÷ 10 → 99 r 9', same(qr(999, 10), [99, 9]));
check('7 ÷ 58 (dividend smaller than divisor) → 0 r 7', same(qr(7, 58), [0, 7]));
check('1 ÷ 2 → 0 r 1', same(qr(1, 2), [0, 1]));
check('whitespace around a number is ignored ("  58  " ÷ " 7 ")', same(qr('  58  ', ' 7 '), [8, 2]));
check('leading zeros are accepted and normalised ("007" → 7)', (function () { var r = C.calculate('058', '007'); return r.status === 'ok' && r.dividend === 58 && r.divisor === 7 && r.quotient === 8 && r.remainder === 2; })());
check('a leading plus sign is accepted ("+58" ÷ "+7")', same(qr('+58', '+7'), [8, 2]));

section('2. Exact division and zero remainder');
check('56 ÷ 7 → 8 r 0', same(qr(56, 7), [8, 0]));
check('100 ÷ 10 → 10 r 0', same(qr(100, 10), [10, 0]));
check('5 ÷ 5 → 1 r 0', same(qr(5, 5), [1, 0]));
check('any number ÷ 1 → itself r 0 (73 ÷ 1)', same(qr(73, 1), [73, 0]));
check('0 ÷ 7 → 0 r 0', same(qr(0, 7), [0, 0]));
check('0 ÷ -7 → 0 r 0 (and never "-0")', (function () { var r = C.calculate('0', '-7'); return r.status === 'ok' && Object.is(r.quotient, 0) && Object.is(r.remainder, 0); })());
check('"-0" is treated as 0', same(qr('-0', 7), [0, 0]));
check('exact result has remainder exactly 0 for 1000 multiples of 13', (function () {
  for (var k = 1; k <= 1000; k++) { var r = C.calculate(String(13 * k), '13'); if (r.status !== 'ok' || r.quotient !== k || r.remainder !== 0) return false; }
  return true;
})());

section('3. Zero divisor');
['0', '00', '-0', '+0', ' 0 '].forEach(function (z) {
  var r = C.calculate('58', z);
  check('58 ÷ "' + z + '" → zero-divisor, no quotient, no remainder', r.status === 'zero-divisor' && r.quotient === null && r.remainder === null && /cannot be zero/i.test(r.message));
});
check('0 ÷ 0 → zero-divisor (not 0, not NaN)', C.calculate('0', '0').status === 'zero-divisor');
check('zero divisor with an EMPTY dividend is still reported as zero-divisor', C.calculate('', '0').status === 'zero-divisor');
check('zero-divisor message explains why and is plain text', (function () { var m = C.calculate('9', '0').message; return /undefined/.test(m) && !/NaN|Infinity/.test(m); })());
check('zero divisor marks the divisor field only', (function () { var f = C.calculate('9', '0').fields; return f.divisor === 'zero' && f.dividend === 'ok'; })());

section('4. Empty inputs');
check('both empty → status "empty" with a prompt', (function () { var r = C.calculate('', ''); return r.status === 'empty' && /Enter a dividend and a divisor/.test(r.message) && r.quotient === null; })());
check('only dividend entered → asks for a divisor', (function () { var r = C.calculate('58', ''); return r.status === 'empty' && /Enter a divisor/.test(r.message); })());
check('only divisor entered → asks for a dividend', (function () { var r = C.calculate('', '7'); return r.status === 'empty' && /Enter a dividend/.test(r.message); })());
check('whitespace-only fields count as empty', C.calculate('   ', '\t').status === 'empty');
check('null / undefined arguments are treated as empty (never throw)', C.calculate(null, undefined).status === 'empty');

section('5. Negative values (Euclidean: remainder is never negative)');
check('-58 ÷ 7 → -9 r 5  (7 × -9 + 5 = -58)', same(qr(-58, 7), [-9, 5]));
check('58 ÷ -7 → -8 r 2  (-7 × -8 + 2 = 58)', same(qr(58, -7), [-8, 2]));
check('-58 ÷ -7 → 9 r 5  (-7 × 9 + 5 = -58)', same(qr(-58, -7), [9, 5]));
check('-56 ÷ 7 → -8 r 0 (exact, negative dividend)', same(qr(-56, 7), [-8, 0]));
check('56 ÷ -7 → -8 r 0', same(qr(56, -7), [-8, 0]));
check('-56 ÷ -7 → 8 r 0', same(qr(-56, -7), [8, 0]));
check('-1 ÷ 7 → -1 r 6', same(qr(-1, 7), [-1, 6]));
check('-7 ÷ 58 → -1 r 51', same(qr(-7, 58), [-1, 51]));
check('negative cases add a note that the remainder is never negative', /never negative/.test(C.calculate('-58', '7').message) && /never negative/.test(C.calculate('58', '-7').message));
check('the note is absent for non-negative inputs', !/never negative/.test(C.calculate('58', '7').message));
check('for a positive divisor the result equals Math.floor division (checked for 4000 pairs)', (function () {
  for (var a = -100; a <= 100; a++) for (var b = 1; b <= 20; b++) {
    var r = C.calculate(String(a), String(b));
    if (r.quotient !== Math.floor(a / b) || r.remainder !== a - b * Math.floor(a / b) || r.remainder < 0) return false;
  }
  return true;
})());

section('6. Invalid input');
var invalids = ['abc', '7.5', '.5', '5.', '1e3', '1E3', '0x10', '1,000', '1 000', '--5', '5-', '+-5', '-+5', '-', '+', 'Infinity', '-Infinity', 'NaN',
  '٣', '５', '5 5', '12abc', 'abc12', '(5)', '5/2', '1_000', '∞', 'null', 'undefined', '0b101', '٠'];
invalids.forEach(function (bad) {
  var a = C.calculate(bad, '7'), b = C.calculate('58', bad);
  check('"' + bad + '" is rejected as invalid in both fields (no quotient/remainder)', a.status === 'invalid' && b.status === 'invalid' && a.quotient === null && b.remainder === null && /whole number/.test(a.message));
});
check('numbers passed instead of strings: NaN, Infinity, 0.5 and 1e21 are invalid, never shown', ['NaN', 'Infinity', '0.5', '1e21'].every(function (s) { return C.calculate(Number(s), 7).status === 'invalid'; }));
check('both fields invalid → both are reported in one message and both fields flagged', (function () { var r = C.calculate('x', 'y'); return r.fields.dividend === 'invalid' && r.fields.divisor === 'invalid' && /Dividend/.test(r.message) && /Divisor/.test(r.message); })());
check('an invalid dividend is reported even when the divisor is zero (field errors first)', C.calculate('x', '0').status === 'invalid');
check('invalid divisor + valid dividend flags only the divisor', (function () { var r = C.calculate('58', '7.5'); return r.fields.dividend === 'ok' && r.fields.divisor === 'invalid'; })());
check('typing "-" on the way to "-5" is invalid, not a crash or a zero', C.calculate('-', '7').status === 'invalid');

section('7. Safe-integer boundaries');
check('MAX_SAFE_INTEGER (' + MAXS + ') ÷ 1 → itself r 0', same(qr(MAXS, 1), [MAX, 0]));
check('MAX_SAFE ÷ MAX_SAFE → 1 r 0', same(qr(MAXS, MAXS), [1, 0]));
check('MAX_SAFE ÷ 2 → 4503599627370495 r 1', same(qr(MAXS, 2), [4503599627370495, 1]));
check('MAX_SAFE ÷ 7 is exact (checked with BigInt)', (function () { var r = C.calculate(MAXS, '7'); return r.status === 'ok' && BigInt(MAXS) === 7n * BigInt(r.quotient) + BigInt(r.remainder); })());
check('MAX_SAFE ÷ -1 → -MAX_SAFE r 0', same(qr(MAXS, -1), [-MAX, 0]));
check('-MAX_SAFE ÷ 1 → -MAX_SAFE r 0', same(qr(-MAX, 1), [-MAX, 0]));
check('-MAX_SAFE ÷ MAX_SAFE → -1 r 0', same(qr(-MAX, MAX), [-1, 0]));
check('-MAX_SAFE ÷ 2 → -4503599627370496 r 1', same(qr(-MAX, 2), [-4503599627370496, 1]));
check('-MAX_SAFE ÷ -2 → 4503599627370496 r 1', same(qr(-MAX, -2), [4503599627370496, 1]));
check('MAX_SAFE ÷ (MAX_SAFE - 1) → 1 r 1', same(qr(MAXS, MAX - 1), [1, 1]));
check('1 ÷ MAX_SAFE → 0 r 1', same(qr(1, MAXS), [0, 1]));
check('-1 ÷ MAX_SAFE → -1 r MAX_SAFE-1', same(qr(-1, MAXS), [-1, MAX - 1]));
check('0 ÷ MAX_SAFE → 0 r 0', same(qr(0, MAXS), [0, 0]));
check('MAX_SAFE + 1 as dividend is out-of-range (a float would silently equal ' + OVER + ')', C.calculate(OVER, '7').status === 'out-of-range' && C.calculate(OVER, '7').quotient === null);
check('MAX_SAFE + 1 as divisor is out-of-range', C.calculate('58', OVER).status === 'out-of-range');
check('-(MAX_SAFE + 1) is out-of-range', C.calculate('-' + OVER, '7').status === 'out-of-range');
check('the classic precision trap 9007199254740993 is refused, not rounded', C.calculate('9007199254740993', '1').status === 'out-of-range');
check('a 17-digit number is out-of-range', C.calculate('12345678901234567', '3').status === 'out-of-range');
check('a 16-digit number above the limit (9999999999999999) is out-of-range', C.calculate('9999999999999999', '3').status === 'out-of-range');
check('a 16-digit number below the limit (9007199254740990) is accepted', C.calculate('9007199254740990', '3').status === 'ok');
check('a 400-digit number is out-of-range (no crash, no Infinity)', (function () { var r = C.calculate('9'.repeat(400), '3'); return r.status === 'out-of-range' && !/Infinity|NaN/.test(r.message); })());
check('many leading zeros do not cause false out-of-range ("0000000000000000000058")', same(qr('0000000000000000000058', 7), [8, 2]));
check('out-of-range message states the limit', /9,007,199,254,740,991/.test(C.calculate(OVER, '7').message));
check('both fields out-of-range are both reported', (function () { var r = C.calculate(OVER, OVER); return r.fields.dividend === 'out-of-range' && r.fields.divisor === 'out-of-range'; })());
check('out-of-range takes priority over a zero divisor in the other field', C.calculate(OVER, '0').status === 'out-of-range');
check('exported limit equals Number.MAX_SAFE_INTEGER', C.MAX_SAFE_INTEGER === 9007199254740991);

section('8. Property tests (every result obeys dividend = divisor × quotient + remainder)');
(function () {
  var rnd = mulberry32(2026), bad = [], n = 0;
  function pick() {
    var kind = Math.floor(rnd() * 5);
    var mag = [1e1, 1e3, 1e6, 1e12, MAX][Math.floor(rnd() * 5)];
    var v = Math.floor(rnd() * mag);
    return String((rnd() < 0.5 ? -1 : 1) * v);
  }
  for (var i = 0; i < 30000; i++) {
    var a = pick(), b = pick();
    var r = C.calculate(a, b);
    n++;
    var probs = invariantProblems(r);
    if (b === '0' || b === '-0') { if (r.status !== 'zero-divisor') probs.push('zero not detected'); }
    else if (r.status !== 'ok') probs.push('unexpected status ' + r.status);
    if (probs.length) { bad.push(a + ' ÷ ' + b + ': ' + probs.join(', ')); if (bad.length > 3) break; }
  }
  check('30000 random pairs (up to ±MAX_SAFE) all satisfy the identity, 0 ≤ r < |divisor|, safe integers, no forbidden tokens', bad.length === 0, bad.join(' | '));

  var rnd2 = mulberry32(7), alphabet = '0123456789-+. eE,xa∞٣', bad2 = [], thrown = 0;
  for (var j = 0; j < 30000; j++) {
    var len = Math.floor(rnd2() * 20), s = '', t = '';
    for (var k = 0; k < len; k++) s += alphabet[Math.floor(rnd2() * alphabet.length)];
    for (var m = 0; m < Math.floor(rnd2() * 20); m++) t += alphabet[Math.floor(rnd2() * alphabet.length)];
    var res;
    try { res = C.calculate(s, t); } catch (e) { thrown++; continue; }
    var pr = invariantProblems(res);
    if (pr.length) { bad2.push('"' + s + '" ÷ "' + t + '": ' + pr.join(', ')); if (bad2.length > 3) break; }
  }
  check('30000 random garbage strings: never throws, never shows a number unless status is ok', thrown === 0 && bad2.length === 0, 'thrown ' + thrown + ' ' + bad2.join(' | '));

  var bad3 = [];
  var edgeSet = ['0', '1', '-1', '2', '-2', '7', '-7', '9', '10', '99', '100', '101', '999', '1000', MAXS, '-' + MAXS, String(MAX - 1), String(-(MAX - 1)), '4503599627370496', '-4503599627370496', OVER, '-' + OVER, 'x', '', '1.5'];
  edgeSet.forEach(function (a) { edgeSet.forEach(function (b) { var p = invariantProblems(C.calculate(a, b)); if (p.length) bad3.push(a + ' ÷ ' + b + ': ' + p.join(',')); }); });
  check('all ' + edgeSet.length * edgeSet.length + ' pairs from a boundary/invalid value set satisfy the invariants', bad3.length === 0, bad3.slice(0, 3).join(' | '));
})();

/* ------------------------------------------------------------------ */
section('8b. The invariant checker itself catches bad output (negative controls)');
check('checker flags a leaked NaN', invariantProblems({ status: 'ok', dividend: NaN, divisor: 7, quotient: 1, remainder: 0, equation: 'x', message: 'NaN' }).length > 0);
check('checker flags a bare "undefined" in a message', invariantProblems({ status: 'invalid', dividend: null, divisor: null, quotient: null, remainder: null, equation: null, message: 'undefined' }).length > 0);
check('checker flags a quotient shown for a non-ok status', invariantProblems({ status: 'zero-divisor', dividend: null, divisor: null, quotient: 5, remainder: null, equation: null, message: 'Divisor cannot be zero.' }).length > 0);
check('checker flags a violated identity', invariantProblems({ status: 'ok', dividend: 58, divisor: 7, quotient: 8, remainder: 3, equation: '58 = 7 × 8 + 3', message: 'm' }).length > 0);
check('checker flags a negative remainder', invariantProblems({ status: 'ok', dividend: -58, divisor: 7, quotient: -8, remainder: -2, equation: 'e', message: 'm' }).length > 0);

section('9. The calculator is independent of the game (static checks)');
(function () {
  function code(src) { return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, ''); }
  function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }
  function sha(f) { return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex'); }

  var calcCode = code(read('js/calculator.js')), calcUi = code(read('js/calculator-ui.js'));
  var coupling = /MRGame|MREngine|MRQuestions|__mindReaderDebug|getView|createGame|candidate|require\(['"]\.\/(game|engine|questions)/i;
  check('calculator.js references no game, engine, question or candidate code', !coupling.test(calcCode));
  check('calculator-ui.js references no game, engine, question or candidate code', !coupling.test(calcUi));
  check('calculator-ui.js only touches elements by calculator ids (calc*) — no #yesBtn, #history, #range, etc.', (function () {
    var ids = (calcUi.match(/byId\('([^']+)'\)/g) || []).map(function (m) { return m.slice(6, -2); });
    return ids.length >= 8 && ids.every(function (id) { return /^calc/.test(id); });
  })());
  check('calculator-ui.js has no keyboard listener and cannot trigger game shortcuts', !/keydown|keyup|keypress/.test(calcUi));
  ['js/questions.js', 'js/engine.js', 'js/game.js'].forEach(function (f) {
    check(f + ' does not mention the calculator at all', !/calcPanel|calculator|MRCalculator/i.test(code(read(f))));
  });
  var CALC_REF = /calcPanel|calculator|MRCalculator/i;   // (not the unrelated word "Recalculated")
  var uiCalcLines = code(read('js/ui.js')).split('\n').filter(function (l) { return CALC_REF.test(l); });
  check('js/ui.js has exactly ONE calculator-related line (the guard that keeps Y/N/S shortcuts out of the panel)', uiCalcLines.length === 1 && /closest\('#calcPanel'\)\) return/.test(uiCalcLines[0]), uiCalcLines.join(' / '));

  // Byte-for-byte guard: the game's question generation, selection and state logic are exactly the audited v2.0.0 files.
  var BASELINE = {
    'js/questions.js': 'aaef0232669460d13fc61f47af71094b004f753f84dcf5dd95f7c3acec5d5e26',
    'js/engine.js': '3111acb010dbdb9c981b138b9ec25ad92f5303564e85c970bf739ae8f99e0b8f',
    'js/game.js': '784adfc12079616fdf4f17a4fcf7e5887ea4f0c17562a3939a8e6137e11eaceb'
  };
  Object.keys(BASELINE).forEach(function (f) {
    check(f + ' is byte-identical to the audited v2.0.0 file (sha256 ' + BASELINE[f].slice(0, 12) + '…)', sha(f) === BASELINE[f],
      sha(f) === BASELINE[f] ? '' : 'CHANGED — if you edited the game deliberately, update BASELINE in this test');
  });

  var html = read('index.html');
  var panel = (html.match(/<aside[^>]*id="calcPanel"[\s\S]*?<\/aside>/) || [''])[0];
  var outside = html.replace(panel, '');
  check('index.html contains the calculator panel with the heading "Division Calculator"', /<h2[^>]*>Division Calculator<\/h2>/.test(panel));
  check('the only <input> elements on the page are the two calculator fields (none in the game area)', (panel.match(/<input\b/g) || []).length === 2 && !/<input\b/i.test(outside) && !/<textarea\b/i.test(html));
  check('both calculator inputs have an associated <label for=...>', /<label for="calcDividend">Dividend<\/label>/.test(panel) && /<label for="calcDivisor">Divisor<\/label>/.test(panel));
  check('calculator inputs are text fields with numeric keypad hint (type=text so invalid text can be detected and explained)', (panel.match(/type="text" inputmode="numeric"/g) || []).length === 2);
  check('there is a Clear button and NO Calculate/Compute/Equals button', /id="calcClear"[^>]*>Clear</.test(panel) && !/>\s*(Calculate|Compute|=|Equals|Divide)\s*</i.test(panel));
  check('result area shows all four labelled values (Dividend, Divisor, Quotient, Remainder)', ['Dividend', 'Divisor', 'Quotient', 'Remainder'].every(function (k) { return new RegExp('class="calc-k">' + k + '<').test(panel); }));
  check('messages are exposed through role="status" with aria-live polite', /id="calcMessage"[^>]*role="status"[^>]*aria-live="polite"/.test(panel));
  check('the panel comes after the game in the DOM (so it is last in Tab order and below the game on narrow screens)', html.indexOf('id="main"') < html.indexOf('id="calcPanel"'));
  var css = read('css/style.css');
  check('stylesheet puts the calculator beside the game on wide screens (grid with a 252px column)', /min-width:\s*1060px[\s\S]*?252px/.test(css));
  check('stylesheet has no fixed-width element wider than the viewport in the calculator rules (no px width > 252)', !/\.calc[^{]*\{[^}]*width:\s*(2[6-9]\d|[3-9]\d\d)px/.test(css));
  var all = ['js/calculator.js', 'js/calculator-ui.js'].map(read).join('\n');
  check('calculator files use no network, storage or dynamic-code APIs', !/fetch\(|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|indexedDB|document\.cookie|eval\(|new Function|innerHTML|https?:\/\//.test(all));
  check('the standalone file is up to date with the sources (contains the calculator)', (function () {
    var f = path.join(ROOT, 'mind_reader_standalone.html');
    if (!fs.existsSync(f)) return false;
    var s = fs.readFileSync(f, 'utf8');
    return s.indexOf('Division Calculator') !== -1 && s.indexOf('MRCalculator') !== -1 && s.indexOf('calcPanel') !== -1;
  })());
})();

/* ------------------------------------------------------------------ */
var failed = results.filter(function (r) { return !r.pass; });
console.log('\n' + '='.repeat(60));
console.log(results.length - failed.length + ' passed, ' + failed.length + ' failed, ' + results.length + ' checks');
if (failed.length) { console.log('\nFAILURES:'); failed.forEach(function (f) { console.log(' - [' + f.group + '] ' + f.name + (f.detail ? ' — ' + f.detail : '')); }); }

if (WRITE_REPORT) {
  var lines = ['# Division Calculator test results (generated by `node tests/calculator-test.js --write-report`)', '',
    '- Run on: ' + new Date().toISOString(), '- Node: ' + process.version + ' · Platform: ' + process.platform,
    '- **Result: ' + (results.length - failed.length) + ' passed, ' + failed.length + ' failed (' + results.length + ' checks)**', '',
    'This file is written by the test runner itself; it is not edited by hand.'];
  var cur = null;
  results.forEach(function (r) {
    if (r.group !== cur) { cur = r.group; lines.push('', '## ' + cur, ''); }
    lines.push('- ' + (r.pass ? '✅' : '❌') + ' ' + r.name + (r.detail ? ' — _' + r.detail + '_' : ''));
  });
  fs.writeFileSync(path.join(__dirname, 'CALCULATOR_RESULTS.md'), lines.join('\n') + '\n');
  console.log('\nWrote tests/CALCULATOR_RESULTS.md');
}
process.exit(failed.length ? 1 : 0);
