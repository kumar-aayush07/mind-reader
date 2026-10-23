/*
 * ui.js — USER INTERFACE
 *
 * Renders MRGame's view() into the DOM. No game rules live here.
 * All text is inserted with textContent / createElement (no innerHTML with data).
 */
(function () {
  'use strict';

  var MRQuestions = window.MRQuestions, MRGame = window.MRGame;
  var byId = function (id) { return document.getElementById(id); };

  var game = null;
  var round = 1;
  var notice = null; // { text, kind }

  function el(tag, props, children) {
    var node = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === 'text') node.textContent = props[k];
      else if (k === 'class') node.className = props[k];
      else node.setAttribute(k, props[k]);
    });
    (children || []).forEach(function (c) { node.appendChild(c); });
    return node;
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* ---------- actions ---------- */

  function startGame() {
    var max = Number(byId('range').value);
    game = MRGame.createGame({ max: max, variety: byId('order').value });
    game.start();
    notice = null;
    byId('howto').open = false;
    render('yesBtn');
  }

  function restart() {
    game = null;
    round += 1;
    notice = null;
    render('startBtn');
  }

  function run(action, makeNotice, focusKey) {
    if (!game) return;
    var res = action();
    if (!res.ok) return;
    notice = makeNotice ? makeNotice(res) : null;
    render(focusKey);
  }

  function answer(value) { run(function () { return game.answer(value); }, null); }

  function changeAnswer(index, value) {
    run(function () { return game.setAnswer(index, value); }, function () {
      var v = game.view();
      var label = MRGame.VALUE_LABEL[value];
      if (v.phase === 'contradiction') {
        return { kind: 'fail', text: 'Q' + (index + 1) + ' changed to ' + label + ', but the answers still contradict each other.' };
      }
      if (v.phase === 'stuck') {
        return { kind: 'fail', text: 'Q' + (index + 1) + ' changed to ' + label + '. ' + plural(v.candidateCount, 'number', 'numbers') + ' remain and no question can separate them yet.' };
      }
      return { kind: 'success', text: 'Q' + (index + 1) + ' changed to ' + label + '. Recalculated: ' + plural(v.candidateCount, 'possible number', 'possible numbers') + ' fit all answers.' };
    }, 'row' + index + '-' + value);
  }

  function undo() {
    run(function () { return game.undo(); }, function (res) {
      return { kind: 'success', text: 'Undid ' + res.label + '.' };
    });
  }

  function restore(n) {
    run(function () { return game.restoreRejected(n); }, function () {
      return { kind: 'success', text: 'Restored ' + n + ' as a possible number.' };
    });
  }

  function reviewAnswers() {
    var t = byId('historyTitle');
    t.scrollIntoView({ block: 'start' });
    t.focus();
  }

  /* ---------- rendering ---------- */

  function setStatus(headline, description) {
    byId('headline').textContent = headline;
    byId('description').textContent = description;
  }

  function renderHistory(v) {
    var list = byId('history');
    list.textContent = '';
    if (!v.history.length) {
      list.appendChild(el('li', { class: 'empty', text: 'Questions and your answers will appear here.' }));
      return;
    }
    v.history.slice().reverse().forEach(function (h) {
      var unsure = h.value === 'unsure';
      var qline = el('div', { class: 'q' });
      qline.appendChild(document.createTextNode(h.text));
      if (h.extra) qline.appendChild(el('span', { class: 'badge', text: 'Extra question' }));
      var meta = el('div', { class: 'meta' });
      meta.appendChild(document.createTextNode('Your answer: '));
      meta.appendChild(el('strong', { text: h.label }));
      if (unsure) meta.appendChild(el('span', { class: 'badge', text: '❓ Uncertain · no narrowing' }));
      meta.appendChild(document.createTextNode(' · ' + plural(h.remainingAfter, 'possibility', 'possibilities') + ' left'));
      var fix = el('div', { class: 'fix', role: 'group', 'aria-label': 'Change your answer to question ' + h.number });
      ['yes', 'no', 'unsure'].forEach(function (val) {
        var b = el('button', {
          type: 'button', text: MRGame.VALUE_LABEL[val],
          'aria-pressed': String(h.value === val), 'data-focus-key': 'row' + h.index + '-' + val
        });
        b.addEventListener('click', function () { changeAnswer(h.index, val); });
        fix.appendChild(b);
      });
      list.appendChild(el('li', { class: 'entry' + (unsure ? ' unsure' : '') }, [
        el('span', { class: 'n', text: 'Q' + h.number }),
        el('div', { class: 'body' }, [qline, meta, fix])
      ]));
    });
  }

  function renderRejected(v) {
    var section = byId('rejectedSection');
    var list = byId('rejectedList');
    list.textContent = '';
    section.hidden = v.rejected.length === 0;
    v.rejected.forEach(function (n, i) {
      var b = el('button', { type: 'button', text: 'Restore ' + n, 'data-focus-key': 'restore' + i });
      b.addEventListener('click', function () { restore(n); });
      list.appendChild(el('li', {}, [el('span', { text: 'You said ' + n + ' is not your number.' }), b]));
    });
  }

  function renderProblem(v) {
    var box = byId('problemBox');
    var list = byId('fixList');
    var extra = byId('problemExtra');
    list.textContent = '';
    extra.textContent = '';
    if (v.phase === 'contradiction') {
      box.hidden = false;
      byId('problemTitle').textContent = 'No number fits all of these answers.';
      byId('problemText').textContent = 'Every number from 1 to ' + v.max + ' has been ruled out. If every answer was truthful this cannot happen, so one answer (or a “not my number” click) must be a mistake. Pick a repair below, correct any answer in the list, or undo — nothing is lost.';
      var INLINE_REPAIRS = 5;
      var moreList = null;
      v.suggestions.forEach(function (s, i) {
        var label, action;
        if (s.kind === 'restore') {
          label = 'Put ' + s.n + ' back as a possible number (leaves ' + plural(s.resulting, 'number', 'numbers') + ')';
          action = function () { restore(s.n); };
        } else {
          var to = MRGame.VALUE_LABEL[s.value];
          label = 'Change Q' + s.number + ' “' + s.text + '” from ' + MRGame.VALUE_LABEL[s.from] + ' to ' + to + ' (leaves ' + plural(s.resulting, 'number', 'numbers') + ')';
          action = function () { changeAnswer(s.index, s.value); };
        }
        var b = el('button', { type: 'button', text: label, 'data-focus-key': 'fix' + i });
        b.addEventListener('click', action);
        var li = el('li', {}, [b]);
        if (i < INLINE_REPAIRS) {
          list.appendChild(li);
        } else {
          if (!moreList) {
            moreList = el('ul', { class: 'fixlist' });
            var more = el('details', {}, [
              el('summary', { text: 'More possible repairs (' + (v.suggestions.length - INLINE_REPAIRS) + ')' }),
              moreList
            ]);
            list.appendChild(el('li', {}, [more]));
          }
          moreList.appendChild(li);
        }
      });
      if (!v.suggestions.length) {
        list.appendChild(el('li', { text: 'No single change fixes this, so at least two answers conflict. Review the list below and correct them one at a time.' }));
      }
    } else if (v.phase === 'stuck') {
      box.hidden = false;
      byId('problemTitle').textContent = 'I can’t narrow it down any further.';
      byId('problemText').textContent = plural(v.candidateCount, 'number still fits', 'numbers still fit') + ' your answers, but I have no unused mathematical question that separates them. I won’t guess between them. ' +
        (v.unsureCount ? 'Answering Not sure to a question gives me no information, so try turning a Not sure into Yes or No below, or let me ask those questions again.' : 'Please review your answers below.');
      if (v.unsureCount) {
        var again = el('button', { type: 'button', text: 'Ask my Not sure questions again', 'data-focus-key': 'clearUnsure' });
        again.addEventListener('click', function () {
          run(function () { return game.clearUnsure(); }, function () {
            return { kind: 'success', text: 'The questions you marked Not sure can be asked again.' };
          });
        });
        extra.appendChild(again);
      }
    } else {
      box.hidden = true;
    }
  }

  function defaultFocusFor(phase) {
    switch (phase) {
      case 'asking': return byId('yesBtn');
      case 'guess': return byId('correctBtn');
      case 'solved': return byId('againBtn');
      case 'contradiction':
      case 'stuck': return byId('problemTitle');
      default: return byId('startBtn');
    }
  }

  // skipFocus: true on page load and passive changes, so the page never steals focus
  // from the skip link / headings; focus is only moved in response to user actions.
  function render(focusKey, skipFocus) {
    var active = document.activeElement;
    var activeKey = active && active.getAttribute ? active.getAttribute('data-focus-key') : null;
    var activeId = active && active.id ? active.id : null;
    var v = game ? game.view() : null;

    byId('roundLabel').textContent = 'ROUND ' + pad2(round);

    // settings only change between rounds
    byId('range').disabled = !!game;
    byId('order').disabled = !!game;
    byId('startControls').hidden = !!game;
    byId('playArea').hidden = !game;
    byId('undoBtn').disabled = !(v && v.canUndo);
    byId('undoBtn').textContent = v && v.canUndo ? '↶ Undo ' + v.undoLabel : '↶ Undo last step';
    byId('reviewBtn').disabled = !game;

    if (!v) {
      var max = Number(byId('range').value);
      byId('rangeLabel').textContent = '1–' + max;
      byId('remainingLabel').textContent = max + ' possible numbers';
      setStatus('Ready when you are?', 'Choose your range, think of one whole number in it, then press the button. Don’t type your number anywhere.');
    } else {
      byId('rangeLabel').textContent = '1–' + v.max;
      byId('remainingLabel').textContent = v.phase === 'solved' ? 'Solved'
        : v.phase === 'contradiction' ? 'No numbers fit'
        : plural(v.candidateCount, 'possible number', 'possible numbers');

      var asking = v.phase === 'asking';
      byId('questionBox').hidden = !asking;
      byId('answerButtons').hidden = !asking;
      byId('answerHint').hidden = !asking;
      byId('guessBox').hidden = v.phase !== 'guess';
      byId('solvedBox').hidden = v.phase !== 'solved';

      if (asking) {
        byId('qTag').textContent = 'QUESTION ' + (v.answeredCount + 1) + ' · ' + (v.question.extra ? 'EXTRA MATH PROPERTY' : v.question.tag.toUpperCase());
        byId('questionText').textContent = v.question.text;
        byId('questionText').setAttribute('data-qid', v.question.id);
        var note = byId('qNote');
        note.hidden = !v.question.extra;
        note.textContent = v.question.extra ? 'My standard questions couldn’t separate the remaining numbers, so I generated a new mathematical question instead of guessing.' : '';
        setStatus('Let’s narrow it down.', plural(v.candidateCount, 'number still fits', 'numbers still fit') + ' your answers. Answer honestly — your number stays secret. Not sure is fine and changes nothing.');
      } else if (v.phase === 'guess') {
        byId('guessText').textContent = 'Only ' + v.guess + ' fits.';
        byId('guessDesc').textContent = 'Every other number from 1 to ' + v.max + ' conflicts with your answers. Is ' + v.guess + ' your number?';
        setStatus('I’ve worked it out.', 'Exactly one number is consistent with everything you told me.');
      } else if (v.phase === 'solved') {
        byId('solvedText').textContent = '🏆 Mind read: ' + v.solvedNumber;
        byId('solvedDesc').textContent = 'I identified it after ' + plural(v.answeredCount, 'question', 'questions') + (v.unsureCount ? ' (' + v.unsureCount + ' marked Not sure)' : '') + '. You can still undo or correct an answer above if something was off.';
        setStatus('🏆 Mind read!', 'Deduced from math properties only — no guessing.');
      } else if (v.phase === 'contradiction') {
        setStatus('Your answers contradict each other.', 'No number matches every answer, so something needs correcting.');
      } else if (v.phase === 'stuck') {
        setStatus('I need a different kind of clue.', 'I’m not going to guess while several numbers remain.');
      }
      renderProblem(v);
      renderHistory(v);
      renderRejected(v);
      byId('questionCount').textContent = v.answeredCount + ' asked' + (v.unsureCount ? ' · ' + v.unsureCount + ' uncertain' : '');
      var meter = byId('meter');
      meter.textContent = '';
      for (var i = 0; i < Math.min(v.answeredCount, 30); i++) meter.appendChild(el('span', { class: 'pip' }));
    }

    var n = byId('notice');
    n.className = 'message' + (notice ? ' ' + notice.kind : '');
    n.textContent = notice ? notice.text : '';

    // ---- focus management ----
    if (skipFocus) return;
    var target = null;
    if (focusKey) target = document.querySelector('[data-focus-key="' + focusKey + '"]') || byId(focusKey);
    if (!target && activeKey) target = document.querySelector('[data-focus-key="' + activeKey + '"]');
    if (!target && activeId) {
      var same = byId(activeId);
      if (same && same.offsetParent !== null) target = same;
    }
    var phase = v ? v.phase : 'setup';
    var wantsPhaseFocus = !target || target.offsetParent === null ||
      (phase !== 'asking' && target.id && /^(yesBtn|noBtn|unsureBtn)$/.test(target.id));
    if (wantsPhaseFocus) target = defaultFocusFor(phase);
    if (target && target.focus) target.focus({ preventScroll: false });
  }

  /* ---------- wiring ---------- */

  byId('startBtn').addEventListener('click', startGame);
  byId('yesBtn').addEventListener('click', function () { answer('yes'); });
  byId('noBtn').addEventListener('click', function () { answer('no'); });
  byId('unsureBtn').addEventListener('click', function () { answer('unsure'); });
  byId('correctBtn').addEventListener('click', function () { run(function () { return game.confirmGuess(); }, null); });
  byId('wrongBtn').addEventListener('click', function () { run(function () { return game.rejectGuess(); }, null); });
  byId('againBtn').addEventListener('click', restart);
  byId('restartBtn').addEventListener('click', restart);
  byId('undoBtn').addEventListener('click', undo);
  byId('reviewBtn').addEventListener('click', reviewAnswers);
  byId('range').addEventListener('change', function () { render(null, true); });

  document.addEventListener('keydown', function (e) {
    if (!game || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    var t = e.target;
    var tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
    if (t && t.closest && t.closest('#calcPanel')) return; // the Division Calculator is independent of the game
    if (game.view().phase !== 'asking') return;
    var k = e.key.toLowerCase();
    if (k === 'y') { e.preventDefault(); answer('yes'); }
    else if (k === 'n') { e.preventDefault(); answer('no'); }
    else if (k === 's') { e.preventDefault(); answer('unsure'); }
  });

  // Exposed only so automated browser tests can inspect state; not used by the UI.
  window.__mindReaderDebug = { getView: function () { return game ? game.view() : null; }, MRQuestions: MRQuestions };

  render(null, true);
})();
