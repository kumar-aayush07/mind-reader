#!/usr/bin/env python3
"""
Mind Reader — real-browser tests (Chromium via Playwright, opened from file://).

Setup (one time, only needed for these browser tests; the game itself has no dependencies):
    pip install playwright && python -m playwright install chromium

Run:
    python3 tests/browser-test.py                  # tests index.html and the standalone build
    python3 tests/browser-test.py --write-report   # also write tests/BROWSER_RESULTS.md

Exit code is 0 only if every check passed.
"""
import os
import sys
import time
import datetime
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TARGETS = [
    ("index.html (multi-file)", os.path.join(ROOT, "index.html")),
    ("mind_reader_standalone.html (single file)", os.path.join(ROOT, "mind_reader_standalone.html")),
]
WRITE_REPORT = "--write-report" in sys.argv

results = []
current_group = ""


def section(name):
    global current_group
    current_group = name
    print("\n== " + name)


def check(name, cond, detail=""):
    results.append((current_group, name, bool(cond), detail))
    print(("  PASS " if cond else "  FAIL ") + name + (("  — " + str(detail)) if detail else ""))


# In-page helper: truthful answer for a secret, using the page's own question definitions.
JS_TRUTH = """([max, qid, secret]) =>
  window.__mindReaderDebug.MRQuestions.createQuestionSource(max).byId(qid).test(secret)"""

# In-page exhaustive driver: clicks the real buttons for every secret in the range.
JS_EXHAUSTIVE = """({max, order}) => {
  const Q = window.__mindReaderDebug.MRQuestions;
  const src = Q.createQuestionSource(max);
  const $ = id => document.getElementById(id);
  const failures = []; let maxQ = 0, total = 0;
  for (let secret = 1; secret <= max; secret++) {
    if ($('startControls').hidden) $('restartBtn').click();
    $('range').value = String(max); $('order').value = order;
    $('startBtn').click();
    let n = 0;
    while (!$('answerButtons').hidden) {
      if (n > 60) { failures.push(secret + ': runaway'); break; }
      const qid = $('questionText').getAttribute('data-qid');
      $(src.byId(qid).test(secret) ? 'yesBtn' : 'noBtn').click(); n++;
    }
    if ($('guessBox').hidden) { failures.push(secret + ': no guess box (' + $('headline').textContent + ')'); continue; }
    if ($('guessText').textContent !== 'Only ' + secret + ' fits.') failures.push(secret + ': wrong guess text "' + $('guessText').textContent + '"');
    if (!$('solvedBox').hidden || /Mind read/.test($('headline').textContent)) failures.push(secret + ': success announced before confirmation');
    $('correctBtn').click();
    if ($('solvedBox').hidden || $('solvedText').textContent.indexOf(String(secret)) === -1) failures.push(secret + ': not shown as solved');
    maxQ = Math.max(maxQ, n); total += n;
  }
  if (!$('startControls').hidden) { /* already at setup */ } else { $('restartBtn').click(); }
  return { failures, maxQ, avg: +(total / max).toFixed(2) };
}"""



JS_NOT_SURE_EVERYTHING = """() => {
  const $ = id => document.getElementById(id);
  let clicks = 0, sawExtraNote = false, extraBadgeText = '';
  while (!$('answerButtons').hidden && clicks < 3000) {
    if (!$('qNote').hidden) { sawExtraNote = true; extraBadgeText = $('qNote').textContent; }
    $('unsureBtn').click(); clicks++;
  }
  return { clicks, sawExtraNote, extraBadgeText };
}"""

def truth(page, max_, qid, secret):
    return page.evaluate(JS_TRUTH, [max_, qid, secret])


def view(page):
    return page.evaluate("window.__mindReaderDebug.getView()")


def visible(page, sel):
    return page.locator(sel).is_visible()


def active_id(page):
    return page.evaluate("document.activeElement && document.activeElement.id")


def fresh(browser, path, viewport=None):
    ctx = browser.new_context(viewport=viewport or {"width": 1100, "height": 900})
    page = ctx.new_page()
    log = {"console": [], "errors": [], "requests": []}
    page.on("console", lambda m: log["console"].append((m.type, m.text)) if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: log["errors"].append(str(e)))
    page.on("request", lambda r: log["requests"].append(r.url))
    page.goto("file://" + path)
    return ctx, page, log


