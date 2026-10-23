/*
 * game.js — GAME STATE
 *
 * A small state machine with no DOM access. All state is a pure function of
 *   answers  (ordered list of {qid, value, extra})
 *   rejected (numbers the player said "that's not my number" about)
 *   confirmed (player confirmed the single remaining candidate)
 * so corrections, undo and recovery simply edit those lists and re-derive.
 *
 * Phases:
 *   setup          not started
 *   asking         >1 candidate and a question is pending
 *   guess          exactly 1 candidate, waiting for the player's confirmation
 *   solved         player confirmed the single candidate
 *   contradiction  0 candidates
 *   stuck          >1 candidates but no question (even adaptive) can split them
 *
 * The computer reaches `guess` ONLY when exactly one candidate remains.
 */
(function (root, factory) {
  var api;
  if (typeof module === 'object' && module.exports) api = factory(require('./questions'), require('./engine'));
  else api = factory(root.MRQuestions, root.MREngine);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MRGame = api;
})(typeof self !== 'undefined' ? self : this, function (Q, E) {
  'use strict';

  var VALUES = ['yes', 'no', 'unsure'];
  var VALUE_LABEL = { yes: 'Yes', no: 'No', unsure: 'Not sure' };

  function createGame(options) {
    var opts = Object.assign({ max: 100, variety: 'predictable', rng: null, source: null }, options || {});
    if (Q.SUPPORTED_RANGES.indexOf(opts.max) === -1) throw new RangeError('Unsupported range: ' + opts.max);
    var source = opts.source || Q.createQuestionSource(opts.max);
    var rng = opts.variety === 'varied' ? (opts.rng || Math.random) : null;

    var st = {
      started: false,
      answers: [],
      rejected: [],
      confirmed: false,
      current: null,        // { question, viaAdaptive } while phase === 'asking'
      candidates: [],
      phase: 'setup',
      undoStack: []
    };

    function fail(reason) { return { ok: false, reason: reason }; }
    function ok() { return { ok: true }; }

    function usedIds() {
      return new Set(st.answers.map(function (a) { return a.qid; }));
    }

    // Deterministic selections are memoised per question source (shared by all
    // games on that source); randomised selections never are.
    function cacheKey() {
      return st.answers.map(function (a) { return a.qid + '=' + a.value; }).join(',') +
        '|' + st.rejected.slice().sort(function (a, b) { return a - b; }).join(',');
    }

    function refresh() {
      st.candidates = E.filterCandidates(source, st.answers, st.rejected);
      st.current = null;
      if (!st.started) { st.phase = 'setup'; return; }
      if (st.candidates.length === 0) { st.phase = 'contradiction'; return; }
      if (st.candidates.length === 1) { st.phase = st.confirmed ? 'solved' : 'guess'; return; }
      var sel;
      if (rng) {
        sel = E.chooseQuestion(source, st.candidates, usedIds(), { rng: rng });
      } else {
        var key = cacheKey();
        if (source.selectionCache.has(key)) sel = source.selectionCache.get(key);
        else {
          sel = E.chooseQuestion(source, st.candidates, usedIds(), null);
          source.selectionCache.set(key, sel);
        }
      }
      if (sel) { st.current = sel; st.phase = 'asking'; } else { st.phase = 'stuck'; }
    }

    function pushUndo(label) {
      st.undoStack.push({
        label: label,
        answers: st.answers.map(function (a) { return { qid: a.qid, value: a.value, extra: a.extra }; }),
        rejected: st.rejected.slice(),
        confirmed: st.confirmed
      });
      if (st.undoStack.length > 500) st.undoStack.shift();
    }

    function questionOf(qid) { return source.byId(qid); }

    /* ---------- actions ---------- */

    function start() {
      if (st.started) return fail('already-started');
      st.started = true;
      refresh();
      return ok();
    }

    function answer(value) {
      if (st.phase !== 'asking') return fail('no-question-pending');
      if (VALUES.indexOf(value) === -1) return fail('bad-value');
      pushUndo('your answer to Q' + (st.answers.length + 1));
      st.answers.push({ qid: st.current.question.id, value: value, extra: st.current.viaAdaptive || st.current.question.adaptive });
      st.confirmed = false;
      refresh();
      return ok();
    }

    function setAnswer(index, value) {
      if (!st.started) return fail('not-started');
      if (!Number.isInteger(index) || index < 0 || index >= st.answers.length) return fail('bad-index');
      if (VALUES.indexOf(value) === -1) return fail('bad-value');
      if (st.answers[index].value === value) return ok();
      pushUndo('the change to Q' + (index + 1));
      st.answers[index].value = value;
      st.confirmed = false;
      refresh();
      return ok();
    }

    function confirmGuess() {
      if (st.phase !== 'guess') return fail('no-guess-pending');
      pushUndo('confirming ' + st.candidates[0]);
      st.confirmed = true;
      refresh();
      return ok();
    }

    function rejectGuess() {
      if (st.phase !== 'guess') return fail('no-guess-pending');
      var n = st.candidates[0];
      pushUndo('rejecting ' + n);
      st.rejected.push(n);
      st.confirmed = false;
      refresh();
      return ok();
    }

    function restoreRejected(n) {
      var i = st.rejected.indexOf(n);
      if (i === -1) return fail('not-rejected');
      pushUndo('restoring ' + n);
      st.rejected.splice(i, 1);
      st.confirmed = false;
      refresh();
      return ok();
    }

    function clearUnsure() {
      if (!st.answers.some(function (a) { return a.value === 'unsure'; })) return fail('nothing-to-clear');
      pushUndo('re-asking the Not sure questions');
      st.answers = st.answers.filter(function (a) { return a.value !== 'unsure'; });
      st.confirmed = false;
      refresh();
      return ok();
    }

    function undo() {
      var snap = st.undoStack.pop();
      if (!snap) return fail('nothing-to-undo');
      st.answers = snap.answers;
      st.rejected = snap.rejected;
      st.confirmed = snap.confirmed;
      refresh();
      return { ok: true, label: snap.label };
    }

    /* ---------- derived view ---------- */

    // Candidate count after each answer (all currently active rejections apply
    // throughout, so the last row always equals the live candidate count).
    function remainingTimeline() {
      var rej = new Set(st.rejected);
      var pool = [];
      for (var n = 1; n <= source.max; n++) if (!rej.has(n)) pool.push(n);
      return st.answers.map(function (a) {
        if (a.value === 'yes' || a.value === 'no') {
          var q = questionOf(a.qid), want = a.value === 'yes';
          pool = pool.filter(function (x) { return !!q.test(x) === want; });
        }
        return pool.length;
      });
    }

    function trial(answers, rejected) {
      return E.filterCandidates(source, answers, rejected).length;
    }

    // Single-change repairs that would leave at least one candidate.
    function suggestFixes() {
      var out = [];
      st.rejected.forEach(function (n, idx) {
        var rest = st.rejected.slice(); rest.splice(idx, 1);
        var left = trial(st.answers, rest);
        if (left > 0) out.push({ kind: 'restore', n: n, resulting: left });
      });
      var flips = [], unsures = [];
      st.answers.forEach(function (a, i) {
        if (a.value === 'unsure') return;
        var q = questionOf(a.qid);
        ['flip', 'unsure'].forEach(function (mode) {
          var v = mode === 'unsure' ? 'unsure' : (a.value === 'yes' ? 'no' : 'yes');
          var copy = st.answers.map(function (x, j) { return j === i ? { qid: x.qid, value: v } : x; });
          var left = trial(copy, st.rejected);
          if (left > 0) {
            var item = { kind: 'set', index: i, number: i + 1, text: q.text, from: a.value, value: v, resulting: left };
            (mode === 'unsure' ? unsures : flips).push(item);
          }
        });
      });
      flips.sort(function (a, b) { return a.index - b.index; });     // read top-down, Q1 first
      unsures.sort(function (a, b) { return a.index - b.index; });
      return out.concat(flips, unsures);
    }

    function view() {
      var timeline = remainingTimeline();
      var unsureCount = st.answers.filter(function (a) { return a.value === 'unsure'; }).length;
      var top = st.undoStack.length ? st.undoStack[st.undoStack.length - 1] : null;
      return {
        phase: st.phase,
        max: source.max,
        candidates: st.candidates.slice(),
        candidateCount: st.candidates.length,
        question: st.current ? {
          id: st.current.question.id,
          text: st.current.question.text,
          tag: st.current.question.tag,
          extra: !!(st.current.viaAdaptive || st.current.question.adaptive)
        } : null,
        history: st.answers.map(function (a, i) {
          var q = questionOf(a.qid);
          return {
            index: i, number: i + 1, qid: a.qid, text: q.text, tag: q.tag, extra: !!a.extra,
            value: a.value, label: VALUE_LABEL[a.value], remainingAfter: timeline[i]
          };
        }),
        rejected: st.rejected.slice(),
        unsureCount: unsureCount,
        answeredCount: st.answers.length,
        solvedNumber: st.phase === 'solved' ? st.candidates[0] : null,
        guess: st.phase === 'guess' ? st.candidates[0] : null,
        canUndo: st.undoStack.length > 0,
        undoLabel: top ? top.label : null,
        suggestions: st.phase === 'contradiction' ? suggestFixes() : []
      };
    }

    return {
      start: start, answer: answer, setAnswer: setAnswer, confirmGuess: confirmGuess,
      rejectGuess: rejectGuess, restoreRejected: restoreRejected, clearUnsure: clearUnsure,
      undo: undo, view: view, source: source
    };
  }

  return { createGame: createGame, VALUE_LABEL: VALUE_LABEL };
});
