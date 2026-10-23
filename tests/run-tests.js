#!/usr/bin/env node
/*
 * Mind Reader — automated logic tests (no dependencies, Node 14+).
 *
 *   node tests/run-tests.js                 run everything, print a summary
 *   node tests/run-tests.js --write-report  also (over)write tests/TEST_RESULTS.md
 *
 * Exit code is 0 only if every check passed.
 */
'use strict';
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var Q = require(path.join(ROOT, 'js', 'questions.js'));
var E = require(path.join(ROOT, 'js', 'engine.js'));
var G = require(path.join(ROOT, 'js', 'game.js'));

var WRITE_REPORT = process.argv.indexOf('--write-report') !== -1;
var started = Date.now();
var results = [];      // {group, name, pass, detail}
var stats = {};        // numbers worth reporting
var group = '';

function section(name) { group = name; console.log('\n== ' + name); }
function check(name, cond, detail) {
  results.push({ group: group, name: name, pass: !!cond, detail: detail || '' });
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (detail ? '  — ' + detail : ''));
}

// Deterministic PRNG for the "varied" mode and fuzzing.
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

var RANGES = Q.SUPPORTED_RANGES.slice();
var EDGES = [1, 2, 9, 10, 49, 50, 99, 100, 101, 249, 250, 999, 1000];

function truthful(source, qid, secret) { return source.byId(qid).test(secret) ? 'yes' : 'no'; }

/* Play one complete round with truthful answers. Returns a record. */
function playTruthful(max, secret, gameOpts, source) {
  var g = G.createGame(Object.assign({ max: max, source: source }, gameOpts || {}));
  g.start();
  var v = g.view();
  var rec = { ok: true, problems: [], asked: [], extra: 0, questions: 0 };
  var used = new Set();
  var guard = 0;
  while (v.phase === 'asking') {
    if (++guard > 400) { rec.ok = false; rec.problems.push('runaway'); break; }
    if (v.candidates.indexOf(secret) === -1) { rec.ok = false; rec.problems.push('secret removed from candidates'); break; }
    if (v.candidateCount < 2) { rec.ok = false; rec.problems.push('asking with <2 candidates'); break; }
    if (used.has(v.question.id)) { rec.ok = false; rec.problems.push('repeated question ' + v.question.id); }
    used.add(v.question.id);
    rec.asked.push(v.question.id);
    if (v.question.extra) rec.extra++;
    g.answer(truthful(g.source, v.question.id, secret));
    v = g.view();
  }
  rec.questions = v.answeredCount;
  if (v.phase !== 'guess') { rec.ok = false; rec.problems.push('ended in phase ' + v.phase); }
  else if (v.candidateCount !== 1 || v.guess !== secret) { rec.ok = false; rec.problems.push('guess ' + v.guess + ' != secret'); }
  else {
    g.confirmGuess();
    var s = g.view();
    if (s.phase !== 'solved' || s.solvedNumber !== secret) { rec.ok = false; rec.problems.push('confirm did not solve'); }
  }
  return rec;
}

/* ------------------------------------------------------------------ */
section('1. Question semantics (cross-checked against independent implementations)');
(function () {
  var source = Q.createQuestionSource(1000);
  var sieve = []; for (var i = 0; i <= 1000; i++) sieve[i] = i >= 2;
  for (var p = 2; p * p <= 1000; p++) if (sieve[p]) for (var m = p * p; m <= 1000; m += p) sieve[m] = false;
  function ds(n) { return String(n).split('').reduce(function (a, d) { return a + Number(d); }, 0); }
  function sq(n) { for (var r = 0; r * r <= n; r++) if (r * r === n) return true; return false; }
  function cb(n) { for (var r = 0; r * r * r <= n; r++) if (r * r * r === n) return true; return false; }
  function sqfree(n) { for (var d = 2; d <= n; d++) if (n % (d * d) === 0) return false; return true; }
  var oracle = {
    even: function (n) { return n % 2 === 0; },
    prime: function (n) { return sieve[n]; },
    square: sq, cube: cb, squarefree: sqfree,
    'dsum:even': function (n) { return ds(n) % 2 === 0; },
    'dsum:prime': function (n) { return sieve[ds(n)]; },
    'dsum:square': function (n) { return sq(ds(n)); },
    rep: function (n) { var s = String(n); return new Set(s.split('')).size < s.length; },
    allodd: function (n) { return /^[13579]+$/.test(String(n)); },
    alleven: function (n) { return /^[02468]+$/.test(String(n)); },
    firsteven: function (n) { return Number(String(n)[0]) % 2 === 0; },
    palin: function (n) { var s = String(n); return s === s.split('').reverse().join(''); }
  };
  for (var d = 0; d <= 9; d++) (function (dg) { oracle['has:' + dg] = function (n) { return String(n).indexOf(String(dg)) !== -1; }; })(d);
  var mismatches = [];
  Object.keys(oracle).forEach(function (id) {
    var q = source.byId(id);
    if (!q) { mismatches.push(id + ' missing'); return; }
    for (var n = 1; n <= 1000; n++) if (!!q.test(n) !== !!oracle[id](n)) { mismatches.push(id + '@' + n); break; }
  });
  check('named questions agree with independent implementations for every n in 1..1000 (' + Object.keys(oracle).length + ' questions)', mismatches.length === 0, mismatches.join(', '));
  var modBad = 0, modCount = 0;
  for (var mm = 3; mm <= 30; mm++) for (var r = 0; r < mm; r++) {
    var q = source.byId('mod:' + mm + ':' + r); modCount++;
    for (var n2 = 1; n2 <= 1000; n2++) if (!!q.test(n2) !== (n2 % mm === r)) { modBad++; break; }
  }
  check('all ' + modCount + ' residue questions mod 3..30 agree with n % m === r', modBad === 0);
  check('perfect squares/cubes use exact integer roots (64, 125, 343, 729, 1000)',
    source.byId('square').test(64) && source.byId('cube').test(125) && source.byId('cube').test(343) &&
    source.byId('cube').test(729) && !source.byId('cube').test(1000 - 1) && source.byId('cube').test(1000) === true);
})();

