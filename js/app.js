/*
 * UI controller for the Exact calculator.
 * All arithmetic is delegated to js/engine.js; this file only handles input, rendering and state.
 */
(() => {
  'use strict';

  const E = window.Engine;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  const el = {
    expr: $('#expr'), result: $('#result'), status: $('#status'), display: $('#display'),
    copyBtn: $('#copyBtn'), views: $$('.view'), keypad: $('#keypad'),
    steps: $('#steps'), stepsEmpty: $('#stepsEmpty'),
    history: $('#history'), historyEmpty: $('#historyEmpty'), histCount: $('#histCount'),
    clearHistory: $('#clearHistory'), toast: $('#toast'), helpDialog: $('#helpDialog'),
  };

  /* ------------------------------------------------------------- storage */

  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
      catch (e) { return fallback; }
    },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ } },
  };

  function safeDeserialize(o) { try { return E.deserialize(o); } catch (e) { return null; } }

  const MAX_HISTORY = 50;
  const BINARY_OPS = ['+', '×', '÷', '^', '!', '%'];

  const state = {
    value: null,          // value currently shown
    final: false,         // true after "=", false for live preview
    view: 'dec',
    justEvaluated: false,
    ans: safeDeserialize(store.get('exact.ans', null)),
    history: (store.get('exact.history', []) || []).filter((h) => h && h.expr && h.value),
    histIndex: -1,
    draft: '',
    note: '',             // extra status text, e.g. auto-closed parentheses
  };

  /* ---------------------------------------------------------- formatting */

  const MINUS = '−';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sign = (neg) => (neg ? MINUS : '');
  const babs = (x) => (x < 0n ? -x : x);

  function formatApprox(x) {
    const a = Math.abs(x);
    if (a !== 0 && (a >= 1e15 || a < 1e-9)) {
      const [m, e] = x.toExponential(11).split('e');
      return `${m.replace(/\.?0+$/, '').replace('-', MINUS)} × 10<sup>${e.replace('+', '').replace('-', MINUS)}</sup>`;
    }
    const s = String(+x.toPrecision(14));
    const [ip, fp] = s.replace('-', '').split('.');
    return sign(x < 0) + E.groupDigits(ip) + (fp ? '.' + fp : '');
  }

  function sciHtml(v) {
    const p = E.sciParts(v, 10);
    return `${sign(p.neg)}${p.mant} × 10<sup>${String(p.exp).replace('-', MINUS)}</sup>`;
  }

  /** Classify the current value; drives the status line. */
  function describe(v) {
    if (!E.isExact(v)) return { kind: 'approx', label: 'Approximate · irrational result' };
    if (v.isInt()) {
      const digits = babs(v.n).toString().length;
      return { kind: 'int', digits, label: digits > 12 ? `Exact integer · ${digits.toLocaleString()} digits` : 'Exact integer' };
    }
    const d = E.decimalExpansion(v, 400);
    if (d.truncated) return { kind: 'rep', exp: d, label: 'Exact · recurring, period over 400 digits' };
    if (d.rep) return { kind: 'rep', exp: d, label: `Exact · recurring decimal, period ${d.rep.length}` };
    return { kind: 'term', exp: d, label: 'Exact · terminating decimal' };
  }

  function decimalHtml(v, info) {
    if (info.kind === 'approx') return '<span class="approx">≈</span>' + formatApprox(v.x);
    if (info.kind === 'int') {
      if (info.digits > 60) return sciHtml(v);
      return sign(v.n < 0n) + E.groupDigits(babs(v.n).toString());
    }
    const d = info.exp;
    if (d.int.length > 20) return sciHtml(v);
    if (d.int === '0' && /^0{9,}/.test(d.nonrep)) return sciHtml(v);
    let frac;
    if (d.truncated) frac = d.nonrep.slice(0, 40) + '<span class="ellipsis">…</span>';
    else if (d.rep) {
      const nonrep = d.nonrep.length > 30 ? d.nonrep.slice(0, 30) + '…' : d.nonrep;
      const rep = d.rep.length > 30 ? d.rep.slice(0, 30) + '<span class="ellipsis">…</span>' : d.rep;
      frac = nonrep + `<span class="rep" title="Recurring block of ${d.rep.length} digit${d.rep.length > 1 ? 's' : ''}">${rep}</span>`;
    } else {
      frac = d.nonrep.length > 60 ? d.nonrep.slice(0, 60) + '<span class="ellipsis">…</span>' : d.nonrep;
    }
    return sign(d.sign < 0) + E.groupDigits(d.int) + '.' + frac;
  }

  function fracHtml(n, d, neg) {
    return `<span class="frac">${neg ? `<span class="frac-sign">${MINUS}</span>` : ''}` +
      `<span class="frac-body"><span class="frac-num">${n}</span><span class="frac-den">${d}</span></span></span>`;
  }

  function baseHtml(v) {
    const b = E.toBases(v);
    const group = (s, n) => {
      const neg = s.startsWith('-');
      const body = neg ? s.slice(1) : s;
      return (neg ? MINUS : '') + body.replace(new RegExp(`\\B(?=(.{${n}})+$)`, 'g'), ' ');
    };
    const row = (label, prefix, text) => `<div class="base-row"><span class="base-label">${label}</span>` +
      `<span class="base-val"><span class="base-prefix">${prefix}</span>${esc(text)}</span></div>`;
    return `<div class="bases">${row('HEX', '0x', group(b.hex, 4))}${row('DEC', '', group(b.dec, 3))}` +
      `${row('OCT', '0o', group(b.oct, 3))}${row('BIN', '0b', group(b.bin, 4))}</div>`;
  }

  function availableViews(v) {
    if (!v) return { dec: true, frac: false, mixed: false, base: false };
    const exact = E.isExact(v);
    return {
      dec: true,
      frac: exact && !v.isInt(),
      mixed: exact && !v.isInt() && babs(v.n) > v.d,
      base: exact && v.isInt(),
    };
  }

  function copyText(v, view) {
    if (!E.isExact(v)) return String(v.x);
    if (view === 'frac') return v.toString();
    if (view === 'mixed') {
      const m = E.toMixed(v);
      return `${m.sign < 0 ? '-' : ''}${m.whole} ${m.num}/${m.den}`;
    }
    if (view === 'base') {
      const b = E.toBases(v);
      return `HEX 0x${b.hex}\nDEC ${b.dec}\nOCT 0o${b.oct}\nBIN 0b${b.bin}`;
    }
    return E.toPlain(v, 30);
  }

  /* ------------------------------------------------------------ rendering */

  function setResultHtml(html, textLength) {
    el.result.innerHTML = html ? `<span class="result-inner">${html}</span>` : '';
    el.result.classList.remove('size-l', 'size-m', 'size-s', 'size-xs');
    const size = textLength <= 12 ? 'size-l' : textLength <= 18 ? 'size-m' : textLength <= 28 ? 'size-s' : 'size-xs';
    el.result.classList.add(size);
  }

  function renderResult() {
    const v = state.value;
    el.result.classList.toggle('is-final', state.final);
    el.result.classList.toggle('is-preview', !state.final);
    el.result.classList.remove('is-error', 'is-stale', 'is-base');

    const avail = availableViews(v);
    const view = avail[state.view] ? state.view : 'dec';
    el.views.forEach((b) => {
      b.disabled = !avail[b.dataset.view];
      b.setAttribute('aria-selected', String(b.dataset.view === view));
    });

    if (!v) {
      setResultHtml('', 0);
      el.status.textContent = '';
      el.status.className = 'status';
      el.copyBtn.disabled = true;
      return;
    }

    const info = describe(v);
    let html;
    let len;
    if (view === 'frac' || view === 'mixed') {
      const m = E.toMixed(v);
      const whole = view === 'mixed' ? E.groupDigits(m.whole.toString()) : '';
      const num = view === 'mixed' ? m.num : babs(v.n);
      html = `<span class="mixed">${view === 'mixed' ? sign(m.sign < 0) + whole : ''}` +
        `${fracHtml(num.toString(), m.den.toString(), view === 'frac' && m.sign < 0)}</span>`;
      len = whole.length + Math.max(num.toString().length, m.den.toString().length) + 2;
    } else if (view === 'base') {
      html = baseHtml(v);
      len = 0;
    } else {
      html = decimalHtml(v, info);
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      len = tmp.textContent.length;
    }

    setResultHtml((state.final ? '' : '<span class="eq" aria-hidden="true">=</span>') + html, len);
    el.result.classList.toggle('is-base', view === 'base');

    el.status.textContent = info.label + state.note;
    el.status.className = 'status' + (info.kind === 'approx' ? ' is-warn' : '');
    el.copyBtn.disabled = false;
  }

  function renderSteps(steps) {
    if (!steps || steps.length === 0) {
      el.steps.innerHTML = '';
      el.stepsEmpty.hidden = false;
      return;
    }
    el.stepsEmpty.hidden = true;
    let items = steps.map((s, i) => ({ s, i }));
    if (items.length > 60) {
      items = [...items.slice(0, 25), { gap: items.length - 50 }, ...items.slice(-25)];
    }
    const last = steps.length - 1;
    el.steps.innerHTML = items.map(({ s, i, gap }) => {
      if (gap) return `<li class="step step-gap">${gap} intermediate steps not shown</li>`;
      const label = i === 0 ? 'Input' : i === last ? 'Result' : `Step ${i}`;
      const cls = ['step', i === 0 ? 'step-input' : '', i === last && i > 0 ? 'step-final' : ''].join(' ').trim();
      return `<li class="${cls}"><span class="step-label">${label}</span>` +
        `<span class="step-expr">${i > 0 ? '<span class="step-eq">=</span>' : ''}${s.html}</span></li>`;
    }).join('');
  }

  function renderHistory() {
    const h = state.history;
    el.histCount.textContent = h.length ? String(h.length) : '';
    el.historyEmpty.hidden = h.length > 0;
    el.clearHistory.hidden = h.length === 0;
    el.history.innerHTML = h.map((item, i) => `
      <li><button type="button" class="hist-item" data-index="${i}">
        <span class="hist-expr">${esc(item.expr)}</span>
        <span class="hist-res">= ${esc(item.text)}</span>
      </button></li>`).join('');
  }

  function showError(err, final) {
    el.status.textContent = err.message;
    el.status.className = 'status is-error';
    el.copyBtn.disabled = true;
    if (!final) return;
    state.value = null;
    state.final = true;
    el.result.classList.remove('is-preview', 'is-stale', 'is-base');
    el.result.classList.add('is-error', 'is-final');
    setResultHtml(err.kind === 'syntax' ? 'Syntax error' : err.kind === 'incomplete' ? 'Incomplete' : 'Math error', 12);
    el.display.classList.remove('shake');
    void el.display.offsetWidth; // restart the animation
    el.display.classList.add('shake');
    if (err.pos >= 0) {
      el.expr.focus({ preventScroll: true });
      el.expr.setSelectionRange(err.pos, Math.min(err.pos + 1, el.expr.value.length));
    }
  }

  /* ---------------------------------------------------------- evaluation */

  const autoCloseNote = (n) => (n ? ` · ${n} closing parenthes${n === 1 ? 'is' : 'es'} added` : '');

  /** Live preview while typing. */
  function update() {
    state.final = false;
    try {
      const r = E.evaluate(el.expr.value, { ans: state.ans });
      state.note = '';
      if (r.empty) {
        state.value = null;
        renderResult();
        renderSteps(null);
        return;
      }
      state.value = r.value;
      state.note = autoCloseNote(r.autoClosed);
      renderResult();
      renderSteps(r.steps);
    } catch (err) {
      if (!(err instanceof E.CalcError)) throw err;
      if (err.kind === 'incomplete') {
        // Keep the last valid preview, faded, while the expression is being finished.
        el.result.classList.add('is-stale');
        el.status.textContent = 'Waiting for the rest of the expression';
        el.status.className = 'status';
      } else {
        state.value = null;
        renderResult();
        showError(err, false);
      }
    }
  }

  function evaluateFinal() {
    const src = el.expr.value.trim();
    if (!src) return;
    try {
      const r = E.evaluate(src, { ans: state.ans });
      if (r.empty) return;
      state.value = r.value;
      state.final = true;
      state.justEvaluated = true;
      state.ans = r.value;
      state.note = autoCloseNote(r.autoClosed);
      store.set('exact.ans', E.serialize(r.value));
      renderResult();
      renderSteps(r.steps);
      pushHistory(src, r.value);
      el.result.classList.remove('pop');
      void el.result.offsetWidth;
      el.result.classList.add('pop');
    } catch (err) {
      if (!(err instanceof E.CalcError)) throw err;
      showError(err, true);
    }
  }

  function pushHistory(expr, value) {
    const text = E.valueText(value);
    const top = state.history[0];
    if (!(top && top.expr === expr && top.text === text)) {
      state.history.unshift({ expr, text, value: E.serialize(value) });
      state.history.length = Math.min(state.history.length, MAX_HISTORY);
      store.set('exact.history', state.history);
    }
    state.histIndex = -1;
    renderHistory();
  }

  /* --------------------------------------------------------------- input */

  function setExpr(text, caret = text.length) {
    el.expr.value = text;
    el.expr.setSelectionRange(caret, caret);
    if (caret === text.length) el.expr.scrollLeft = el.expr.scrollWidth;
  }

  function insert(text) {
    if (state.justEvaluated) {
      // After "=": an operator continues from the answer, anything else starts afresh.
      state.justEvaluated = false;
      setExpr(BINARY_OPS.includes(text) || text === '−' ? 'ans' : '');
    } else if (el.expr.value.trim() === '' && BINARY_OPS.includes(text) && state.ans) {
      setExpr('ans');
    }
    const value = el.expr.value;
    const s = el.expr.selectionStart ?? value.length;
    const e = el.expr.selectionEnd ?? value.length;
    // Typing ")" in front of an existing ")" steps over it instead of doubling it.
    if (text === ')' && s === e && value[s] === ')') {
      el.expr.setSelectionRange(s + 1, s + 1);
      update();
      return;
    }
    setExpr(value.slice(0, s) + text + value.slice(e), s + text.length);
    state.histIndex = -1;
    update();
  }

  function backspace() {
    state.justEvaluated = false;
    const v = el.expr.value;
    const s = el.expr.selectionStart ?? v.length;
    const e = el.expr.selectionEnd ?? v.length;
    if (s !== e) {
      setExpr(v.slice(0, s) + v.slice(e), s);
    } else if (s > 0) {
      const before = v.slice(0, s).toLowerCase();
      const word = ['sqrt', 'ans'].find((w) => before.endsWith(w));
      const cut = word ? word.length : 1;
      setExpr(v.slice(0, s - cut) + v.slice(s), s - cut);
    }
    update();
  }

  function clearAll() {
    state.justEvaluated = false;
    state.histIndex = -1;
    setExpr('');
    update();
  }

  function recall(direction) {
    const h = state.history;
    if (!h.length) return;
    if (state.histIndex === -1) state.draft = el.expr.value;
    const next = Math.max(-1, Math.min(h.length - 1, state.histIndex + direction));
    if (next === state.histIndex) return;
    state.histIndex = next;
    state.justEvaluated = false;
    setExpr(next === -1 ? state.draft : h[next].expr);
    update();
  }

  function cycleView() {
    const avail = availableViews(state.value);
    const order = ['dec', 'frac', 'mixed', 'base'].filter((v) => avail[v]);
    const i = order.indexOf(state.view);
    state.view = order[(i + 1) % order.length] || 'dec';
    renderResult();
  }

  async function copyResult() {
    if (!state.value) return;
    const avail = availableViews(state.value);
    const text = copyText(state.value, avail[state.view] ? state.view : 'dec');
    try {
      await navigator.clipboard.writeText(text);
      const oneLine = text.split('\n')[0];
      toast(`Copied ${oneLine.length > 32 ? oneLine.slice(0, 32) + '…' : oneLine}`);
    } catch (e) {
      toast('Clipboard is not available in this browser');
    }
  }

  let toastTimer;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 1800);
  }

  function flashKey(sel) {
    const key = el.keypad.querySelector(sel);
    if (!key) return;
    key.classList.add('pressed');
    setTimeout(() => key.classList.remove('pressed'), 120);
  }

  // Only auto-focus on devices with a real pointer, so touch screens keep the page steady.
  const focusInput = () => {
    if (window.matchMedia('(hover: hover)').matches) el.expr.focus({ preventScroll: true });
  };

  /* -------------------------------------------------------------- events */

  el.keypad.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.insert) insert(btn.dataset.insert);
    else if (btn.dataset.action === 'eval') evaluateFinal();
    else if (btn.dataset.action === 'back') backspace();
    else if (btn.dataset.action === 'clear') clearAll();
    focusInput();
  });

  // Clicking a key must not steal focus, so the caret position in the input is preserved.
  el.keypad.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });

  const KEYMAP = {
    '*': '×', 'x': '×', '/': '÷', '-': '−', '+': '+', '^': '^', '!': '!', '%': '%',
    '(': '(', ')': ')', '.': '.', 'r': '√', 'a': 'ans',
  };

  document.addEventListener('keydown', (e) => {
    if (el.helpDialog.open) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    const inField = e.target === el.expr || e.target === document.body;
    if (!inField && (k === 'Enter' || k === ' ')) return; // let buttons and tabs activate normally

    let handled = true;
    if (/^[0-9]$/.test(k)) { insert(k); flashKey(`[data-insert="${k}"]`); }
    else if (KEYMAP[k] !== undefined) { insert(KEYMAP[k]); flashKey(`[data-insert="${KEYMAP[k]}"]`); }
    else if (k === 'Enter' || k === '=') { evaluateFinal(); flashKey('[data-action="eval"]'); }
    else if (k === 'Backspace') { backspace(); flashKey('[data-action="back"]'); }
    else if (k === 'Escape') { clearAll(); flashKey('[data-action="clear"]'); }
    else if (k === 'ArrowUp') recall(1);
    else if (k === 'ArrowDown') recall(-1);
    else if (k === 'f') cycleView();
    else if (k === 'c') copyResult();
    else if (k === '?') openHelp();
    else if (k.length === 1 && e.target === el.expr) { /* ignore other characters */ }
    else handled = false;

    if (handled) {
      e.preventDefault();
      if (e.target !== el.expr) focusInput();
    }
  });

  // Pasted text: normalise ASCII operators to their display glyphs.
  el.expr.addEventListener('input', () => {
    const pos = el.expr.selectionStart;
    const norm = el.expr.value.replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−');
    if (norm !== el.expr.value) { el.expr.value = norm; el.expr.setSelectionRange(pos, pos); }
    state.justEvaluated = false;
    update();
  });

  el.views.forEach((b) => b.addEventListener('click', () => {
    state.view = b.dataset.view;
    renderResult();
  }));

  el.copyBtn.addEventListener('click', copyResult);

  $$('.tab').forEach((tab) => tab.addEventListener('click', () => {
    $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    $('#stepsPane').hidden = tab.dataset.tab !== 'steps';
    $('#historyPane').hidden = tab.dataset.tab !== 'history';
  }));

  $$('[data-example]').forEach((b) => b.addEventListener('click', () => {
    state.justEvaluated = false;
    setExpr(b.dataset.example);
    update();
    focusInput();
  }));

  el.history.addEventListener('click', (e) => {
    const btn = e.target.closest('.hist-item');
    if (!btn) return;
    const item = state.history[+btn.dataset.index];
    state.justEvaluated = false;
    state.histIndex = -1;
    setExpr(item.expr);
    update();
    focusInput();
  });

  el.clearHistory.addEventListener('click', () => {
    state.history = [];
    store.set('exact.history', []);
    renderHistory();
    toast('History cleared');
  });

  /* ------------------------------------------------------- theme & help */

  function currentTheme() {
    const set = document.documentElement.dataset.theme;
    if (set) return set;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  $('#themeBtn').addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('exact.theme', next); } catch (e) { /* ignore */ }
  });

  function openHelp() {
    if (typeof el.helpDialog.showModal === 'function') el.helpDialog.showModal();
  }
  $('#helpBtn').addEventListener('click', openHelp);
  el.helpDialog.addEventListener('click', (e) => {
    if (e.target === el.helpDialog || e.target.closest('[data-close]')) el.helpDialog.close();
  });
  el.helpDialog.addEventListener('close', focusInput);

  /* ---------------------------------------------------------------- init */

  renderHistory();
  renderResult();
  renderSteps(null);
  focusInput();
})();
