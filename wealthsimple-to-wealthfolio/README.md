# Wealthsimple → Wealthfolio CSV Translator

Wealthsimple exports transaction CSVs where the ticker is buried in the
description, e.g.

```
ZFL - BMO Long Federal Bond Index ETF: Cash dividend distribution, received on 2024-11-04, record date of 2024-10-30
```

[Wealthfolio](https://wealthfolio.app)'s activity importer wants the symbol in
its own column (`ZFL`), an `activityType`, and cash-only rows tagged with the
`$CASH-<CCY>` pseudo-symbol. This tool does that translation — for **spending**,
**credit card**, and **investing** accounts — entirely in your browser. Nothing
is uploaded.

## Use it

Open **`index.html`** in any browser (double-click it, or drag it onto a browser
window). Then:

1. Pick the account type — **Investing**, **Spending**, or **Credit card**.
2. Drop in the CSV you exported from Wealthsimple.
3. Review the preview and any warnings, then **Download Wealthfolio CSV**.
4. In Wealthfolio: **Activities → Import**, choose the file, confirm the columns.

The output columns are exactly what Wealthfolio maps against:

```
date, symbol, quantity, activityType, unitPrice, currency, fee, amount
```

## How the translation works

| Wealthsimple | → | Wealthfolio |
|---|---|---|
| `ZFL - BMO … : Cash dividend distribution` | → | symbol `ZFL`, type `DIVIDEND` |
| `… : Bought 10.0000 shares at $14.52` | → | `BUY`, quantity `10`, unitPrice `14.52` |
| `Interest earned on cash` | → | `INTEREST` on `$CASH-CAD` |
| Chequing purchase `-4.75` | → | `WITHDRAWAL` on `$CASH-CAD` |
| Credit-card payment `+200.00` | → | `DEPOSIT` on `$CASH-CAD` |

- **Investing** accounts are classified by the transaction type/description, and
  buys/sells/dividends/splits keep their ticker. Deposits, interest and fees go
  to `$CASH-<currency>`.
- **Trade amounts** follow Wealthfolio's convention: a `BUY`'s `amount` is
  `quantity × unitPrice + fee` and a `SELL`'s is `quantity × unitPrice − fee`
  (which is exactly Wealthsimple's net cash). Quantity and unit price are read
  from the description; if the price is missing it's derived from the net amount
  and the fee. If the parsed `quantity × unitPrice` doesn't reconcile with the
  statement's amount, that row is flagged as a warning so you can check it.
- **Spending** and **Credit card** accounts are all cash: direction comes from
  the sign of the amount (out → `WITHDRAWAL`, in → `DEPOSIT`), with interest and
  fees pulled out by keyword.
- Columns are detected by header name with aliases, so slightly different
  exports (`Type`/`Details`/`Net Amount`, …) still work.
- Anything it can't confidently map is listed as a **warning** so you can fix it
  before importing — it never silently drops a row.

### Canadian tickers

Wealthfolio often needs an exchange suffix (e.g. `ZFL.TO`) to match quotes.
Wealthsimple descriptions don't include it, so there's an optional **Ticker
suffix** field — set it to `.TO` and it's appended to plain tickers. Leave it
blank if you set symbols up another way.

## Project layout

```
index.html            ← the tool (generated; open this)
build.mjs             ← assembles index.html from the parts below
src/
  convert.js          ← conversion logic (pure, no DOM) — the real work
  ui.js               ← browser wiring
  body.html           ← markup
  styles.css          ← styles
convert.test.mjs      ← test suite (node convert.test.mjs)
samples/
  investing-tfsa.csv  ← example inputs to try
  spending.csv
  credit-card.csv
```

`convert.js` is the source of truth and has no dependencies, so it also works as
a Node module if you'd rather script the conversion:

```js
const WSWF = require('./src/convert.js');
const out = WSWF.convert(csvText, { accountType: 'investing', symbolSuffix: '.TO' });
console.log(WSWF.toCSV(out.header, out.records));
```

## Develop

```
node convert.test.mjs   # run tests
node build.mjs          # rebuild index.html after editing src/
```

## A note on formats

Wealthsimple doesn't publish a formal CSV spec and column names vary a little
between account types and export routes. This tool detects columns flexibly and
surfaces anything ambiguous rather than guessing silently. If a column isn't
detected for one of your exports, the fix is usually a one-line alias in
`COLUMN_ALIASES` in `src/convert.js`.