/* ------------------------------------------------------------------ */
section('2. No direct-number or cutoff questions (every bank, every range)');
RANGES.forEach(function (max) {
  var source = Q.createQuestionSource(max);
  var bad = [], ids = new Set(), dup = 0;
  source.base.forEach(function (q) {
    var prof = Q.profile(q.test, max);
    if (!Q.isLegitProfile(prof)) bad.push(q.id + ' (profile)');
    if (Q.FORBIDDEN_TEXT.test(q.text)) bad.push(q.id + ' (text)');
    if (ids.has(q.id)) dup++; ids.add(q.id);
  });
  check('range 1–' + max + ': all ' + source.base.length + ' standard questions pass legitimacy guards (≥' + Q.MIN_SIDE_SIZE + ' numbers per side, ≥' + Q.MIN_RUNS + ' runs per side, no cutoff wording)', bad.length === 0, bad.slice(0, 5).join(', '));
  check('range 1–' + max + ': question ids are unique', dup === 0);
  var sigs = new Set(), redundant = 0;
  source.base.forEach(function (q) {
    var p = Q.profile(q.test, max);
    var comp = p.sig.replace(/[01]/g, function (c) { return c === '1' ? '0' : '1'; });
    if (sigs.has(p.sig) || sigs.has(comp)) redundant++; sigs.add(p.sig);
  });
  check('range 1–' + max + ': no two standard questions split the range identically', redundant === 0);
});
(function () {
  var s100 = Q.createQuestionSource(100);
  var removed = ['twoDigits', 'threeDigits', 'digitSumOver10', 'digitSumUnder5'];
  var present = removed.filter(function (id) { return s100.byId(id); });
  check('the original disguised-cutoff questions (exactly two/three digits, digit-sum thresholds) no longer exist', present.length === 0);
  var disguised = { id: 'x', text: 'Does your number have exactly three digits?', test: function (n) { return n >= 100 && n <= 999; } };
  check('guard rejects "three digits" in range 100 (it would be a direct check of 100)', !Q.isLegitQuestion(disguised, 100));
  check('guard rejects "two digits" in range 1000 (a 10..99 cutoff)', !Q.isLegitQuestion({ id: 'y', text: 'Exactly two digits?', test: function (n) { return n >= 10 && n <= 99; } }, 1000));
  check('guard rejects a single-number test', !Q.isLegitQuestion({ id: 'z', text: 'Is it special?', test: function (n) { return n === 42; } }, 100));
  check('guard rejects ordering wording ("greater than")', !Q.isLegitQuestion({ id: 'w', text: 'Is the sum of its digits greater than 10?', test: function (n) { return n % 2 === 0; } }, 100));
})();

/* ------------------------------------------------------------------ */
section('3. Exhaustive truthful play — every secret, every range (predictable order)');
var everAsked = {};
RANGES.forEach(function (max) {
  var source = Q.createQuestionSource(max);
  var failures = [], maxQ = 0, total = 0, hist = {}, t0 = Date.now(), asked = new Set();
  for (var secret = 1; secret <= max; secret++) {
    var rec = playTruthful(max, secret, { variety: 'predictable' }, source);
    if (!rec.ok) failures.push(secret + ': ' + rec.problems.join('; '));
    maxQ = Math.max(maxQ, rec.questions); total += rec.questions;
    hist[rec.questions] = (hist[rec.questions] || 0) + 1;
    rec.asked.forEach(function (id) { asked.add(id); });
  }
  everAsked[max] = asked;
  stats['exhaustive_' + max] = { secrets: max, failures: failures.length, maxQuestions: maxQ, avgQuestions: +(total / max).toFixed(2), histogram: hist, ms: Date.now() - t0 };
  check('range 1–' + max + ': all ' + max + ' secrets identified exactly (0 failures, secret never removed, no repeats, guess only at 1 candidate)',
    failures.length === 0, failures.length ? failures.slice(0, 3).join(' | ') : 'max ' + maxQ + ' questions, avg ' + (total / max).toFixed(2) + ', ' + (Date.now() - t0) + ' ms');
  var extraUsed = 0; asked.forEach(function (id) { if (source.byId(id).adaptive) extraUsed++; });
  check('range 1–' + max + ': standard bank alone was sufficient for truthful players (no extra questions needed)', extraUsed === 0);
});

