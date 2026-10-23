/*
 * calculator-ui.js — DIVISION CALCULATOR PANEL
 *
 * Connects the calculator panel's inputs to MRCalculator. It reads only the two
 * text fields inside #calcPanel and writes only inside #calcPanel. It has no
 * access to, and no knowledge of, the game, its questions or its state.
 */
(function () {
  'use strict';

  var MRCalculator = window.MRCalculator;
  var panel = document.getElementById('calcPanel');
  if (!panel || !MRCalculator) return;

  var byId = function (id) { return document.getElementById(id); };
  var inputs = { dividend: byId('calcDividend'), divisor: byId('calcDivisor') };
  var tiles = {
    dividend: byId('calcOutDividend'),
    divisor: byId('calcOutDivisor'),
    quotient: byId('calcOutQuotient'),
    remainder: byId('calcOutRemainder')
  };
  var message = byId('calcMessage');
  var EMPTY = '—';

  function update() {
    var res = MRCalculator.calculate(inputs.dividend.value, inputs.divisor.value);

    var ok = res.status === 'ok';
    tiles.dividend.textContent = ok ? String(res.dividend) : EMPTY;
    tiles.divisor.textContent = ok ? String(res.divisor) : EMPTY;
    tiles.quotient.textContent = ok ? String(res.quotient) : EMPTY;
    tiles.remainder.textContent = ok ? String(res.remainder) : EMPTY;
    panel.setAttribute('data-calc-status', res.status);

    ['dividend', 'divisor'].forEach(function (name) {
      var bad = res.fields[name] === 'invalid' || res.fields[name] === 'out-of-range' || res.fields[name] === 'zero';
      if (bad) inputs[name].setAttribute('aria-invalid', 'true');
      else inputs[name].removeAttribute('aria-invalid');
    });

    message.textContent = res.message;
    message.className = 'calc-message' + (ok ? ' ok' : (res.status === 'empty' ? '' : ' bad'));
  }

  inputs.dividend.addEventListener('input', update);
  inputs.divisor.addEventListener('input', update);

  byId('calcClear').addEventListener('click', function () {
    inputs.dividend.value = '';
    inputs.divisor.value = '';
    update();
    inputs.dividend.focus(); // stays inside the calculator panel
  });

  update();
})();
