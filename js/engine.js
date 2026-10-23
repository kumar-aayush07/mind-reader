/*
 * engine.js — CANDIDATE FILTERING and QUESTION SELECTION
 *
 * Pure functions; no DOM, no global state. Randomness is only used if the
 * caller passes an `rng` function, so tests can be fully deterministic.
 */
(function (root, factory) {
  var api;
  if (typeof module === 'object' && module.exports) api = factory(require('./questions'));
  else api = factory(root.MRQuestions);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MREngine = api;
})(typeof self !== 'undefined' ? self : this, function (Q) {
  'use strict';

  var VARIETY_WINDOW = 1.02; // varied mode may pick any question within 2% of the best cost
  var VARIETY_POOL = 4;      // ...among at most this many of the best

  /**
   * Numbers in 1..max consistent with every Yes/No answer and not rejected.
   * "unsure" answers are ignored on purpose: they never narrow anything.
   *   answers:  [{ qid, value: 'yes' | 'no' | 'unsure' }]
   *   rejected: [number]
   */
  function filterCandidates(source, answers, rejected) {
    var tests = [];
    answers.forEach(function (a) {
      if (a.value !== 'yes' && a.value !== 'no') return;
      var q = source.byId(a.qid);
      if (!q) throw new Error('Unknown question id: ' + a.qid);
      tests.push({ test: q.test, want: a.value === 'yes' });
    });
    var rej = new Set(rejected);
    var out = [];
    for (var n = 1; n <= source.max; n++) {
      if (rej.has(n)) continue;
      var ok = true;
      for (var i = 0; i < tests.length; i++) {
        if (!!tests[i].test(n) !== tests[i].want) { ok = false; break; }
      }
      if (ok) out.push(n);
    }
    return out;
  }

  /** How a question divides the candidates. cost = y² + n² (lower = more even). */
  function splitOf(question, candidates) {
    var yes = 0;
    for (var i = 0; i < candidates.length; i++) if (question.test(candidates[i])) yes++;
    var no = candidates.length - yes;
    return { yes: yes, no: no, cost: yes * yes + no * no };
  }

  function compareRanked(a, b) {
    if (a.cost !== b.cost) return a.cost - b.cost;
    if (a.question.complexity !== b.question.complexity) return a.question.complexity - b.question.complexity;
    return a.question.id < b.question.id ? -1 : a.question.id > b.question.id ? 1 : 0;
  }

  /** Unused questions that really split the candidates, best (most even) first. */
  function rankQuestions(questions, candidates, usedIds) {
    var out = [];
    for (var i = 0; i < questions.length; i++) {
      var q = questions[i];
      if (usedIds.has(q.id)) continue;
      var s = splitOf(q, candidates);
      if (s.yes === 0 || s.no === 0) continue; // would teach us nothing
      out.push({ question: q, yes: s.yes, no: s.no, cost: s.cost });
    }
    out.sort(compareRanked);
    return out;
  }

  /**
   * Pick the next question.
   * 1. Standard bank, most even split first (ties: simpler, then id).
   * 2. If no standard question can separate the candidates, generate extra
   *    legitimate questions adaptively.
   * 3. If even that fails, return null — the caller must NOT guess.
   * With opts.rng the choice is randomised among near-best questions.
   */
  function chooseQuestion(source, candidates, usedIds, opts) {
    var rng = opts && opts.rng;
    var ranked = rankQuestions(source.base, candidates, usedIds);
    var viaAdaptive = false;
    if (!ranked.length) {
      ranked = rankQuestions(source.adaptive(candidates, usedIds), candidates, usedIds);
      viaAdaptive = true;
    }
    if (!ranked.length) return null;
    var pick = ranked[0];
    if (rng) {
      var limit = pick.cost * VARIETY_WINDOW;
      var pool = [];
      for (var i = 0; i < ranked.length && pool.length < VARIETY_POOL; i++) {
        if (ranked[i].cost > limit) break;
        pool.push(ranked[i]);
      }
      pick = pool[Math.floor(rng() * pool.length)];
    }
    return { question: pick.question, viaAdaptive: viaAdaptive, yes: pick.yes, no: pick.no };
  }

  return {
    filterCandidates: filterCandidates,
    splitOf: splitOf,
    rankQuestions: rankQuestions,
    chooseQuestion: chooseQuestion,
    VARIETY_WINDOW: VARIETY_WINDOW,
    VARIETY_POOL: VARIETY_POOL
  };
});
