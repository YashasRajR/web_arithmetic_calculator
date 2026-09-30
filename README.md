# Exact — Rational Arithmetic Calculator

A responsive web calculator built with HTML, CSS and vanilla JavaScript. Most calculators store numbers as binary floating point, so they show `0.1 + 0.2 = 0.30000000000000004`. This one does not. Every number is held as an exact fraction of arbitrary-precision integers (`BigInt`), and the result is only approximated when it is actually irrational.

## Features

**Exact arithmetic**
- Rational numbers are stored as reduced `numerator / denominator` BigInt pairs, so `0.1 + 0.2` is exactly `3/10`.
- Integers of any size are supported (up to ~60,000 digits). For example, `100!` is computed to all 158 digits.
- Roots are exact when possible: `√(9/4) = 3/2`, `8^(1/3) = 2`, `16^0.75 = 8`. When a result is truly irrational, such as `√2`, it falls back to a double-precision value and is marked with `≈`.

**Step-by-step working**
- The expression is reduced one operation at a time, in the order set by operator precedence.
- The value produced at each step is highlighted, which helps when learning or checking BODMAS.

**Recurring decimal detection**
- Long division records every remainder it has seen. The first remainder that repeats marks where the recurring block starts.
- The recurring block is drawn with a vinculum (overline). For example, `1/7` shows `0.142857` with a bar over all six digits, and the status line reports the period.

**Four result formats**
- Decimal, Fraction (stacked), Mixed number, and Base (hexadecimal, decimal, octal and binary, for integer results).

**Real expression parser**
- A hand-written tokenizer and recursive-descent parser. `eval()` is never used.
- Supports `+ − × ÷ ^ ! %`, `√`, parentheses and `ans` (the previous answer).
- Implicit multiplication: `2(3 + 4)` and `(1 + 1)(2 + 2)` work as written.
- Right-associative powers, with `−2^2 = −4` as in standard mathematics.
- Unclosed parentheses at the end are closed automatically, and the status line says how many were added.
- Errors give the exact location. The offending character is selected in the input, and the message says what was expected.

**UX details**
- The result previews live as you type. While an expression is incomplete, the last valid result stays visible, faded.
- Pressing an operator right after `=` continues from the answer, the way a physical calculator does.
- History (last 50 results) is saved in the browser. Select an entry, or press the up and down arrow keys, to recall it.
- Light and dark themes follow the system setting, and a manual toggle is remembered.
- The whole calculator can be driven from the keyboard. Press `?` to see the shortcuts.
- The layout works on phones. There, the input uses `inputmode="none"`, so the on-screen keypad is used instead of the phone's keyboard.
- Keyboard focus is always visible, ARIA roles and live regions are set, and animations respect `prefers-reduced-motion`.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `0`–`9` `.` | Digits and decimal point |
| `+` `-` `*` `/` | Operators |
| `^` `!` `%` | Power, factorial, percent |
| `r` | Square root |
| `a` | Previous answer |
| `Enter` / `=` | Evaluate |
| `Backspace` / `Esc` | Delete / clear |
| `↑` `↓` | Step through history |
| `f` | Cycle result format |
| `c` | Copy result |
| `?` | Show shortcuts |

## How it works

```
input ──► tokenize ──► parse (recursive descent) ──► AST ──► reduce one node at a time ──► value
                                                               │
                                                               └──► rendered after every step (Working panel)
```

Grammar, from lowest to highest precedence:

```
expr    := term (('+' | '-') term)*
term    := unary (('*' | '/') unary | implicit-multiply unary)*
unary   := ('-' | '+' | '√') unary | power
power   := postfix ('^' unary)?
postfix := primary ('!' | '%')*
primary := number | 'ans' | '(' expr ')'
```

Recurring decimals: the remainder `r` at each stage of long division satisfies `0 ≤ r < d`. So after at most `d` digits, some remainder must repeat (pigeonhole principle). The digits between its two occurrences form the recurring block.

## Project structure

```
index.html            markup and layout
css/styles.css        design tokens, light/dark themes, responsive layout
js/engine.js          rational numbers, tokenizer, parser, step evaluator, formatting (UI-independent)
js/app.js             UI controller: input handling, rendering, history, themes
tests/engine.test.js  unit tests for the engine (Node, no dependencies)
```

## Running

Open `index.html` in any modern browser. There is no build step and nothing to install.

To run the engine tests (requires Node 16 or later):

```bash
npm test
```

## Limits

- Exact results are capped at about 200,000 bits (roughly 60,000 digits), and factorial at `3000!`. Beyond that, the calculator reports that the result is too large, rather than freezing the page.
- `%` means "divide by 100", so `200 × 15%` is `30`. It does not use the "add a percentage" behaviour some pocket calculators have.

## License

MIT