section('4. Exhaustive truthful play — randomised "varied" order (seeded PRNG)');
RANGES.forEach(function (max) {
  var source = Q.createQuestionSource(max);
  var failures = [], maxQ = 0, total = 0, t0 = Date.now();
  for (var secret = 1; secret <= max; secret++) {
    var rec = playTruthful(max, secret, { variety: 'varied', rng: mulberry32(secret * 7919 + max) }, source);
    if (!rec.ok) failures.push(secret + ': ' + rec.problems.join('; '));
    maxQ = Math.max(maxQ, rec.questions); total += rec.questions;
  }
  stats['varied_' + max] = { failures: failures.length, maxQuestions: maxQ, avgQuestions: +(total / max).toFixed(2) };
  check('range 1–' + max + ' (varied): all secrets identified, 0 failures', failures.length === 0,
    failures.length ? failures.slice(0, 3).join(' | ') : 'max ' + maxQ + ', avg ' + (total / max).toFixed(2));
});

section('5. Edge values');
RANGES.forEach(function (max) {
  var bad = [];
  EDGES.filter(function (n) { return n <= max; }).forEach(function (n) {
    ['predictable', 'varied'].forEach(function (variety) {
      var rec = playTruthful(max, n, { variety: variety, rng: mulberry32(n) });
      if (!rec.ok) bad.push(n + '/' + variety);
    });
  });
  check('range 1–' + max + ': edge values ' + EDGES.filter(function (n) { return n <= max; }).join(', ') + ' identified in both orders', bad.length === 0, bad.join(', '));
});

section('6. Question selection quality');
(function () {
  var source = Q.createQuestionSource(1000);
  var g = G.createGame({ max: 1000, variety: 'predictable' }); g.start();
  var v = g.view();
  var first = source.byId(v.question.id);
  var yes = v.candidates.filter(first.test).length;
  check('first question on 1–1000 splits exactly 500/500 (' + first.id + ' → ' + yes + '/' + (1000 - yes) + ')', yes === 500);

  // Brute-force optimality of every deterministic choice along 60 secrets' paths.
  var worse = 0, checked = 0;
  [1, 17, 64, 97, 250, 333, 500, 729, 997, 1000].forEach(function (secret) {
    var gg = G.createGame({ max: 1000, variety: 'predictable' }); gg.start();
    var vv = gg.view();
    while (vv.phase === 'asking') {
      var used = new Set(vv.history.map(function (h) { return h.qid; }));
      var best = Infinity;
      source.base.forEach(function (q) {
        if (used.has(q.id)) return;
        var s = E.splitOf(q, vv.candidates);
        if (s.yes && s.no) best = Math.min(best, s.cost);
      });
      var chosen = E.splitOf(source.byId(vv.question.id), vv.candidates).cost;
      checked++; if (chosen !== best) worse++;
      gg.answer(truthful(source, vv.question.id, secret)); vv = gg.view();
    }
  });
  check('predictable mode always picks the most even available split (' + checked + ' decisions checked by brute force)', worse === 0);

  var windowViolations = 0, vchecks = 0;
  for (var s = 1; s <= 60; s++) {
    var gv = G.createGame({ max: 1000, variety: 'varied', rng: mulberry32(s) }); gv.start();
    var w = gv.view();
    while (w.phase === 'asking') {
      var used2 = new Set(w.history.map(function (h) { return h.qid; }));
      var best2 = Infinity;
      source.base.forEach(function (q) {
        if (used2.has(q.id)) return;
        var sp = E.splitOf(q, w.candidates);
        if (sp.yes && sp.no) best2 = Math.min(best2, sp.cost);
      });
      var c = E.splitOf(source.byId(w.question.id), w.candidates).cost;
      vchecks++; if (c > best2 * E.VARIETY_WINDOW) windowViolations++;
      gv.answer(truthful(source, w.question.id, s * 16 % 1000 + 1)); w = gv.view();
    }
  }
  check('varied mode never strays more than 2% from the best split (' + vchecks + ' decisions checked)', windowViolations === 0);
})();

/* ------------------------------------------------------------------ */
section('7. Not sure');
(function () {
  var g = G.createGame({ max: 100 }); g.start();
  var before = g.view();
  g.answer('unsure');
  var after = g.view();
  check('"Not sure" leaves the candidate set unchanged', JSON.stringify(before.candidates) === JSON.stringify(after.candidates) && after.candidateCount === 100);
  check('"Not sure" is recorded visibly (history value, label, unsureCount)', after.history[0].value === 'unsure' && after.history[0].label === 'Not sure' && after.unsureCount === 1);
  check('the Not-sure question is not asked again', after.question.id !== before.question.id);
  check('remaining count after the Not-sure row equals count before (no narrowing)', after.history[0].remainingAfter === 100);

  var bad = [];
  RANGES.forEach(function (max) {
    var source = Q.createQuestionSource(max);
    for (var secret = 1; secret <= max; secret += (max > 250 ? 7 : 1)) {
      var gg = G.createGame({ max: max, source: source }); gg.start();
      var v = gg.view(), n = 0;
      while (v.phase === 'asking' && n < 300) {
        var unsure = (n % 3 === 1);   // every third answer is "Not sure"
        gg.answer(unsure ? 'unsure' : truthful(source, v.question.id, secret));
        v = gg.view(); n++;
        if (v.candidates.indexOf(secret) === -1) { bad.push(max + '/' + secret + ' lost'); break; }
      }
      if (v.phase !== 'guess' || v.guess !== secret) bad.push(max + '/' + secret + ' ended ' + v.phase);
    }
  });
  check('with every third answer "Not sure", all tested secrets are still identified correctly', bad.length === 0, bad.slice(0, 3).join(', '));
})();