def start_round(page, rng="100", order="predictable"):
    if not page.locator("#startControls").is_visible():
        page.click("#restartBtn")
    page.select_option("#range", rng)
    page.select_option("#order", order)
    page.click("#startBtn")


def play_to_guess(page, max_, secret):
    guard = 0
    while page.locator("#answerButtons").is_visible() and guard < 60:
        qid = page.get_attribute("#questionText", "data-qid")
        page.click("#yesBtn" if truth(page, max_, qid, secret) else "#noBtn")
        guard += 1


def no_horizontal_overflow(page):
    return page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")


def run_target(browser, label, path, all_logs):
    if not os.path.exists(path):
        check(label + ": file exists", False, path)
        return

    section(label + " — loads and stays offline")
    ctx, page, log = fresh(browser, path)
    all_logs.append(log)
    check("opens from file:// with the expected title", "Mind Reader" in page.title())
    check("no console errors or warnings on load", not log["console"] and not log["errors"], str(log["console"] + log["errors"]))
    check("page does not steal focus on load (nothing focused until the user acts)", page.evaluate("document.activeElement === document.body"))
    check("setup screen: range select enabled, Start button visible, no question yet",
          page.locator("#range").is_enabled() and visible(page, "#startBtn") and not visible(page, "#answerButtons"))
    check("clear instructions are visible before starting (How to play, expanded)", page.evaluate("document.getElementById('howto').open") and "Never type it anywhere" in page.inner_text("#howto"))
    check("no text input in the game area where a secret could be typed (the only 2 inputs on the page are the Division Calculator fields)",
          page.locator("#main input").count() == 0 and page.locator("textarea").count() == 0 and
          page.locator("input").count() == 2 and page.locator("#calcPanel input").count() == 2)

    section(label + " — core flow with real clicks and keys")
    start_round(page, "100", "predictable")
    check("after Start, focus moves to the Yes button", active_id(page) == "yesBtn")
    check("first question is shown with a data-qid and the standard parity wording", page.inner_text("#questionText") == "Is your number even?")
    check("range and order selects are locked while a round is running", page.locator("#range").is_disabled() and page.locator("#order").is_disabled())
    page.keyboard.press("n")
    v = view(page)
    check("keyboard shortcut N answers No", v["history"][0]["value"] == "no" and v["candidateCount"] == 50)
    before = view(page)["candidateCount"]
    page.keyboard.press("s")
    v = view(page)
    check("keyboard shortcut S answers Not sure and does not narrow", v["history"][-1]["value"] == "unsure" and v["candidateCount"] == before)
    entry_text = page.inner_text("#history .entry.unsure")
    check("a Not-sure answer is visibly marked as uncertain in the list", "Uncertain" in entry_text and "Not sure" in entry_text, entry_text.replace("\n", " | "))
    check("header count shows how many answers are uncertain", "1 uncertain" in page.inner_text("#questionCount").lower())

    page.click('[data-focus-key="row0-yes"]')
    v = view(page)
    check("clicking Yes on Q1's own row corrects it and rebuilds candidates (even numbers now)", v["history"][0]["value"] == "yes" and all(n % 2 == 0 for n in v["candidates"]))
    check("focus stays on the corrected row's button after re-render", page.evaluate("document.activeElement.getAttribute('data-focus-key')") == "row0-yes")
    check("correction notice reports the recalculated count", "Recalculated" in page.inner_text("#notice"), page.inner_text("#notice"))
    pressed = page.get_attribute('[data-focus-key="row0-yes"]', "aria-pressed")
    check("the chosen answer is exposed with aria-pressed", pressed == "true" and page.get_attribute('[data-focus-key="row0-no"]', "aria-pressed") == "false")
    count_labels = page.locator("#history .entry .meta").all_inner_texts()
    check("every list row shows a 'possibilities left' count", all("left" in t for t in count_labels))
    check("top-bar count equals the live candidate count", ("%d possible" % view(page)["candidateCount"]) in page.inner_text("#remainingLabel"))

    n_before = len(view(page)["history"])
    page.click("#undoBtn")
    check("Undo removes the last step", len(view(page)["history"]) == n_before - 1 or view(page)["history"][0]["value"] == "no")

    section(label + " — wrong guess, undo and success announcement")
    page.click("#restartBtn")
    check("Start over returns to the setup screen with controls unlocked", visible(page, "#startBtn") and page.locator("#range").is_enabled())
    start_round(page, "100", "predictable")
    play_to_guess(page, 100, 58)
    check("guess box appears only when exactly one number remains", visible(page, "#guessBox") and view(page)["candidateCount"] == 1)
    check("guess box names 58 and success is NOT announced yet", "58" in page.inner_text("#guessText") and not visible(page, "#solvedBox") and "Mind read" not in page.inner_text("#headline"))
    check("focus moves to the confirm button when the guess appears", active_id(page) == "correctBtn")
    page.click("#wrongBtn")
    check("rejecting shows a contradiction explanation with correction controls", visible(page, "#problemBox") and "No number fits" in page.inner_text("#problemTitle") and page.locator("#fixList button").count() >= 1)
    check("rejected number is listed with a Restore button", visible(page, "#rejectedSection") and "Restore 58" in page.inner_text("#rejectedList"))
    check("top bar says no numbers fit", "No numbers fit" in page.inner_text("#remainingLabel"))
    page.click("#undoBtn")
    check("Undo (accidental 'not my number' click) brings the same guess back", visible(page, "#guessBox") and "58" in page.inner_text("#guessText") and not visible(page, "#problemBox"))
    page.click("#wrongBtn")
    page.click('[data-focus-key="fix0"]')
    check("first suggested repair ('Put 58 back') restores the guess", visible(page, "#guessBox") and "58" in page.inner_text("#guessText"))
    page.click("#correctBtn")
    check("success is announced only after confirmation", visible(page, "#solvedBox") and "58" in page.inner_text("#solvedText") and "Mind read" in page.inner_text("#headline"))
    check("focus moves to Play again after success", active_id(page) == "againBtn")
    page.click("#undoBtn")
    check("Undo of an accidental confirmation returns to the guess", visible(page, "#guessBox") and not visible(page, "#solvedBox"))

    section(label + " — one wrong answer, found and repaired through the UI")
    page.click("#restartBtn")
    start_round(page, "100", "predictable")
    secret, lie_index, i = 64, 1, 0
    while page.locator("#answerButtons").is_visible():
        qid = page.get_attribute("#questionText", "data-qid")
        t = truth(page, 100, qid, secret)
        page.click("#yesBtn" if (t != (i == lie_index)) else "#noBtn")
        i += 1
    shown = view(page)
    check("lying once leads to a wrong unique guess (not 64) or a contradiction, never silent success", shown["phase"] in ("guess", "contradiction") and shown.get("solvedNumber") is None)
    if shown["phase"] == "guess":
        page.click("#wrongBtn")
    all_fixes = page.locator("#fixList button").all_text_contents()
    check("contradiction panel lists a repair for exactly the lied-about answer (Q2)", any(("Change Q2 " in t) for t in all_fixes), "%d repairs offered" % len(all_fixes))
    check("repairs beyond the first five are reachable through a 'More possible repairs' disclosure", (len(all_fixes) <= 5) or page.locator("#fixList summary").count() == 1)
    if page.locator("#fixList summary").count():
        page.locator("#fixList summary").click()
    page.locator("#fixList button", has_text="Change Q2 ").first.click()
    v = view(page)
    check("applying that repair leaves candidates that include the true secret 64", v["phase"] in ("asking", "guess") and 64 in v["candidates"], "phase %s, %d candidates" % (v["phase"], v["candidateCount"]))
    play_to_guess(page, 100, 64)
    page.click("#correctBtn")
    check("round then finishes with 64 confirmed", "64" in page.inner_text("#solvedText"))
    page.click("#againBtn")

    section(label + " — keyboard accessibility")
    page.reload()
    page.keyboard.press("Tab")  # skip link
    check("first Tab stop is the skip link and it becomes visible", page.evaluate("document.activeElement.className") == "skip" and page.evaluate("document.activeElement.getBoundingClientRect().left >= 0"))
    page.keyboard.press("Tab")
    ids = []
    for _ in range(6):
        ids.append(page.evaluate("document.activeElement.id"))
        page.keyboard.press("Tab")
    check("Tab reaches range, order, instructions, Start button in a logical order", ids[:4] == ["range", "order", "", "startBtn"], str(ids))
    page.focus("#startBtn")
    page.keyboard.press("Enter")
    check("Enter on the focused Start button starts the round", visible(page, "#answerButtons"))
    page.keyboard.press("Tab")
    focus_ring = page.evaluate("""() => { const e = document.activeElement; const s = getComputedStyle(e);
        return { focusVisible: e.matches(':focus-visible'), width: s.outlineWidth, style: s.outlineStyle, id: e.id }; }""")
    check("keyboard focus shows a 3px outline", focus_ring["focusVisible"] and focus_ring["width"] == "3px" and focus_ring["style"] == "solid", str(focus_ring))
    page.keyboard.press("Enter")
    check("buttons can be activated with Enter from the keyboard", len(view(page)["history"]) == 1)
    page.focus("#unsureBtn"); page.keyboard.press("Space")
    check("buttons can be activated with Space from the keyboard", len(view(page)["history"]) == 2 and view(page)["history"][1]["value"] == "unsure")
    check("status text sits in an aria-live region", page.evaluate("document.getElementById('headline').parentElement.getAttribute('aria-live')") == "polite")
    check("answer buttons carry accessible names and shortcuts", page.get_attribute("#yesBtn", "aria-keyshortcuts") == "Y" and page.get_attribute("#answerButtons", "aria-label") == "Your answer")
    page.focus("#range") if False else None
    ctx.close()

    section(label + " — responsive layout (no sideways scrolling)")
    for (w, h) in [(320, 640), (375, 740), (768, 900), (1280, 900)]:
        ctx2, pg, lg = fresh(browser, path, {"width": w, "height": h})
        all_logs.append(lg)
        ok = no_horizontal_overflow(pg)
        start_round(pg, "100", "predictable")
        for _ in range(3):
            pg.click("#yesBtn")
        ok = ok and no_horizontal_overflow(pg)
        pg.click("#unsureBtn")
        ok = ok and no_horizontal_overflow(pg)
        play_to_guess(pg, 100, 77)
        ok = ok and no_horizontal_overflow(pg)
        pg.click("#wrongBtn")
        ok = ok and no_horizontal_overflow(pg)
        small_buttons = pg.evaluate("""() => [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null)
            .filter(b => b.getBoundingClientRect().height < 34).map(b => b.textContent.trim())""")
        check("%dx%d: no horizontal overflow in setup / asking / guess / contradiction states" % (w, h), ok)
        check("%dx%d: every visible button is at least 34px tall (touch target)" % (w, h), not small_buttons, str(small_buttons))
        ctx2.close()

    section(label + " — Division Calculator panel: behaviour")
    ctx5, pg5, lg5 = fresh(browser, path)
    all_logs.append(lg5)
    T = lambda i: pg5.inner_text("#" + i)
    tiles = lambda: [T("calcOutDividend"), T("calcOutDivisor"), T("calcOutQuotient"), T("calcOutRemainder")]
    check("panel has the heading 'Division Calculator'", pg5.inner_text("#calcTitle").strip().lower() == "division calculator" and pg5.locator("#calcTitle").evaluate("e => e.tagName") == "H2")
    check("inputs have programmatic labels 'Dividend' and 'Divisor'",
          pg5.evaluate("document.getElementById('calcDividend').labels[0].textContent") == "Dividend" and
          pg5.evaluate("document.getElementById('calcDivisor').labels[0].textContent") == "Divisor")
    check("before typing: all four values show a dash and a prompt is shown", tiles() == ["—", "—", "—", "—"] and "Enter a dividend and a divisor" in T("calcMessage"))
    check("the only button in the panel is Clear (no Calculate button)", pg5.locator("#calcPanel button").count() == 1 and T("calcClear") == "Clear")
    pg5.click("#calcDividend")
    pg5.keyboard.type("5")
    pg5.keyboard.type("8")
    check("typing only a dividend asks for a divisor and shows no result", "Enter a divisor" in T("calcMessage") and tiles()[2:] == ["—", "—"])
    pg5.click("#calcDivisor")
    pg5.keyboard.type("7")
    check("58 ÷ 7 appears automatically while typing (no button): 58, 7, quotient 8, remainder 2", tiles() == ["58", "7", "8", "2"], str(tiles()))
    check("the identity line is shown: 58 = 7 × 8 + 2", T("calcMessage").strip() == "58 = 7 × 8 + 2")
    pg5.click("#calcDividend"); pg5.keyboard.press("End"); pg5.keyboard.type("0")
    check("editing the dividend updates immediately (580 ÷ 7 → 82 r 6)", tiles() == ["580", "7", "82", "6"], str(tiles()))
    pg5.fill("#calcDividend", "56")
    check("exact division 56 ÷ 7 → 8 remainder 0", tiles() == ["56", "7", "8", "0"])
    pg5.fill("#calcDivisor", "0")
    check("zero divisor: clear message, quotient and remainder show dashes (not 0, NaN or Infinity)",
          "cannot be zero" in T("calcMessage") and tiles()[2:] == ["—", "—"] and pg5.get_attribute("#calcDivisor", "aria-invalid") == "true", T("calcMessage"))
    check("zero divisor: dividend tile does not echo a half-valid state", tiles()[:2] == ["—", "—"])
    pg5.fill("#calcDivisor", "7.5")
    check("decimal input is rejected with an explanation and no result", "whole number" in T("calcMessage") and tiles() == ["—", "—", "—", "—"] and pg5.get_attribute("#calcDivisor", "aria-invalid") == "true")
    pg5.fill("#calcDivisor", "7")
    check("fixing the input removes the invalid state and restores the result", pg5.get_attribute("#calcDivisor", "aria-invalid") is None and tiles() == ["56", "7", "8", "0"])
    pg5.fill("#calcDividend", "abc")
    check("letters are rejected", "whole number" in T("calcMessage") and pg5.get_attribute("#calcDividend", "aria-invalid") == "true" and tiles()[2:] == ["—", "—"])
    pg5.fill("#calcDividend", "-58")
    check("negative dividend: -58 ÷ 7 → quotient -9, remainder 5, with a note", tiles() == ["-58", "7", "-9", "5"] and "never negative" in T("calcMessage"), str(tiles()))
    pg5.fill("#calcDivisor", "-7")
    check("negative divisor: -58 ÷ -7 → quotient 9, remainder 5", tiles() == ["-58", "-7", "9", "5"], str(tiles()))
    pg5.fill("#calcDividend", "9007199254740991"); pg5.fill("#calcDivisor", "1")
    check("largest safe integer ÷ 1 is exact in the DOM (9007199254740991 r 0)", tiles() == ["9007199254740991", "1", "9007199254740991", "0"], str(tiles()))
    pg5.fill("#calcDividend", "9007199254740992")
    check("one above the safe limit is refused with a range message and no result", "safe integer range" in T("calcMessage") and tiles()[2:] == ["—", "—"], T("calcMessage"))
    pg5.fill("#calcDividend", "-9007199254740992")
    check("one below the negative safe limit is refused", "safe integer range" in T("calcMessage") and tiles()[2:] == ["—", "—"])
    pg5.fill("#calcDividend", "99999999999999999999")
    check("a 20-digit number is refused (no Infinity / exponent / rounded result)", "safe integer range" in T("calcMessage") and not any(("e+" in t or "Infinity" in t or "NaN" in t) for t in tiles() + [T("calcMessage")]))
    pg5.fill("#calcDividend", ""); pg5.fill("#calcDivisor", "")
    check("emptying both fields returns to the prompt with dashes", tiles() == ["—", "—", "—", "—"] and pg5.get_attribute("#calcDividend", "aria-invalid") is None)
    pg5.fill("#calcDividend", "58"); pg5.fill("#calcDivisor", "7")
    pg5.click("#calcClear")
    check("Clear empties both fields, resets all four values and the message", pg5.input_value("#calcDividend") == "" and pg5.input_value("#calcDivisor") == "" and tiles() == ["—", "—", "—", "—"] and "Enter a dividend and a divisor" in T("calcMessage"))
    check("after Clear, focus returns to the Dividend field (inside the panel)", active_id(pg5) == "calcDividend")
    pg5.fill("#calcDividend", "x"); pg5.click("#calcClear")
    check("Clear also removes an invalid-state marker", pg5.get_attribute("#calcDividend", "aria-invalid") is None)
    bad_text = pg5.evaluate("""() => { const t = document.getElementById('calcPanel').innerText; return /NaN|Infinity|undefined|null/.test(t) }""")
    check("the panel never displays NaN, Infinity, undefined or null (checked on the reset state)", not bad_text)
    check("calculator announcements use a polite live region", pg5.get_attribute("#calcMessage", "role") == "status" and pg5.get_attribute("#calcMessage", "aria-live") == "polite")
    ctx5.close()

    section(label + " — Division Calculator panel: layout")
    for (w, h, mode) in [(1600, 900, "beside-centered"), (1440, 900, "beside-centered"), (1100, 900, "beside"), (1280, 900, "beside"), (1000, 900, "below"), (768, 900, "below"), (375, 800, "below"), (320, 640, "below")]:
        c6, p6, l6 = fresh(browser, path, {"width": w, "height": h})
        all_logs.append(l6)
        p6.fill("#calcDividend", "9007199254740991"); p6.fill("#calcDivisor", "7")
        g = p6.evaluate("""() => { const r = s => { const b = document.querySelector(s).getBoundingClientRect(); return {l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width}; };
            return {main: r('#main'), calc: r('#calcPanel'), over: document.documentElement.scrollWidth - window.innerWidth, vw: window.innerWidth}; }""")
        ok_pos = (g["calc"]["l"] >= g["main"]["r"] - 0.5) if mode.startswith("beside") else (g["calc"]["t"] >= g["main"]["b"] - 0.5)
        check("%dpx wide: calculator is %s the game" % (w, "to the right of" if mode.startswith("beside") else "below"), ok_pos, str({k: round(v) for k, v in g["calc"].items()}))
        check("%dpx wide: no horizontal overflow, calculator inside the viewport" % w, g["over"] <= 1 and g["calc"]["r"] <= g["vw"] + 0.5 and g["calc"]["l"] >= -0.5)
        check("%dpx wide: game card is never wider than 760px (width %d)" % (w, round(g["main"]["w"])), g["main"]["w"] <= 760.5)
        if mode == "beside-centered":
            check("%dpx wide: the game stays horizontally centred (unchanged position)" % w, abs((g["main"]["l"] + g["main"]["r"]) / 2 - g["vw"] / 2) <= 1.5)
        if mode == "beside":
            check("%dpx wide: calculator top aligns with the game card top" % w, abs(g["calc"]["t"] - g["main"]["t"]) <= 1.5)
        # worst-case content: 24 invalid characters + long message must still not overflow
        p6.fill("#calcDividend", "9" * 24); p6.fill("#calcDivisor", "x" * 24)
        over = p6.evaluate("document.documentElement.scrollWidth - window.innerWidth")
        check("%dpx wide: 24-character inputs and the longest messages cause no overflow" % w, over <= 1)
        c6.close()

    section(label + " — Division Calculator panel: independence from the game")
    ctx7, pg7, lg7 = fresh(browser, path)
    all_logs.append(lg7)
    check("the calculator is after the game in Tab order: Start over → Dividend → Divisor → Clear",
          (lambda: (pg7.focus("#restartBtn"), pg7.keyboard.press("Tab"), active_id(pg7))[-1])() == "calcDividend" and
          (lambda: (pg7.keyboard.press("Tab"), active_id(pg7))[-1])() == "calcDivisor" and
          (lambda: (pg7.keyboard.press("Tab"), active_id(pg7))[-1])() == "calcClear")
    start_round(pg7, "100", "predictable")
    pg7.keyboard.press("n")
    before_view = view(pg7)
    before_main = pg7.inner_text("#main")
    before_focus = active_id(pg7)
    pg7.fill("#calcDividend", "58"); pg7.fill("#calcDivisor", "7")
    for txt in ("0", "-1", "abc", "9007199254740992"):
        pg7.fill("#calcDividend", txt)
    pg7.click("#calcClear")
    pg7.fill("#calcDividend", "58"); pg7.fill("#calcDivisor", "7")
    after_view = view(pg7)
    check("using the calculator changes nothing in the game state (candidates, history, undo, question, phase identical)", before_view == after_view)
    check("using the calculator changes nothing in the game's visible text", pg7.inner_text("#main") == before_main)
    check("the calculator never exposes candidates or the secret: the panel text contains only calculator content",
          set(pg7.inner_text("#calcPanel").lower().replace("\n", " ").split()) <= set("Division Calculator A handy helper for checking remainders. It uses only the numbers you type here. Dividend Divisor Quotient Remainder 58 7 8 2 = × + Clear".lower().split()),
          pg7.inner_text("#calcPanel").replace("\n", " "))
    hist_before = len(view(pg7)["history"])
    pg7.click("#calcDividend"); pg7.keyboard.type("yns")
    check("typing the shortcut letters y / n / s inside a calculator field does NOT answer the game", len(view(pg7)["history"]) == hist_before)
    check("those letters are treated as invalid calculator input, not as game answers", "whole number" in pg7.inner_text("#calcMessage"))
    pg7.fill("#calcDividend", "58")
    pg7.focus("#calcClear"); pg7.keyboard.press("y"); pg7.keyboard.press("n"); pg7.keyboard.press("s")
    check("pressing y / n / s while the Clear button has focus does NOT answer the game", len(view(pg7)["history"]) == hist_before)
    pg7.focus("#undoBtn"); pg7.keyboard.press("y")
    check("game shortcuts still work normally when focus is in the game area", len(view(pg7)["history"]) == hist_before + 1)
    pg7.click("#yesBtn")
    check("calculator values are unaffected by game answers (still 58 ÷ 7 → 8 r 2)", pg7.inner_text("#calcOutQuotient") == "8" and pg7.inner_text("#calcOutRemainder") == "2" and pg7.input_value("#calcDividend") == "58")
    pg7.click("#restartBtn")
    check("Start over does not touch the calculator", pg7.input_value("#calcDividend") == "58" and pg7.input_value("#calcDivisor") == "7" and pg7.inner_text("#calcOutQuotient") == "8")
    start_round(pg7, "100", "predictable")
    check("starting a round still moves focus to Yes (game focus management unchanged, calculator content present)", active_id(pg7) == "yesBtn")
    pg7.click("#undoBtn") if view(pg7)["history"] else None
    pg7.fill("#calcDividend", "")
    check("the game keeps working after calculator use (answer, undo, correction)", (lambda: (pg7.click("#yesBtn"), pg7.click("#noBtn"), pg7.click('[data-focus-key="row0-no"]'), len(view(pg7)["history"]) == 2 and view(pg7)["history"][0]["value"] == "no")[-1])())
    ctx7.close()

    section(label + " — 'Not sure' to everything: adaptive questions, then an honest 'stuck' screen")
    ctx4, pg4, lg4 = fresh(browser, path)
    all_logs.append(lg4)
    start_round(pg4, "50", "predictable")
    r = pg4.evaluate(JS_NOT_SURE_EVERYTHING)
    v = view(pg4)
    check("standard questions run out, then extra generated questions are announced (%d clicks)" % r["clicks"], r["sawExtraNote"] and "generated a new mathematical question" in r["extraBadgeText"])
    check("with every answer Not sure all 50 numbers remain and the game says it cannot narrow further", v["phase"] == "stuck" and v["candidateCount"] == 50 and visible(pg4, "#problemBox") and "can’t narrow it down" in pg4.inner_text("#problemTitle"))
    check("the stuck screen refuses to guess (no guess/solved box, no question, no answer buttons)", not visible(pg4, "#guessBox") and not visible(pg4, "#solvedBox") and not visible(pg4, "#answerButtons"))
    check("the stuck screen offers to re-ask the Not sure questions", pg4.locator("#problemExtra button", has_text="Ask my Not sure questions again").count() == 1)
    check("focus moves to the stuck explanation heading", pg4.evaluate("document.activeElement.id") == "problemTitle")
    pg4.click("#problemExtra button")
    check("re-asking clears the Not sure answers and resumes questioning", visible(pg4, "#answerButtons") and len(view(pg4)["history"]) == 0)
    pg4.click("#undoBtn")
    check("that action is undoable from the Undo button", view(pg4)["phase"] == "stuck")
    ctx4.close()

    ctx3, pg3, lg3 = fresh(browser, path)
    all_logs.append(lg3)
    section(label + " — exhaustive: every secret clicked through the real UI")
    for max_ in (50, 100, 250, 1000):
        for order in ("predictable", "varied"):
            t0 = time.time()
            r = pg3.evaluate(JS_EXHAUSTIVE, {"max": max_, "order": order})
            check("range 1–%d, %s order: all %d secrets reached the right guess and success only after confirmation" % (max_, order, max_),
                  not r["failures"], ("max %d questions, avg %s, %.1fs" % (r["maxQ"], r["avg"], time.time() - t0)) if not r["failures"] else str(r["failures"][:3]))
        if label.startswith("mind_reader_standalone") and max_ == 100:
            break
    ctx3.close()


