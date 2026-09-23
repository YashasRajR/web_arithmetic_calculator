/*
 * Exact arithmetic engine
 * -----------------------
 * - Numbers are stored as reduced fractions of BigInts, so 0.1 + 0.2 is exactly 3/10.
 * - Expressions are tokenized and parsed with a recursive-descent parser (no eval).
 * - Evaluation is performed one reduction at a time, which gives a step-by-step trace.
 * - Irrational results (e.g. sqrt 2) fall back to IEEE-754 doubles and are flagged as approximate.
 *
 * Works in the browser (window.Engine) and in Node (module.exports) for unit tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ errors */

  class CalcError extends Error {
    constructor(message, pos = -1, kind = 'math') {
      super(message);
      this.name = 'CalcError';
      this.pos = pos;       // character index in the source, -1 if not applicable
      this.kind = kind;     // 'syntax' | 'incomplete' | 'math'
    }
  }

  /* ---------------------------------------------------------------- rational */

  const babs = (x) => (x < 0n ? -x : x);
  function gcd(a, b) {
    a = babs(a); b = babs(b);
    while (b) { const t = a % b; a = b; b = t; }
    return a;
  }
  const bitLength = (x) => (x === 0n ? 0 : babs(x).toString(2).length);

  class Rational {
    constructor(n, d = 1n) {
      if (d === 0n) throw new CalcError('Division by zero');
      if (d < 0n) { n = -n; d = -d; }
      const g = gcd(n, d) || 1n;
      this.n = n / g;
      this.d = d / g;
    }

    static fromDecimal(text) {
      const [ip, fp = ''] = text.split('.');
      const digits = (ip || '0') + fp;
      return new Rational(BigInt(digits), 10n ** BigInt(fp.length));
    }

    static of(n, d = 1) { return new Rational(BigInt(n), BigInt(d)); }

    add(o) { return new Rational(this.n * o.d + o.n * this.d, this.d * o.d); }
    sub(o) { return new Rational(this.n * o.d - o.n * this.d, this.d * o.d); }
    mul(o) { return new Rational(this.n * o.n, this.d * o.d); }
    div(o) {
      if (o.n === 0n) throw new CalcError('Division by zero');
      return new Rational(this.n * o.d, this.d * o.n);
    }
    neg() { return new Rational(-this.n, this.d); }
    isInt() { return this.d === 1n; }
    isZero() { return this.n === 0n; }
    sign() { return this.n === 0n ? 0 : this.n < 0n ? -1 : 1; }
    equals(o) { return o instanceof Rational && this.n === o.n && this.d === o.d; }

    /** Nearest double, safe for numerators/denominators far beyond 2^1024. */
    toNumber() {
      const a = babs(this.n).toString().length;
      const b = this.d.toString().length;
      const shift = 20 - (a - b);
      const scaled = shift >= 0 ? (this.n * 10n ** BigInt(shift)) / this.d
                                : this.n / (this.d * 10n ** BigInt(-shift));
      return parseFloat(scaled.toString() + 'e' + (-shift));
    }

    toString() { return this.isInt() ? this.n.toString() : `${this.n}/${this.d}`; }
  }

  /** Approximate (irrational or overflowed) value. */
  class Approx {
    constructor(x) {
      if (Number.isNaN(x)) throw new CalcError('Result is undefined');
      if (!Number.isFinite(x)) throw new CalcError('Result is too large');
      this.x = x;
    }
    toNumber() { return this.x; }
  }

  const isExact = (v) => v instanceof Rational;
  const num = (v) => v.toNumber();

  /* ----------------------------------------------------------- integer roots */

  function iroot(x, k) { // floor(x^(1/k)) for x >= 0n, k >= 1n
    if (x < 2n) return x;
    let r = 1n << BigInt(Math.ceil(bitLength(x) / Number(k)));
    for (;;) {
      const y = ((k - 1n) * r + x / r ** (k - 1n)) / k;
      if (y >= r) return r;
      r = y;
    }
  }

  function exactRoot(x, k) { // exact k-th root of a non-negative BigInt, or null
    const r = iroot(x, k);
    return r ** k === x ? r : null;
  }

  /* -------------------------------------------------------------- operations */

  const MAX_BITS = 200000;      // ~60,000 decimal digits
  const MAX_FACTORIAL = 3000;

  function powRational(a, e) { // a: Rational, e: BigInt
    if (a.isZero()) {
      if (e < 0n) throw new CalcError('Division by zero (0 raised to a negative power)');
      return e === 0n ? Rational.of(1) : Rational.of(0);
    }
    const mag = e < 0n ? -e : e;
    if ((a.n === 1n || a.n === -1n) && a.d === 1n) {
      return new Rational(a.n === -1n && mag % 2n === 1n ? -1n : 1n);
    }
    const bits = Math.max(bitLength(a.n), bitLength(a.d));
    if (bits * Number(mag) > MAX_BITS) throw new CalcError('Result is too large to compute exactly');
    const n = a.n ** mag, d = a.d ** mag;
    return e < 0n ? new Rational(d, n) : new Rational(n, d);
  }

  function power(a, b) {
    if (isExact(a) && isExact(b)) {
      if (b.isInt()) return powRational(a, b.n);
      // b = p/q with q > 1: try for an exact rational root first
      const q = b.d;
      if (a.sign() < 0 && q % 2n === 0n) throw new CalcError('Even root of a negative number is not real');
      if (q <= 64n) {
        const rn = exactRoot(babs(a.n), q);
        const rd = rn === null ? null : exactRoot(a.d, q);
        if (rn !== null && rd !== null) {
          const root = new Rational(a.sign() < 0 ? -rn : rn, rd);
          return powRational(root, b.n);
        }
      }
    }
    const x = num(a), y = num(b);
    if (x < 0 && isExact(b) && b.d % 2n === 1n) { // odd root of a negative number
      const r = Math.pow(-x, y);
      return new Approx(b.n % 2n === 0n ? r : -r);
    }
    if (x < 0 && !Number.isInteger(y)) throw new CalcError('Result is not a real number');
    return new Approx(Math.pow(x, y));
  }

  function sqrt(a) {
    if (num(a) < 0 || (isExact(a) && a.sign() < 0)) {
      throw new CalcError('Square root of a negative number is not real');
    }
    return power(a, Rational.of(1, 2));
  }

  function factorial(a) {
    if (!isExact(a) || !a.isInt() || a.n < 0n) {
      throw new CalcError('Factorial is defined for non-negative integers only');
    }
    if (a.n > BigInt(MAX_FACTORIAL)) throw new CalcError(`Factorial is limited to ${MAX_FACTORIAL}!`);
    let r = 1n;
    for (let i = 2n; i <= a.n; i++) r *= i;
    return new Rational(r);
  }

  function binary(op, a, b) {
    if (op === '^') return power(a, b);
    if (isExact(a) && isExact(b)) {
      switch (op) {
        case '+': return a.add(b);
        case '-': return a.sub(b);
        case '*': return a.mul(b);
        case '/': return a.div(b);
      }
    }
    const x = num(a), y = num(b);
    switch (op) {
      case '+': return new Approx(x + y);
      case '-': return new Approx(x - y);
      case '*': return new Approx(x * y);
      case '/':
        if (y === 0) throw new CalcError('Division by zero');
        return new Approx(x / y);
    }
    throw new CalcError(`Unknown operator ${op}`);
  }

  function unary(type, op, a) {
    if (type === 'neg') return isExact(a) ? a.neg() : new Approx(-a.x);
    if (type === 'sqrt') return sqrt(a);
    if (op === '!') return factorial(a);
    if (op === '%') return isExact(a) ? a.div(Rational.of(100)) : new Approx(a.x / 100);
    throw new CalcError(`Unknown operator ${op}`);
  }

  /* --------------------------------------------------------------- tokenizer */

  const SYMBOLS = {
    '+': '+', '-': '-', '−': '-', '*': '*', '×': '*', '·': '*',
    '/': '/', '÷': '/', '^': '^', '!': '!', '%': '%',
    '(': '(', ')': ')', '√': 'sqrt',
  };

  function tokenize(src) {
    const tokens = [];
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (/[0-9.]/.test(c)) {
        let j = i;
        while (j < src.length && /[0-9]/.test(src[j])) j++;
        if (src[j] === '.') {
          j++;
          while (j < src.length && /[0-9]/.test(src[j])) j++;
        }
        const text = src.slice(i, j);
        if (text === '.') throw new CalcError('A lone decimal point is not a number', i, 'syntax');
        if (src[j] === '.') throw new CalcError('A number cannot have two decimal points', j, 'syntax');
        tokens.push({ t: 'num', text, pos: i });
        i = j;
        continue;
      }
      if (/[a-z]/i.test(c)) {
        let j = i;
        while (j < src.length && /[a-z]/i.test(src[j])) j++;
        const word = src.slice(i, j).toLowerCase();
        if (word === 'ans') tokens.push({ t: 'ans', pos: i });
        else if (word === 'sqrt') tokens.push({ t: 'sqrt', pos: i });
        else throw new CalcError(`Unknown name "${src.slice(i, j)}"`, i, 'syntax');
        i = j;
        continue;
      }
      if (SYMBOLS[c]) { tokens.push({ t: SYMBOLS[c], pos: i }); i++; continue; }
      throw new CalcError(`Unexpected character "${c}"`, i, 'syntax');
    }
    return tokens;
  }

  /* ------------------------------------------------------------------ parser */
  /*
   *  expr    := term (('+' | '-') term)*
   *  term    := unary (('*' | '/') unary | implicit-multiply unary)*
   *  unary   := ('-' | '+' | 'sqrt') unary | power
   *  power   := postfix ('^' unary)?            right-associative, -2^2 = -(2^2)
   *  postfix := primary ('!' | '%')*
   *  primary := number | 'ans' | '(' expr ')'   a missing ')' at the end is auto-closed
   */

  function parse(src, ctx = {}) {
    const tokens = tokenize(src);
    if (tokens.length === 0) return { ast: null, autoClosed: 0 };
    let p = 0;
    let autoClosed = 0;
    const peek = () => tokens[p];
    const end = src.length;

    const describe = (tok) => ({ '*': '×', '/': '÷', '-': '−', sqrt: '√', num: tok.text, ans: 'ans' }[tok.t] || tok.t);

    function expr() {
      let node = term();
      while (peek() && (peek().t === '+' || peek().t === '-')) {
        const op = tokens[p++].t;
        node = { type: 'bin', op, left: node, right: term() };
      }
      return node;
    }

    function term() {
      let node = unaryExpr();
      for (;;) {
        const t = peek();
        if (!t) break;
        if (t.t === '*' || t.t === '/') {
          p++;
          node = { type: 'bin', op: t.t, left: node, right: unaryExpr() };
        } else if (t.t === '(' || t.t === 'ans' || t.t === 'sqrt' ||
                   (t.t === 'num' && [')', '!', '%', 'ans'].includes(tokens[p - 1].t))) {
          node = { type: 'bin', op: '*', implicit: true, left: node, right: unaryExpr() };
        } else break;
      }
      return node;
    }

    function unaryExpr() {
      const t = peek();
      if (t && t.t === '-') { p++; return { type: 'neg', arg: unaryExpr() }; }
      if (t && t.t === '+') { p++; return unaryExpr(); }
      if (t && t.t === 'sqrt') { p++; return { type: 'sqrt', arg: unaryExpr() }; }
      return powerExpr();
    }

    function powerExpr() {
      const base = postfix();
      if (peek() && peek().t === '^') {
        p++;
        return { type: 'bin', op: '^', left: base, right: unaryExpr() };
      }
      return base;
    }

    function postfix() {
      let node = primary();
      while (peek() && (peek().t === '!' || peek().t === '%')) {
        node = { type: 'post', op: tokens[p++].t, arg: node };
      }
      return node;
    }

    function primary() {
      const t = tokens[p++];
      if (!t) throw new CalcError('Expression is incomplete', end, 'incomplete');
      if (t.t === 'num') return { type: 'num', value: Rational.fromDecimal(t.text) };
      if (t.t === 'ans') {
        if (!ctx.ans) throw new CalcError('"ans" is empty until you evaluate something', t.pos);
        return { type: 'num', value: ctx.ans, label: 'ans' };
      }
      if (t.t === '(') {
        if (peek() && peek().t === ')') throw new CalcError('Empty parentheses', peek().pos, 'syntax');
        const inner = expr();
        if (peek() && peek().t === ')') p++;
        else if (!peek()) autoClosed++;
        else throw new CalcError(`Expected ")" before "${describe(peek())}"`, peek().pos, 'syntax');
        return { type: 'group', arg: inner };
      }
      if (t.t === ')') throw new CalcError('Unmatched ")"', t.pos, 'syntax');
      throw new CalcError(`Unexpected "${describe(t)}"`, t.pos, 'syntax');
    }

    const ast = expr();
    if (p < tokens.length) {
      const t = tokens[p];
      if (t.t === ')') throw new CalcError('Unmatched ")"', t.pos, 'syntax');
      throw new CalcError(`Unexpected "${describe(t)}"`, t.pos, 'syntax');
    }
    return { ast, autoClosed };
  }

  /* --------------------------------------------------- step-wise evaluation */

  function simplify(node) { // drop parentheses that wrap a bare number
    switch (node.type) {
      case 'num': return node;
      case 'group': {
        const arg = simplify(node.arg);
        return arg.type === 'num' ? arg : { ...node, arg };
      }
      case 'bin': return { ...node, left: simplify(node.left), right: simplify(node.right) };
      default: return { ...node, arg: simplify(node.arg) };
    }
  }

  /** Reduce the left-most innermost operation. Returns { node, produced } or null. */
  function reduceOnce(node) {
    switch (node.type) {
      case 'num': return null;
      case 'group': {
        const r = reduceOnce(node.arg);
        return r && { node: { ...node, arg: r.node }, produced: r.produced };
      }
      case 'bin': {
        if (node.left.type !== 'num') {
          const r = reduceOnce(node.left);
          return r && { node: { ...node, left: r.node }, produced: r.produced };
        }
        if (node.right.type !== 'num') {
          const r = reduceOnce(node.right);
          return r && { node: { ...node, right: r.node }, produced: r.produced };
        }
        const produced = { type: 'num', value: binary(node.op, node.left.value, node.right.value) };
        return { node: produced, produced };
      }
      default: {
        if (node.arg.type !== 'num') {
          const r = reduceOnce(node.arg);
          return r && { node: { ...node, arg: r.node }, produced: r.produced };
        }
        const produced = { type: 'num', value: unary(node.type, node.op, node.arg.value) };
        return { node: produced, produced };
      }
    }
  }

  /* --------------------------------------------------------------- rendering */

  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const MINUS = '−';
  const OPS = { '+': ' + ', '-': ` ${MINUS} `, '*': ' × ', '/': ' ÷ ', '^': '^' };
  const PREC = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 4 };

  function groupDigits(s) { return s.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  /**
   * Scientific notation parts { neg, mant, exp } computed from the exact value,
   * so magnitudes beyond the double range (e.g. 3^700) are handled correctly.
   */
  function sciParts(v, sig = 6) {
    if (!isExact(v)) {
      const [m, e] = v.x.toExponential(sig - 1).split('e');
      return { neg: v.x < 0, mant: m.replace('-', '').replace(/\.?0+$/, ''), exp: parseInt(e, 10) };
    }
    if (v.isZero()) return { neg: false, mant: '0', exp: 0 };
    const n = babs(v.n), d = v.d;
    let exp = n.toString().length - d.toString().length;
    // scale so that the quotient has exactly `sig` digits (rounded half up)
    const q = (k) => {
      const shift = sig - 1 - k;
      const num = shift >= 0 ? n * 10n ** BigInt(shift) : n;
      const den = shift >= 0 ? d : d * 10n ** BigInt(-shift);
      return (2n * num + den) / (2n * den);
    };
    let digits = q(exp).toString();
    if (digits.length < sig) { exp -= 1; digits = q(exp).toString(); }
    if (digits.length > sig) { exp += 1; digits = q(exp).toString(); }
    const mant = (digits[0] + '.' + digits.slice(1)).replace(/\.?0+$/, '');
    return { neg: v.n < 0n, mant, exp };
  }

  function sci(v, sig = 6) {
    const p = sciParts(v, sig);
    return `${p.neg ? MINUS : ''}${p.mant}×10^${String(p.exp).replace('-', MINUS)}`;
  }

  /** Short textual form of a value for use inside step expressions. */
  function valueText(v) {
    if (!isExact(v)) {
      const x = v.x;
      const s = Math.abs(x) >= 1e12 || (x !== 0 && Math.abs(x) < 1e-6) ? sci(v) : String(+x.toPrecision(10));
      return '≈' + s.replace('-', MINUS);
    }
    const neg = v.n < 0n;
    const sign = neg ? MINUS : '';
    const n = babs(v.n);
    if (v.isInt()) {
      const s = n.toString();
      return s.length > 15 ? sci(v).replace('-', MINUS) : sign + s;
    }
    const dec = decimalExpansion(v, 12);
    if (!dec.rep && !dec.truncated && dec.int.length <= 12) return sign + dec.int + '.' + dec.nonrep;
    const ns = n.toString(), ds = v.d.toString();
    if (ns.length + ds.length > 24) return '≈' + sci(v);
    return `${sign}${ns}/${ds}`;
  }

  function valuePrec(v) {
    const t = valueText(v);
    if (t.startsWith(MINUS) || t.startsWith('≈')) return 3;
    if (t.includes('/')) return 2;
    if (t.includes('×')) return 2;
    return 6;
  }

  /** Render an AST to HTML with minimal parentheses; `mark` is highlighted. */
  function render(node, mark, html = true) {
    const wrap = (s) => `(${s})`;
    function go(n) { // returns [string, precedence]
      let out, prec;
      switch (n.type) {
        case 'num':
          out = html ? esc(valueText(n.value)) : valueText(n.value);
          prec = valuePrec(n.value);
          break;
        case 'group':
          out = wrap(go(n.arg)[0]); prec = 6;
          break;
        case 'neg': {
          const [s, cp] = go(n.arg);
          out = MINUS + (cp <= 3 ? wrap(s) : s); prec = 3;
          break;
        }
        case 'sqrt': {
          const [s, cp] = go(n.arg);
          out = '√' + (cp < 5 ? wrap(s) : s); prec = 3;
          break;
        }
        case 'post': {
          const [s, cp] = go(n.arg);
          out = (cp < 6 ? wrap(s) : s) + n.op; prec = 5;
          break;
        }
        case 'bin': {
          const P = PREC[n.op];
          const [ls, lp] = go(n.left);
          const [rs, rp] = go(n.right);
          const l = lp < P || (n.op === '^' && lp <= P) ? wrap(ls) : ls;
          const r = rp < P || (rp === P && n.op !== '+') ? wrap(rs) : rs;
          const sep = n.implicit && n.right.type === 'group' && n.left.type !== 'group' ? '' : OPS[n.op];
          out = l + sep + r; prec = P;
          break;
        }
      }
      if (html && n === mark) out = `<mark>${out}</mark>`;
      return [out, prec];
    }
    return go(node)[0];
  }

  /**
   * Evaluate an expression string.
   * Returns { empty } | { value, steps: [{html, text}], autoClosed }.
   */
  function evaluate(src, ctx = {}) {
    const { ast, autoClosed } = parse(src, ctx);
    if (!ast) return { empty: true };
    const steps = [{ html: render(ast, null), text: render(ast, null, false) }];
    let node = simplify(ast);
    let guard = 0;
    for (;;) {
      const r = reduceOnce(node);
      if (!r) break;
      node = simplify(r.node);
      const text = render(node, null, false);
      if (text !== steps[steps.length - 1].text) steps.push({ html: render(node, r.produced), text });
      if (++guard > 5000) throw new CalcError('Expression is too long');
    }
    return { value: node.value, steps, autoClosed };
  }

  /* -------------------------------------------------------------- formatting */

  /**
   * Exact decimal expansion by long division with remainder tracking.
   * A repeated remainder marks the start of the recurring block.
   */
  function decimalExpansion(r, limit = 400) {
    const n = babs(r.n), d = r.d;
    const int = (n / d).toString();
    let rem = n % d;
    const seen = new Map();
    let digits = '';
    while (rem !== 0n && !seen.has(rem) && digits.length < limit) {
      seen.set(rem, digits.length);
      rem *= 10n;
      digits += (rem / d).toString();
      rem %= d;
    }
    const sign = r.n < 0n ? -1 : 1;
    if (rem === 0n) return { sign, int, nonrep: digits, rep: '', truncated: false };
    if (seen.has(rem)) {
      const at = seen.get(rem);
      return { sign, int, nonrep: digits.slice(0, at), rep: digits.slice(at), truncated: false };
    }
    return { sign, int, nonrep: digits, rep: '', truncated: true };
  }

  function toMixed(r) {
    const n = babs(r.n);
    return { sign: r.n < 0n ? -1 : 1, whole: n / r.d, num: n % r.d, den: r.d };
  }

  function toBases(r) {
    if (!isExact(r) || !r.isInt()) return null;
    const sign = r.n < 0n ? '-' : '';
    const n = babs(r.n);
    return {
      bin: sign + n.toString(2),
      oct: sign + n.toString(8),
      dec: sign + n.toString(10),
      hex: sign + n.toString(16).toUpperCase(),
    };
  }

  /** Plain-text decimal for copying; recurring decimals are expanded to `maxFrac` places. */
  function toPlain(v, maxFrac = 20) {
    if (!isExact(v)) return String(v.x);
    if (v.isInt()) return v.n.toString();
    const e = decimalExpansion(v, maxFrac);
    const sign = e.sign < 0 ? '-' : '';
    if (!e.rep && !e.truncated) return sign + e.int + '.' + e.nonrep;
    let digits = e.nonrep + e.rep;
    while (e.rep && digits.length < maxFrac) digits += e.rep;
    return sign + e.int + '.' + digits.slice(0, maxFrac);
  }

  function serialize(v) {
    return isExact(v) ? { n: v.n.toString(), d: v.d.toString() } : { x: v.x };
  }
  function deserialize(o) {
    if (!o) return null;
    return 'x' in o ? new Approx(o.x) : new Rational(BigInt(o.n), BigInt(o.d));
  }

  return {
    CalcError, Rational, Approx, isExact,
    tokenize, parse, evaluate, render,
    decimalExpansion, toMixed, toBases, toPlain, groupDigits, sci, sciParts, valueText,
    serialize, deserialize,
  };
});