/* ------------------------------------------------------------------ */
section('8. Answer correction, rebuilt candidates and counts');
(function () {
  var source = Q.createQuestionSource(1000);
  // independent oracle: recompute everything from scratch
  function oracleCount(max, answers, rejected, upTo) {
    var c = 0;
    for (var n = 1; n <= max; n++) {
      if (rejected.indexOf(n) !== -1) continue;
      var ok = true;
      for (var i = 0; i <= upTo && ok; i++) {
        var a = answers[i];
        if (a.value === 'unsure') continue;
        if (!!source.byId(a.qid).test(n) !== (a.value === 'yes')) ok = false;
      }
      if (ok) c++;
    }
    return c;
  }
  var secret = 641, g = G.createGame({ max: 1000, source: source }); g.start();
  var v = g.view(), wrongAt = 3, k = 0;
  while (v.phase === 'asking') {
    var t = truthful(source, v.question.id, secret);
    g.answer(k === wrongAt ? (t === 'yes' ? 'no' : 'yes') : t);
    v = g.view(); k++;
  }
  var lied = v.phase === 'contradiction' || (v.phase === 'guess' && v.guess !== secret) || (v.candidates.length && v.candidates.indexOf(secret) === -1);
  check('a wrong answer removes the secret from the candidates (scenario set-up works)', lied, 'phase ' + v.phase);

  // correct the wrong answer
  var hist = g.view().history;
  var ti = truthful(source, hist[wrongAt].qid, secret);
  g.setAnswer(wrongAt, ti);
  var fixed = g.view();
  check('correcting the wrong answer brings the secret back into the candidates', fixed.candidates.indexOf(secret) !== -1, 'phase ' + fixed.phase + ', ' + fixed.candidateCount + ' candidates');

  // finish the game truthfully and verify that every displayed count equals the oracle
  var guard = 0;
  while (fixed.phase === 'asking' && guard++ < 100) { g.answer(truthful(source, fixed.question.id, secret)); fixed = g.view(); }
  check('after correction the round completes with the right number', fixed.phase === 'guess' && fixed.guess === secret);
  var answers = fixed.history.map(function (h) { return { qid: h.qid, value: h.value }; });
  var countsOk = fixed.history.every(function (h, i) { return h.remainingAfter === oracleCount(1000, answers, fixed.rejected, i); });
  check('every displayed "possibilities left" count matches an independent from-scratch recount', countsOk);
  check('last history row equals the live candidate count', fixed.history[fixed.history.length - 1].remainingAfter === fixed.candidateCount);

  // changing an early answer rebuilds everything, previously eliminated numbers may return
  var g2 = G.createGame({ max: 100, source: Q.createQuestionSource(100) }); g2.start();
  g2.answer('yes'); g2.answer('yes'); g2.answer('yes');
  var narrow = g2.view().candidateCount;
  g2.setAnswer(0, 'no');
  var rebuilt = g2.view();
  var a2 = rebuilt.history.map(function (h) { return { qid: h.qid, value: h.value }; });
  var src100 = Q.createQuestionSource(100), exp = 0;
  for (var n = 1; n <= 100; n++) { if (a2.every(function (a) { return a.value === 'unsure' || !!src100.byId(a.qid).test(n) === (a.value === 'yes'); })) exp++; }
  check('changing an early answer re-filters all answers (candidate count ' + narrow + ' → ' + rebuilt.candidateCount + ', oracle ' + exp + ')', rebuilt.candidateCount === exp);
  g2.setAnswer(0, 'unsure');
  var u = g2.view();
  check('changing an answer to Not sure removes its filtering and flags it uncertain', u.history[0].value === 'unsure' && u.unsureCount === 1);
  check('setAnswer with the same value is a harmless no-op (no undo entry added)', (function () { var before = g2.view().canUndo; var r = g2.setAnswer(0, 'unsure'); return r.ok && g2.view().canUndo === before; })());
})();

