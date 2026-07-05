/*
 * Node test suite for convert.js. Run with:  node convert.test.mjs
 * No dependencies — a tiny assert harness keeps this self-contained.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const WSWF = require('./src/convert.js');

let passed = 0;
let failed = 0;
const failures = [];

function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; }
  else { failed++; failures.push(`${msg}\n    expected: ${e}\n    actual:   ${a}`); }
}
function ok(cond, msg) { eq(!!cond, true, msg); }

// Find the first output record whose description-derived field matches.
function rowsByType(res, type) { return res.records.filter(r => r.activityType === type); }

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------
(() => {
  const grid = WSWF.parseCSV('a,b,c\n1,"two, still two",3\n"line\nbreak",5,6\n');
  eq(grid.length, 3, 'parseCSV: row count');
  eq(grid[1], ['1', 'two, still two', '3'], 'parseCSV: quoted comma');
  eq(grid[2][0], 'line\nbreak', 'parseCSV: quoted newline');

  const escaped = WSWF.parseCSV('x\n"he said ""hi"""\n');
  eq(escaped[1][0], 'he said "hi"', 'parseCSV: escaped quotes');

  const bom = WSWF.parseCSV('﻿date,amount\n2024-01-01,5\n');
  eq(bom[0], ['date', 'amount'], 'parseCSV: strips BOM');
})();

// ---------------------------------------------------------------------------
// Symbol extraction
// ---------------------------------------------------------------------------
(() => {
  eq(WSWF.extractSymbol('ZFL - BMO Long Federal Bond Index ETF: Cash dividend distribution, received on 2024-11-04, record date of 2024-10-30'), 'ZFL', 'symbol: TICKER - Name:');
  eq(WSWF.extractSymbol('AAPL: Cash dividend'), 'AAPL', 'symbol: TICKER:');
  eq(WSWF.extractSymbol('BRK.B - Berkshire Hathaway: Bought 1 share'), 'BRK.B', 'symbol: dotted ticker');
  eq(WSWF.extractSymbol('Tim Hortons #4021'), '', 'symbol: none for merchant text');
  eq(WSWF.extractSymbol('Interest: paid on cash'), '', 'symbol: rejects long word before colon');
  eq(WSWF.extractSymbol('vfv - Vanguard: dividend'), 'VFV', 'symbol: upcases');
})();

// ---------------------------------------------------------------------------
// Trade parsing
// ---------------------------------------------------------------------------
(() => {
  eq(WSWF.extractTrade('ZFL - BMO: Bought 10.0000 shares at $14.52'), { quantity: 10, price: 14.52 }, 'trade: bought N at $P');
  eq(WSWF.extractTrade('AAPL - Apple Inc: Sold 5 shares of AAPL at US$150.00'), { quantity: 5, price: 150 }, 'trade: sold with US$');
  eq(WSWF.extractTrade('VFV: Bought 2.5 units @ 100.25'), { quantity: 2.5, price: 100.25 }, 'trade: @ price');
  eq(WSWF.extractTrade('no numbers here'), { quantity: NaN, price: NaN }, 'trade: none');
})();

// ---------------------------------------------------------------------------
// Amount / date normalization
// ---------------------------------------------------------------------------
(() => {
  eq(WSWF.parseAmount('$1,234.56'), 1234.56, 'amount: currency + thousands');
  eq(WSWF.parseAmount('(45.00)'), -45, 'amount: parens negative');
  eq(WSWF.parseAmount('−12.30'), -12.3, 'amount: unicode minus');
  eq(WSWF.normalizeDate('2024-11-04'), '2024-11-04', 'date: ISO passthrough');
  eq(WSWF.normalizeDate('2024-11-04T13:00:00Z'), '2024-11-04', 'date: ISO with time');
  eq(WSWF.normalizeDate('August 19, 2024'), '2024-08-19', 'date: long form');
})();

// ---------------------------------------------------------------------------
// Investing account end-to-end
// ---------------------------------------------------------------------------
(() => {
  const csv = [
    'date,transaction,description,amount,balance,currency',
    '2024-11-04,DIV,"ZFL - BMO Long Federal Bond Index ETF: Cash dividend distribution, received on 2024-11-04, record date of 2024-10-30",12.34,1012.34,CAD',
    '2024-10-15,BUY,"ZFL - BMO Long Federal Bond Index ETF: Bought 10.0000 shares at $14.52",-145.20,1000.00,CAD',
    '2024-10-16,SELL,"AAPL - Apple Inc: Sold 5 shares of AAPL at US$150.00",750.00,1750.00,USD',
    '2024-10-01,DEPOSIT,"Direct deposit from PAYROLL",500.00,500.00,CAD',
    '2024-10-31,INT,"Interest earned",0.42,500.42,CAD',
    '2024-10-31,FEE,"Management fee",-1.00,499.42,CAD',
  ].join('\n');
  const res = WSWF.convert(csv, { accountType: 'investing', defaultCurrency: 'CAD' });

  eq(res.stats.input, 6, 'investing: input rows');
  eq(res.stats.output, 6, 'investing: output rows');

  const div = rowsByType(res, 'DIVIDEND')[0];
  eq(div.symbol, 'ZFL', 'investing: dividend keeps symbol');
  eq(div.amount, '12.34', 'investing: dividend amount magnitude');

  const buy = rowsByType(res, 'BUY')[0];
  eq(buy.symbol, 'ZFL', 'investing: buy symbol');
  eq(buy.quantity, '10', 'investing: buy quantity');
  eq(buy.unitPrice, '14.52', 'investing: buy price');
  eq(buy.amount, '145.2', 'investing: buy amount is positive magnitude');

  const sell = rowsByType(res, 'SELL')[0];
  eq(sell.currency, 'USD', 'investing: sell currency from column');
  eq(sell.quantity, '5', 'investing: sell quantity');

  const dep = rowsByType(res, 'DEPOSIT')[0];
  eq(dep.symbol, '$CASH-CAD', 'investing: deposit uses $CASH');

  const int = rowsByType(res, 'INTEREST')[0];
  eq(int.symbol, '$CASH-CAD', 'investing: interest uses $CASH');

  const fee = rowsByType(res, 'FEE')[0];
  eq(fee.symbol, '$CASH-CAD', 'investing: fee uses $CASH');
  eq(fee.amount, '1', 'investing: fee amount magnitude');

  ok(res.warnings.length === 0, 'investing: no warnings on clean data (' + JSON.stringify(res.warnings) + ')');
})();

// ---------------------------------------------------------------------------
// Price derived from amount when description lacks it
// ---------------------------------------------------------------------------
(() => {
  const csv = [
    'date,transaction,description,amount,currency',
    '2024-09-09,BUY,"VFV - Vanguard: Bought 4 shares",-400.00,CAD',
  ].join('\n');
  const res = WSWF.convert(csv, { accountType: 'investing' });
  const buy = res.records[0];
  eq(buy.quantity, '4', 'derive: quantity parsed');
  eq(buy.unitPrice, '100', 'derive: price = amount/qty');
})();

// ---------------------------------------------------------------------------
// Symbol suffix option (e.g. Canadian .TO tickers)
// ---------------------------------------------------------------------------
(() => {
  const csv = [
    'date,transaction,description,amount,currency',
    '2024-11-04,DIV,"ZFL - BMO: Cash dividend distribution",12.34,CAD',
    '2024-10-16,SELL,"AAPL - Apple Inc: Sold 5 shares at $150",750,USD',
  ].join('\n');
  const res = WSWF.convert(csv, { accountType: 'investing', symbolSuffix: '.TO' });
  eq(res.records[0].symbol, 'ZFL.TO', 'suffix: appended to plain CAD ticker');
  eq(res.records[1].symbol, 'AAPL', 'suffix: NOT appended to USD ticker');
})();

// ---------------------------------------------------------------------------
// Spending account (chequing) — sign drives direction
// ---------------------------------------------------------------------------
(() => {
  const csv = [
    'date,transaction,description,amount,balance,currency',
    '2024-11-01,SPEND,"Tim Hortons #4021",-4.75,95.25,CAD',
    '2024-11-02,DEPOSIT,"Direct deposit ACME CORP PAYROLL",1500.00,1595.25,CAD',
    '2024-11-03,INTEREST,"Interest earned on your balance",1.23,1596.48,CAD',
    '2024-11-04,REFUND,"Refund from AMAZON.CA",20.00,1616.48,CAD',
  ].join('\n');
  const res = WSWF.convert(csv, { accountType: 'spending', defaultCurrency: 'CAD' });

  eq(res.records[0].activityType, 'WITHDRAWAL', 'spending: spend -> withdrawal');
  eq(res.records[0].amount, '4.75', 'spending: withdrawal magnitude');
  eq(res.records[0].symbol, '$CASH-CAD', 'spending: uses $CASH');
  eq(res.records[1].activityType, 'DEPOSIT', 'spending: payroll -> deposit');
  eq(res.records[2].activityType, 'INTEREST', 'spending: interest keyword');
  eq(res.records[3].activityType, 'DEPOSIT', 'spending: refund -> deposit');
})();

// ---------------------------------------------------------------------------
// Credit card — purchases out, payments/cashback in
// ---------------------------------------------------------------------------
(() => {
  const csv = [
    'date,transaction,description,amount,currency',
    '2024-11-05,PURCHASE,"LOBLAWS #123",-82.14,CAD',
    '2024-11-06,PAYMENT,"Payment received - thank you",200.00,CAD',
    '2024-11-07,CASHBACK,"Cash back reward",1.64,CAD',
    '2024-11-08,FEE,"Annual fee",-120.00,CAD',
  ].join('\n');
  const res = WSWF.convert(csv, { accountType: 'credit', defaultCurrency: 'CAD' });
  eq(res.records[0].activityType, 'WITHDRAWAL', 'credit: purchase -> withdrawal');
  eq(res.records[1].activityType, 'DEPOSIT', 'credit: payment -> deposit');
  eq(res.records[2].activityType, 'DEPOSIT', 'credit: cashback -> deposit');
  eq(res.records[3].activityType, 'FEE', 'credit: fee keyword');
  res.records.forEach((r, i) => eq(r.symbol, '$CASH-CAD', 'credit: row ' + i + ' uses $CASH'));
})();

// ---------------------------------------------------------------------------
// Column auto-detection with alternate headers
// ---------------------------------------------------------------------------
(() => {
  const csv = [
    'Date,Type,Details,Net Amount,Currency',
    '2024-11-04,Dividend,"XEQT - iShares Core Equity ETF: Cash dividend distribution",5.55,CAD',
  ].join('\n');
  const res = WSWF.convert(csv, { accountType: 'investing' });
  eq(res.detected.date, 'Date', 'detect: date alias');
  eq(res.detected.type, 'Type', 'detect: type alias');
  eq(res.detected.description, 'Details', 'detect: description alias');
  eq(res.detected.amount, 'Net Amount', 'detect: amount alias');
  eq(res.records[0].symbol, 'XEQT', 'detect: still extracts symbol');
})();

// ---------------------------------------------------------------------------
// Unknown type surfaces a warning but still converts
// ---------------------------------------------------------------------------
(() => {
  const csv = [
    'date,transaction,description,amount,currency',
    '2024-11-04,WEIRDCODE,"something unusual",-9.99,CAD',
  ].join('\n');
  const res = WSWF.convert(csv, { accountType: 'investing' });
  eq(res.records[0].activityType, 'WITHDRAWAL', 'unknown: falls back to sign');
  ok(res.warnings.some(w => /WEIRDCODE/.test(w)), 'unknown: warns about the code');
})();

// ---------------------------------------------------------------------------
// Round-trip through toCSV parses back to the same grid
// ---------------------------------------------------------------------------
(() => {
  const res = WSWF.convert('date,transaction,description,amount,currency\n2024-11-04,DIV,"ZFL - BMO: dividend",12.34,CAD', { accountType: 'investing' });
  const out = WSWF.toCSV(res.header, res.records);
  const grid = WSWF.parseCSV(out);
  eq(grid[0], WSWF.OUTPUT_COLUMNS, 'roundtrip: header');
  eq(grid[1][1], 'ZFL', 'roundtrip: symbol cell');
})();

// ---------------------------------------------------------------------------
// Trade math with an explicit commission (Wealthfolio: BUY amount = q*p + fee,
// SELL amount = q*p - fee, and amount == |Wealthsimple net|).
// ---------------------------------------------------------------------------
(() => {
  const csv = [
    'date,transaction,description,amount,fee,currency',
    // net = -(10*14.52 + 5) = -150.20
    '2024-10-15,BUY,"ZFL - BMO: Bought 10.0000 shares at $14.52",-150.20,5.00,CAD',
    // net = 3*225.50 - 5 = 671.50
    '2024-10-10,SELL,"AAPL - Apple Inc: Sold 3.0000 shares at US$225.50",671.50,5.00,USD',
  ].join('\n');
  const res = WSWF.convert(csv, { accountType: 'investing' });

  const buy = res.records[0];
  eq(buy.quantity, '10', 'fee-buy: quantity');
  eq(buy.unitPrice, '14.52', 'fee-buy: unit price');
  eq(buy.fee, '5', 'fee-buy: fee');
  eq(buy.amount, '150.2', 'fee-buy: amount = q*p + fee = |net|');
  // Internal consistency with Wealthfolio's formula.
  ok(Math.abs((+buy.quantity * +buy.unitPrice + +buy.fee) - +buy.amount) < 0.001, 'fee-buy: q*p+fee == amount');

  const sell = res.records[1];
  eq(sell.amount, '671.5', 'fee-sell: amount = q*p - fee = |net|');
  ok(Math.abs((+sell.quantity * +sell.unitPrice - +sell.fee) - +sell.amount) < 0.001, 'fee-sell: q*p-fee == amount');

  ok(res.warnings.length === 0, 'fee-trades: no warnings when consistent (' + JSON.stringify(res.warnings) + ')');
})();

// SELL price derivation with a fee but no price in the description.
// net = 4*100 - 5 = 395  =>  price must derive to 100 (not 97.5).
(() => {
  const csv = [
    'date,transaction,description,amount,fee,currency',
    '2024-09-09,SELL,"VFV - Vanguard: Sold 4 shares",395.00,5.00,CAD',
  ].join('\n');
  const sell = WSWF.convert(csv, { accountType: 'investing' }).records[0];
  eq(sell.unitPrice, '100', 'sell-derive: price = (|net| + fee) / qty');
  eq(sell.amount, '395', 'sell-derive: amount = q*p - fee = |net|');
})();

// Missing net amount: derive the total from parsed quantity/price/fee.
(() => {
  const csv = [
    'date,transaction,description,amount,fee,currency',
    '2024-09-09,BUY,"VFV - Vanguard: Bought 4 shares at $100.00",,9.99,CAD',
  ].join('\n');
  const buy = WSWF.convert(csv, { accountType: 'investing' }).records[0];
  eq(buy.amount, '409.99', 'no-net: amount = q*p + fee');
})();

// Mismatch between parsed price and the statement amount raises a warning.
(() => {
  const csv = [
    'date,transaction,description,amount,currency',
    // 10 * 14.52 = 145.20, but the statement says 200 — misparse/typo.
    '2024-10-15,BUY,"ZFL - BMO: Bought 10.0000 shares at $14.52",-200.00,CAD',
  ].join('\n');
  const res = WSWF.convert(csv, { accountType: 'investing' });
  ok(res.warnings.some(w => /statement amount is 200/.test(w)), 'mismatch: warns on q*p vs statement (' + JSON.stringify(res.warnings) + ')');
})();

// Fractional shares reconcile cleanly.
(() => {
  const csv = [
    'date,transaction,description,amount,currency',
    '2024-10-15,BUY,"XEQT - iShares: Bought 2.5000 shares at $32.10",-80.25,CAD',
  ].join('\n');
  const res = WSWF.convert(csv, { accountType: 'investing' });
  eq(res.records[0].quantity, '2.5', 'fractional: quantity');
  eq(res.records[0].amount, '80.25', 'fractional: amount');
  ok(res.warnings.length === 0, 'fractional: no warnings');
})();

// SPLIT leaves amount blank (ratio is set in Wealthfolio) and warns.
(() => {
  const csv = [
    'date,transaction,description,amount,currency',
    '2024-06-10,SPLIT,"AAPL - Apple Inc: Stock split 4:1",0,USD',
  ].join('\n');
  const res = WSWF.convert(csv, { accountType: 'investing' });
  eq(res.records[0].activityType, 'SPLIT', 'split: type');
  eq(res.records[0].amount, '', 'split: amount blank (not a dollar value)');
  ok(res.warnings.some(w => /split ratio/.test(w)), 'split: warns to set ratio');
})();

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:\n' + failures.map(f => '  ✗ ' + f).join('\n'));
  process.exit(1);
}
