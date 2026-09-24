// Unit tests for the exact arithmetic engine. Run with: node tests/engine.test.js
'use strict';
const assert = require('node:assert/strict');
const E = require('../js/engine.js');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}\n    ${e.message}`); }
}

const val = (src, ctx) => E.evaluate(src, ctx).value;
const eq = (src, expected, ctx) => {
  const v = val(src, ctx);
  assert.ok(E.isExact(v), `${src} should be exact`);
  assert.equal(v.toString(), expected, `${src}`);
};
const approx = (src, expected, eps = 1e-12) => {
  const v = val(src);
  assert.ok(!E.isExact(v), `${src} should be approximate`);
  assert.ok(Math.abs(v.x - expected) < eps, `${src}: ${v.x} vs ${expected}`);
};
const throws = (src, pattern, ctx) => assert.throws(() => E.evaluate(src, ctx), pattern);

test('floating-point pitfalls are exact', () => {
  eq('0.1 + 0.2', '3/10');
  eq('0.3 - 0.1', '1/5');
  eq('1.1 * 1.1', '121/100');
  eq('(1/3) * 3', '1');
});

test('operator precedence and associativity', () => {
  eq('2 + 3 * 4', '14');
  eq('(2 + 3) * 4', '20');
  eq('10 - 4 - 3', '3');
  eq('64 / 4 / 2', '8');
  eq('2 ^ 3 ^ 2', '512');
  eq('-2 ^ 2', '-4');
  eq('(-2) ^ 2', '4');
  eq('2 ^ -2', '1/4');
});

test('unicode operators and implicit multiplication', () => {
  eq('6 × 7', '42');
  eq('7 ÷ 2', '7/2');
  eq('5 − 8', '-3');
  eq('2(3 + 4)', '14');
  eq('(1 + 1)(2 + 2)', '8');
  eq('3!2', '12');
});

test('auto-closing parentheses', () => {
  const r = E.evaluate('2 * (3 + (4');
  assert.equal(r.value.toString(), '14');
  assert.equal(r.autoClosed, 2);
});

test('roots are exact where possible', () => {
  eq('√16', '4');
  eq('√(9/4)', '3/2');
  eq('8 ^ (1/3)', '2');
  eq('(-27) ^ (1/3)', '-3');
  eq('16 ^ 0.75', '8');
  approx('√2', Math.SQRT2);
  approx('2 ^ 0.5', Math.SQRT2);
});

test('factorial and percent', () => {
  eq('0!', '1');
  eq('5!', '120');
  eq('3!!', '720');
  eq('25!', '15511210043330985984000000');
  eq('50%', '1/2');
  eq('200 * 15%', '30');
});

test('ans substitution', () => {
  const ans = E.Rational.of(7, 2);
  eq('ans * 2', '7', { ans });
  eq('2ans', '7', { ans });
  throws('ans + 1', /empty/);
});

test('math errors', () => {
  throws('1 / 0', /Division by zero/);
  throws('0 ^ -1', /Division by zero/);
  throws('√(-4)', /not real/);
  throws('(-4) ^ 0.5', /not real/);
  throws('2.5!', /non-negative integers/);
  throws('(-1)!', /non-negative integers/);
  throws('2 ^ 10000000', /too large/);
});

test('syntax errors report a position', () => {
  const at = (src) => { try { E.evaluate(src); } catch (e) { return [e.kind, e.pos]; } return null; };
  assert.deepEqual(at('2 + * 3'), ['syntax', 4]);
  assert.deepEqual(at('(1 + 2))'), ['syntax', 7]);
  assert.deepEqual(at('1..2'), ['syntax', 2]);
  assert.deepEqual(at('()'), ['syntax', 1]);
  assert.deepEqual(at('4 +'), ['incomplete', 3]);
  assert.deepEqual(at('2 $ 3'), ['syntax', 2]);
});

test('recurring decimal detection', () => {
  const exp = (n, d) => E.decimalExpansion(E.Rational.of(n, d));
  assert.deepEqual(exp(1, 3), { sign: 1, int: '0', nonrep: '', rep: '3', truncated: false });
  assert.deepEqual(exp(1, 6), { sign: 1, int: '0', nonrep: '1', rep: '6', truncated: false });
  assert.deepEqual(exp(1, 7), { sign: 1, int: '0', nonrep: '', rep: '142857', truncated: false });
  assert.deepEqual(exp(-5, 4), { sign: -1, int: '1', nonrep: '25', rep: '', truncated: false });
  assert.equal(exp(1, 97).rep.length, 96);
});

test('step trace follows precedence', () => {
  const steps = E.evaluate('2 + 3 × 4 - 1').steps.map((s) => s.text);
  assert.deepEqual(steps, ['2 + 3 × 4 − 1', '2 + 12 − 1', '14 − 1', '13']);
  const html = E.evaluate('2 + 3 × 4').steps[1].html;
  assert.match(html, /<mark>12<\/mark>/);
});

test('conversions', () => {
  assert.deepEqual(E.toBases(E.Rational.of(255)), { bin: '11111111', oct: '377', dec: '255', hex: 'FF' });
  assert.equal(E.toBases(E.Rational.of(1, 2)), null);
  const m = E.toMixed(E.Rational.of(-7, 3));
  assert.deepEqual([m.sign, m.whole, m.num, m.den], [-1, 2n, 1n, 3n]);
  assert.equal(E.toPlain(E.Rational.of(2, 3), 5), '0.66666');
  assert.equal(E.toPlain(E.Rational.of(1, 8)), '0.125');
});

test('serialisation round-trip', () => {
  const r = E.Rational.of(-22, 7);
  assert.ok(E.deserialize(E.serialize(r)).equals(r));
  assert.equal(E.deserialize(E.serialize(new E.Approx(1.5))).x, 1.5);
});

test('large values stay exact and convert to doubles safely', () => {
  const v = val('100!');
  assert.equal(v.n.toString().length, 158);
  assert.ok(Math.abs(v.toNumber() / 9.33262154439441e157 - 1) < 1e-12);
  assert.ok(Math.abs(val('1 / 3 ^ 700').toNumber()) < 1e-300);
});

test('scientific notation uses exact digits', () => {
  const p = E.sciParts(E.evaluate('3 ^ 700').value, 6);
  assert.deepEqual(p, { neg: false, mant: '9.6578', exp: 333 });
  assert.deepEqual(E.sciParts(E.Rational.of(-1, 3000), 4), { neg: true, mant: '3.333', exp: -4 });
  assert.deepEqual(E.sciParts(E.Rational.of(99999995, 1), 6), { neg: false, mant: '1', exp: 8 });
});

console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  failures.forEach((f) => console.error('  FAIL ' + f));
  process.exit(1);
}