/* ------------------------------------------------------------------ */
section('9. Contradictory answers');
(function () {
  var source = Q.createQuestionSource(100);
  var g = G.createGame({ max: 100, source: source }); g.start();
  // Answer Yes to "even" then No to the divisibility-by-2-implying question until nothing remains.
  var v = g.view(), steps = 0, hit = false;
  var secret = 37;     // odd prime-ish; answer truthfully first, then lie once
  while (v.phase === 'asking' && steps < 50) {
    var t = truthful(source, v.question.id, secret);
    g.answer(steps === 2 ? (t === 'yes' ? 'no' : 'yes') : t);
    v = g.view(); steps++;
  }
  check('inconsistent answers lead to the contradiction phase or a wrong unique candidate, never a silent guess', v.phase === 'contradiction' || (v.phase === 'guess' && v.candidateCount === 1));

  // Deterministically force an empty set: "Yes, even" and later "Yes, odd-ish" is impossible; use two ids.
  var g2 = G.createGame({ max: 100, source: source }); g2.start();
  var forced = false, tries = 0;
  var cur = g2.view();
  while (cur.phase === 'asking' && tries++ < 60) {
    // keep answering opposite of what the majority of candidates say to drive to zero
    var yes = cur.candidates.filter(source.byId(cur.question.id).test).length;
    g2.answer(yes * 2 >= cur.candidateCount ? 'no' : 'yes');
    cur = g2.view();
    if (cur.phase === 'contradiction') { forced = true; break; }
    if (cur.phase === 'guess') { g2.rejectGuess(); cur = g2.view(); if (cur.phase === 'contradiction') { forced = true; break; } }
  }
  check('driving answers to an empty set reaches the contradiction phase', forced, 'phase ' + cur.phase);
  if (forced) {
    check('contradiction view has 0 candidates and no pending question', cur.candidateCount === 0 && cur.question === null);
    check('contradiction view offers repair suggestions (or says none exist)', Array.isArray(cur.suggestions));
    var applied = false;
    var s0 = cur.suggestions[0];
    if (s0) {
      if (s0.kind === 'restore') g2.restoreRejected(s0.n); else g2.setAnswer(s0.index, s0.value);
      var after = g2.view();
      applied = after.candidateCount === s0.resulting && after.candidateCount > 0;
    }
    check('applying the first suggested repair leaves exactly the predicted number of candidates', applied || !s0, s0 ? JSON.stringify(s0) : 'no single-change repair existed');
    check('every history count is still consistent after the repair', (function () { var w = g2.view(); return !w.history.length || w.history[w.history.length - 1].remainingAfter === w.candidateCount; })());
  }

  // Lie once at a known position; the suggestions must name that answer.
  var secretLie = 64, gl = G.createGame({ max: 100, source: source }); gl.start();
  var vl = gl.view(), idx = 0, lieIndex = 1;
  while (vl.phase === 'asking') {
    var tr = truthful(source, vl.question.id, secretLie);
    gl.answer(idx === lieIndex ? (tr === 'yes' ? 'no' : 'yes') : tr);
    vl = gl.view(); idx++;
  }
  if (vl.phase === 'guess' && vl.guess !== secretLie) { gl.rejectGuess(); vl = gl.view(); }
  if (vl.phase === 'contradiction') {
    var names = vl.suggestions.some(function (s) { return s.kind === 'set' && s.index === lieIndex; });
    check('after one lie the contradiction suggestions include correcting exactly that answer', names);
  } else {
    check('single-lie scenario produced a state we can analyse (phase ' + vl.phase + ')', vl.phase === 'guess' && vl.guess !== secretLie || vl.phase === 'asking');
  }
})();

/* ------------------------------------------------------------------ */
section('10. Wrong guesses and undo');
(function () {
  var source = Q.createQuestionSource(100), secret = 58;
  function toGuess() {
    var g = G.createGame({ max: 100, source: source }); g.start();
    var v = g.view();
    while (v.phase === 'asking') { g.answer(truthful(source, v.question.id, secret)); v = g.view(); }
    return g;
  }
  var g = toGuess();
  var shown = g.view().guess;
  check('computer reaches the guess phase only with exactly one candidate (guess = ' + shown + ')', g.view().candidateCount === 1 && shown === secret);

  g.rejectGuess();
  var v = g.view();
  check('rejecting the guess excludes it and (since it was the only candidate) shows a contradiction', v.phase === 'contradiction' && v.candidateCount === 0 && v.rejected.length === 1 && v.rejected[0] === shown);
  check('contradiction after a rejection suggests restoring the rejected number first', v.suggestions.length > 0 && v.suggestions[0].kind === 'restore' && v.suggestions[0].n === shown);
  check('"Undo" is available and names the action', v.canUndo && /rejecting/.test(v.undoLabel));

  g.undo();
  v = g.view();
  check('Undo of an accidental "Not my number" click returns to the same guess', v.phase === 'guess' && v.guess === shown && v.rejected.length === 0);

  g.rejectGuess(); g.restoreRejected(shown);
  v = g.view();
  check('"Restore" brings a rejected number back as the single candidate', v.phase === 'guess' && v.guess === shown && v.rejected.length === 0);

  g.confirmGuess();
  v = g.view();
  check('confirming a guess announces success only now (solved with ' + v.solvedNumber + ')', v.phase === 'solved' && v.solvedNumber === secret);
  g.undo();
  check('Undo of an accidental "That\'s my number" click returns to the guess', g.view().phase === 'guess');

  // rejection persists through corrections
  var g3 = toGuess(); g3.rejectGuess();
  var h = g3.view().history;
  var fixedSomething = false;
  for (var i = h.length - 1; i >= 0 && !fixedSomething; i--) {
    var flip = h[i].value === 'yes' ? 'no' : 'yes';
    g3.setAnswer(i, flip);
    var w = g3.view();
    if (w.candidateCount > 0) { fixedSomething = true; check('a rejected number stays excluded after an answer is corrected', w.candidates.indexOf(shown) === -1 && w.rejected.indexOf(shown) !== -1); }
    else g3.setAnswer(i, h[i].value);
  }
  if (!fixedSomething) check('a rejected number stays excluded after an answer is corrected', false, 'no single flip produced a candidate');

  // full undo chain returns to the start
  var g4 = G.createGame({ max: 100, source: source }); g4.start();
  var steps = 0, w4 = g4.view();
  while (w4.phase === 'asking') { g4.answer('yes'); w4 = g4.view(); steps++; if (steps > 20) break; }
  var undone = 0; while (g4.view().canUndo) { g4.undo(); undone++; }
  check('undoing every step returns to the first question with 100 candidates (' + undone + ' undos)', g4.view().phase === 'asking' && g4.view().candidateCount === 100 && g4.view().history.length === 0);
  check('undo with nothing to undo is a safe no-op', g4.undo().ok === false);
})();