def main():
    started = time.time()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        version = browser.version
        all_logs = []
        for label, path in TARGETS:
            run_target(browser, label, path, all_logs)

        section("Network and console, across every page/session above")
        reqs = [u for lg in all_logs for u in lg["requests"]]
        non_file = [u for u in reqs if not u.startswith("file://")]
        check("every request made by the game was a local file:// request (%d requests seen, 0 remote)" % len(reqs), not non_file, str(non_file[:3]))
        cons = [c for lg in all_logs for c in lg["console"]] + [e for lg in all_logs for e in lg["errors"]]
        check("zero console errors/warnings and zero uncaught exceptions in all sessions", not cons, str(cons[:3]))

        section("Offline mode (browser context forced offline)")
        ctx = browser.new_context()
        ctx.set_offline(True)
        page = ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        page.goto("file://" + TARGETS[0][1])
        start_round(page, "50", "predictable")
        play_to_guess(page, 50, 33)
        page.click("#correctBtn")
        check("a full round works with the network switched off", visible(page, "#solvedBox") and "33" in page.inner_text("#solvedText") and not errs, str(errs))
        ctx.close()
        browser.close()

    failed = [r for r in results if not r[2]]
    elapsed = time.time() - started
    print("\n" + "=" * 60)
    print("%d passed, %d failed, %d checks in %.1f s (Chromium %s)" % (len(results) - len(failed), len(failed), len(results), elapsed, version))
    for g, n, ok, d in failed:
        print(" - [%s] %s %s" % (g, n, d))

    if WRITE_REPORT:
        lines = ["# Browser test results (generated by `python3 tests/browser-test.py --write-report`)", "",
                 "- Run on: " + datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                 "- Browser: Chromium " + version + " (headless, Playwright " + __import__("importlib.metadata").metadata.version("playwright") + ") opened from `file://`",
                 "- Duration: %.1f s" % elapsed,
                 "- **Result: %d passed, %d failed (%d checks)**" % (len(results) - len(failed), len(failed), len(results)), "",
                 "This file is written by the test runner itself; it is not edited by hand."]
        cur = None
        for g, n, ok, d in results:
            if g != cur:
                cur = g
                lines += ["", "## " + g, ""]
            lines.append("- %s %s%s" % ("✅" if ok else "❌", n, (" — _" + str(d) + "_") if d else ""))
        with open(os.path.join(HERE, "BROWSER_RESULTS.md"), "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        print("Wrote tests/BROWSER_RESULTS.md")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