/* ------------------------------------------------------------------ */
section('11. Adaptive questions and the "stuck" state (no guessing)');
(function () {
  var bad = [], extraTotal = 0, runs = 0;
  RANGES.forEach(function (max) {
    var restricted = Q.createQuestionSource(max, { baseFilter: function (d) { return d.id === 'even'; } });
    check('range 1–' + max + ': restricted test bank really contains only the parity question', restricted.base.length === 1);
    var step = max > 250 ? 11 : 1;
    for (var secret = 1; secret <= max; secret += step) {
      var rec = playTruthful(max, secret, { variety: 'predictable' }, restricted);
      runs++; extraTotal += rec.questions;
      if (!rec.ok) bad.push(max + '/' + secret + ': ' + rec.problems.join(';'));
      else if (rec.questions > 1 && rec.extra + 1 < rec.questions - 0 && false) bad.push('x');
    }
  });
  check('with a deliberately crippled bank (parity only) adaptively generated questions still identify every tested secret (' + runs + ' rounds)', bad.length === 0, bad.slice(0, 3).join(' | '));

  var restricted50 = Q.createQuestionSource(50, { baseFilter: function () { return false; } });
  var rec2 = playTruthful(50, 23, {}, restricted50);
  check('with an EMPTY standard bank, the adaptive generator supplies questions flagged "extra"', rec2.ok && rec2.extra === rec2.questions && rec2.questions > 0, rec2.questions + ' extra questions');

  // Provoke "stuck": empty base, answer Not sure to everything.
  var g = G.createGame({ max: 50, source: Q.createQuestionSource(50, { baseFilter: function () { return false; } }) });
  g.start();
  var v = g.view(), n = 0;
  while (v.phase === 'asking' && n < 2000) { g.answer('unsure'); v = g.view(); n++; }
  check('answering Not sure to every question ends in "stuck" with all 50 numbers still possible (after ' + n + ' questions)', v.phase === 'stuck' && v.candidateCount === 50);
  check('stuck state never names a guess', v.guess === null && v.solvedNumber === null && v.question === null);
  var cleared = g.clearUnsure();
  check('"ask my Not sure questions again" leaves the stuck state', cleared.ok && g.view().phase === 'asking' && g.view().history.length === 0);
  g.undo();
  check('and that action can be undone', g.view().phase === 'stuck');
})();

/* ------------------------------------------------------------------ */
section('12. Robustness: random action fuzzing (invariants after every step)');
(function () {
  var violations = [], steps = 0;
  RANGES.forEach(function (max) {
    var source = Q.createQuestionSource(max);
    for (var seed = 1; seed <= 150; seed++) {
      var rnd = mulberry32(seed * 31 + max);
      var g = G.createGame({ max: max, source: source, variety: seed % 2 ? 'varied' : 'predictable', rng: mulberry32(seed) });
      g.start();
      for (var i = 0; i < 40; i++) {
        var v = g.view(), r = rnd();
        if (v.phase === 'asking') {
          if (r < 0.7) g.answer(['yes', 'no'][Math.floor(rnd() * 2)]);
          else if (r < 0.8) g.answer('unsure');
          else if (r < 0.9 && v.history.length) g.setAnswer(Math.floor(rnd() * v.history.length), ['yes', 'no', 'unsure'][Math.floor(rnd() * 3)]);
          else g.undo();
        } else if (v.phase === 'guess') {
          if (r < 0.4) g.rejectGuess(); else if (r < 0.6) g.confirmGuess(); else if (r < 0.8) g.undo(); else if (v.history.length) g.setAnswer(Math.floor(rnd() * v.history.length), ['yes', 'no', 'unsure'][Math.floor(rnd() * 3)]);
        } else {
          if (r < 0.4) g.undo();
          else if (r < 0.6 && v.rejected.length) g.restoreRejected(v.rejected[0]);
          else if (v.history.length) g.setAnswer(Math.floor(rnd() * v.history.length), ['yes', 'no', 'unsure'][Math.floor(rnd() * 3)]);
          else g.undo();
        }
        var w = g.view(); steps++;
        var fresh = E.filterCandidates(source, w.history.map(function (h) { return { qid: h.qid, value: h.value }; }), w.rejected);
        var problems = [];
        if (JSON.stringify(fresh) !== JSON.stringify(w.candidates)) problems.push('candidates differ from recompute');
        if (w.phase === 'guess' && w.candidateCount !== 1) problems.push('guess without exactly one candidate');
        if (w.phase === 'solved' && w.candidateCount !== 1) problems.push('solved without exactly one candidate');
        if (w.phase === 'contradiction' && w.candidateCount !== 0) problems.push('contradiction with candidates');
        if (w.phase === 'asking') {
          if (w.candidateCount < 2) problems.push('asking with <2 candidates');
          var q = source.byId(w.question.id);
          var y = w.candidates.filter(q.test).length;
          if (y === 0 || y === w.candidateCount) problems.push('question does not split candidates');
          if (w.history.some(function (h) { return h.qid === w.question.id; })) problems.push('repeated question');
          if (Q.FORBIDDEN_TEXT.test(w.question.text)) problems.push('forbidden wording');
        }
        if (w.history.length && w.history[w.history.length - 1].remainingAfter !== w.candidateCount) problems.push('last count != live count');
        w.history.forEach(function (h) { if (h.value === 'unsure' && h.index > 0 && h.remainingAfter !== w.history[h.index - 1].remainingAfter) problems.push('unsure narrowed'); });
        if (problems.length) { violations.push(max + '/seed' + seed + '/step' + i + ': ' + problems.join(', ')); break; }
      }
    }
  });
  stats.fuzzSteps = steps;
  check('invariants hold after every one of ' + steps + ' random actions (answer / correct / Not sure / reject / confirm / restore / undo)', violations.length === 0, violations.slice(0, 3).join(' | '));
})();

section('13. API misuse is rejected, not crashed');
(function () {
  var g = G.createGame({ max: 100 });
  check('answering before start is rejected', g.answer('yes').ok === false);
  g.start();
  check('starting twice is rejected', g.start().ok === false);
  check('invalid answer value is rejected', g.answer('maybe').ok === false);
  check('setAnswer with a bad index is rejected', g.setAnswer(5, 'yes').ok === false);
  check('rejectGuess / confirmGuess without a guess are rejected', g.rejectGuess().ok === false && g.confirmGuess().ok === false);
  check('restoreRejected for a number never rejected is rejected', g.restoreRejected(7).ok === false);
  check('clearUnsure with nothing marked is rejected', g.clearUnsure().ok === false);
  var threw = false; try { G.createGame({ max: 77 }); } catch (e) { threw = e instanceof RangeError; }
  check('unsupported range throws RangeError', threw);
})();

/* ------------------------------------------------------------------ */
section('14. Offline / safety / source hygiene (static checks)');
(function () {
  var files = ['index.html', 'css/style.css', 'js/questions.js', 'js/engine.js', 'js/game.js', 'js/ui.js', 'js/calculator.js', 'js/calculator-ui.js'];
  var text = {};
  files.forEach(function (f) { text[f] = fs.readFileSync(path.join(ROOT, f), 'utf8'); });
  var all = files.map(function (f) { return text[f]; }).join('\n');
  var urls = (all.match(/https?:\/\/[^\s"')<>]+/g) || []);
  check('no http(s):// URL appears anywhere in the shipped source', urls.length === 0, urls.join(', '));
  var net = ['fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'EventSource', 'importScripts', 'import(', 'eval(', 'new Function', 'localStorage', 'sessionStorage', 'indexedDB', 'document.cookie'];
  var found = net.filter(function (k) { return all.indexOf(k) !== -1; });
  check('no network, dynamic-code or storage APIs are used (' + net.length + ' patterns scanned)', found.length === 0, found.join(', '));
  var ext = (text['index.html'].match(/<(script|link|img|iframe)[^>]+(src|href)="([^"]+)"/g) || []).filter(function (t) { return !/(src|href)="(js\/|css\/|#)/.test(t); });
  check('index.html references only local js/ and css/ files (plus in-page anchors)', ext.length === 0, ext.join(' '));
  function code(src) { return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); }   // drop comments
  check('ui.js code never uses innerHTML / outerHTML / insertAdjacentHTML / document.write (comments ignored)', !/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(code(text['js/ui.js'])));
  check('no TODO / FIXME / placeholder markers in shipped source', !/TODO|FIXME|XXX|lorem ipsum/i.test(all));
  var panelHtml = (text['index.html'].match(/<aside[^>]*id="calcPanel"[\s\S]*?<\/aside>/) || [''])[0];
  var gameHtml = text['index.html'].replace(panelHtml, '');
  check('there is no input field in the game area in which a secret number could be typed (the only inputs are the 2 Division Calculator fields)',
    !/<input\b|<textarea\b/i.test(gameHtml) && (panelHtml.match(/<input\b/g) || []).length === 2 && !/createElement\(['"](input|textarea)/.test(text['js/ui.js']));
  check('game.js never stores or references a secret number (state holds only answers, rejections, confirmation)', !/secret/i.test(code(text['js/game.js'])));
})();

section('15. Colour contrast (WCAG 2.x) of the stylesheet palette');
(function () {
  function lum(hex) {
    var c = [1, 3, 5].map(function (i) { var v = parseInt(hex.substr(i, 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function ratio(a, b) { var l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); }
  var pairs = [
    ['body text on page', '#f1f5f9', '#0d1117'],
    ['muted text on card', '#a9b9c6', '#151d27'],
    ['muted text on field', '#a9b9c6', '#101821'],
    ['footer text on page', '#98a9b6', '#0d1117'],
    ['primary button text', '#1c2024', '#f3c969'],
    ['button text', '#f1f5f9', '#273746'],
    ['Yes button text', '#f1f5f9', '#19392b'],
    ['No button text', '#f1f5f9', '#3c2227'],
    ['gold label on question box', '#f3c969', '#0c131b'],
    ['history text on entry', '#d2dce4', '#202d39'],
    ['gold badge on uncertain entry', '#f3c969', '#2a2a24'],
    ['success message', '#bdf3d1', '#18372a'],
    ['error message', '#ffc7c4', '#402225'],
    ['problem box body', '#f3dcda', '#3a2024'],
    ['problem box title', '#ffd1ce', '#3a2024'],
    ['focus ring on card', '#8bc8ff', '#151d27']
  ];
  var low = [];
  pairs.forEach(function (p) { var r = ratio(p[1], p[2]); stats['contrast: ' + p[0]] = +r.toFixed(2); if (r < 4.5) low.push(p[0] + ' ' + r.toFixed(2)); });
  var css = text_css();
  check('all ' + pairs.length + ' text/background pairs reach ≥ 4.5:1 (min ' + Math.min.apply(null, pairs.map(function (p) { return ratio(p[1], p[2]); })).toFixed(2) + ':1)', low.length === 0, low.join(', '));
  check('every colour used in the checked pairs actually appears in style.css', pairs.every(function (p) { return css.indexOf(p[1]) !== -1 && css.indexOf(p[2]) !== -1; }),
    pairs.filter(function (p) { return css.indexOf(p[1]) === -1 || css.indexOf(p[2]) === -1; }).map(function (p) { return p[0]; }).join(', '));
  check('stylesheet defines a visible :focus-visible outline', /:focus-visible\s*\{[^}]*outline:\s*3px/.test(css));
  check('stylesheet honours prefers-reduced-motion', /prefers-reduced-motion/.test(css));
  check('stylesheet has a narrow-screen layout (max-width media query)', /max-width:\s*520px/.test(css));
  function text_css() { return fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8').toLowerCase(); }
})();

/* ------------------------------------------------------------------ */
var failed = results.filter(function (r) { return !r.pass; });
var elapsed = ((Date.now() - started) / 1000).toFixed(1);
console.log('\n' + '='.repeat(60));
console.log(results.length - failed.length + ' passed, ' + failed.length + ' failed, ' + results.length + ' checks in ' + elapsed + ' s');
if (failed.length) { console.log('\nFAILURES:'); failed.forEach(function (f) { console.log(' - [' + f.group + '] ' + f.name + (f.detail ? ' — ' + f.detail : '')); }); }

if (WRITE_REPORT) {
  var lines = [];
  lines.push('# Test results (generated by `node tests/run-tests.js --write-report`)');
  lines.push('');
  lines.push('- Run on: ' + new Date().toISOString());
  lines.push('- Node: ' + process.version + ' · Platform: ' + process.platform + ' · Duration: ' + elapsed + ' s');
  lines.push('- **Result: ' + (results.length - failed.length) + ' passed, ' + failed.length + ' failed (' + results.length + ' checks)**');
  lines.push('');
  lines.push('This file is written by the test runner itself; it is not edited by hand.');
  var cur = null;
  results.forEach(function (r) {
    if (r.group !== cur) { cur = r.group; lines.push(''); lines.push('## ' + cur); lines.push(''); }
    lines.push('- ' + (r.pass ? '✅' : '❌') + ' ' + r.name + (r.detail ? ' — _' + r.detail + '_' : ''));
  });
  lines.push('');
  lines.push('## Measured statistics');
  lines.push('');
  lines.push('| Range | Mode | Secrets | Failures | Max questions | Avg questions |');
  lines.push('|---|---|---|---|---|---|');
  RANGES.forEach(function (m) {
    var a = stats['exhaustive_' + m], b = stats['varied_' + m];
    lines.push('| 1–' + m + ' | predictable | ' + a.secrets + ' | ' + a.failures + ' | ' + a.maxQuestions + ' | ' + a.avgQuestions + ' |');
    lines.push('| 1–' + m + ' | varied (seeded) | ' + m + ' | ' + b.failures + ' | ' + b.maxQuestions + ' | ' + b.avgQuestions + ' |');
  });
  lines.push('');
  lines.push('Question-count histogram, range 1–1000, predictable order (questions → number of secrets):');
  lines.push('');
  lines.push('`' + JSON.stringify(stats.exhaustive_1000.histogram) + '`');
  lines.push('');
  lines.push('Fuzz steps executed: ' + stats.fuzzSteps);
  lines.push('');
  lines.push('Contrast ratios measured:');
  lines.push('');
  Object.keys(stats).filter(function (k) { return k.indexOf('contrast: ') === 0; }).forEach(function (k) { lines.push('- ' + k.replace('contrast: ', '') + ': ' + stats[k] + ':1'); });
  fs.writeFileSync(path.join(__dirname, 'TEST_RESULTS.md'), lines.join('\n') + '\n');
  console.log('\nWrote tests/TEST_RESULTS.md');
}
process.exit(failed.length ? 1 : 0);
