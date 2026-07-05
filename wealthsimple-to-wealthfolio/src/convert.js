/*
 * convert.js — Wealthsimple → Wealthfolio CSV conversion (pure, no DOM).
 *
 * Wealthsimple exports transaction CSVs whose columns are typically:
 *     date, transaction, description, amount, balance, currency
 * and where the ticker for a trade or dividend lives *inside* the
 * description, e.g.
 *     "ZFL - BMO Long Federal Bond Index ETF: Cash dividend distribution,
 *      received on 2024-11-04, record date of 2024-10-30"
 *
 * Wealthfolio's activity importer instead wants one column per field and a
 * bare symbol on every row (cash-only rows use the $CASH-<CCY> pseudo-symbol):
 *     date, symbol, quantity, activityType, unitPrice, currency, fee, amount
 *
 * This module reads the former and produces the latter. Column detection is
 * done by header name (case-insensitive with aliases) so it survives small
 * differences between Wealthsimple's spending, credit, and investing exports.
 *
 * The same file is loaded by the browser tool (attaches to window.WSWF) and by
 * the Node test suite (module.exports).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WSWF = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // The columns Wealthfolio's activity importer maps against.
  var OUTPUT_COLUMNS = [
    'date', 'symbol', 'quantity', 'activityType', 'unitPrice', 'currency', 'fee', 'amount',
  ];

  // ---------------------------------------------------------------------------
  // CSV parsing / serialization (RFC-4180-ish: quotes, escaped quotes, newlines)
  // ---------------------------------------------------------------------------

  function parseCSV(text) {
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;
    // Strip a UTF-8 BOM if present.
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        rows.push(row); row = [];
      } else {
        field += c;
      }
    }
    // Flush trailing field/row unless the file ended on a clean newline.
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    // Drop fully-empty trailing rows.
    while (rows.length && rows[rows.length - 1].every(function (f) { return f === ''; })) rows.pop();
    return rows;
  }

  function csvCell(value) {
    var s = value == null ? '' : String(value);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function toCSV(header, records) {
    var lines = [header.map(csvCell).join(',')];
    records.forEach(function (rec) {
      lines.push(header.map(function (h) { return csvCell(rec[h]); }).join(','));
    });
    return lines.join('\r\n') + '\r\n';
  }

  // ---------------------------------------------------------------------------
  // Column detection
  // ---------------------------------------------------------------------------

  var COLUMN_ALIASES = {
    date: ['date', 'transaction date', 'trade date', 'process date', 'settlement date', 'posted date', 'time'],
    type: ['transaction', 'transaction type', 'type', 'activity', 'activity type', 'action', 'category'],
    description: ['description', 'details', 'detail', 'memo', 'payee', 'notes', 'note', 'name', 'merchant'],
    amount: ['amount', 'net amount', 'value', 'cash', 'debit/credit'],
    currency: ['currency', 'ccy', 'cur'],
    symbol: ['symbol', 'ticker', 'security'],
    quantity: ['quantity', 'qty', 'shares', 'units', 'number of shares'],
    price: ['price', 'unit price', 'share price', 'price per share'],
    fee: ['fee', 'fees', 'commission', 'commissions'],
    balance: ['balance', 'running balance', 'account balance'],
  };

  function normHeader(h) {
    return String(h == null ? '' : h).trim().toLowerCase().replace(/[_\s]+/g, ' ');
  }

  // Returns { field: columnIndex } for every field we could match.
  function detectColumns(header) {
    var normalized = header.map(normHeader);
    var map = {};
    Object.keys(COLUMN_ALIASES).forEach(function (field) {
      var aliases = COLUMN_ALIASES[field];
      // Prefer an exact alias match, then fall back to a substring match.
      var idx = -1;
      for (var a = 0; a < aliases.length && idx === -1; a++) {
        idx = normalized.indexOf(aliases[a]);
      }
      if (idx === -1) {
        for (var j = 0; j < normalized.length && idx === -1; j++) {
          for (var k = 0; k < aliases.length; k++) {
            if (normalized[j].indexOf(aliases[k]) !== -1) { idx = j; break; }
          }
        }
      }
      if (idx !== -1) map[field] = idx;
    });
    return map;
  }

  // ---------------------------------------------------------------------------
  // Field extraction helpers
  // ---------------------------------------------------------------------------

  function parseAmount(raw) {
    if (raw == null) return NaN;
    var s = String(raw).trim();
    if (!s) return NaN;
    var negative = /^\(.*\)$/.test(s) || /-\s*$/.test(s); // (1.23) or trailing minus
    // Normalize unicode minus, strip currency symbols/codes, commas, parens, spaces.
    s = s.replace(/−/g, '-')
         .replace(/[()]/g, '')
         .replace(/[^0-9.\-]/g, '');
    var n = parseFloat(s);
    if (isNaN(n)) return NaN;
    if (negative && n > 0) n = -n;
    return n;
  }

  function normalizeDate(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return '';
    // Already ISO (optionally with a time component)?
    var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
    // MM/DD/YYYY or DD/MM/YYYY — ambiguous, so only handle the unambiguous
    // YYYY/MM/DD form deterministically; otherwise defer to Date.parse.
    var ymd = s.match(/^(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})$/);
    if (ymd) return ymd[1] + '-' + pad2(ymd[2]) + '-' + pad2(ymd[3]);
    var t = Date.parse(s);
    if (!isNaN(t)) {
      var d = new Date(t);
      return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
    }
    return s; // leave untouched; surfaced as a warning upstream
  }

  function pad2(n) { n = String(n); return n.length < 2 ? '0' + n : n; }

  // Pull the leading ticker out of a Wealthsimple description.
  //   "ZFL - BMO Long Federal Bond Index ETF: ..." -> "ZFL"
  //   "AAPL: Cash dividend ..."                     -> "AAPL"
  //   "BRK.B - Berkshire ..."                       -> "BRK.B"
  // Returns '' when the text doesn't start with a ticker-like token.
  function extractSymbol(description) {
    var s = String(description == null ? '' : description).trim();
    var m = s.match(/^([A-Za-z][A-Za-z0-9.]{0,9})\s*(?:-|:)\s/);
    if (!m) m = s.match(/^([A-Za-z][A-Za-z0-9.]{0,9})\s*:/);
    if (!m) return '';
    var sym = m[1].toUpperCase().replace(/\.$/, '');
    // Guard against grabbing an ordinary capitalized word that happens to be
    // followed by a colon (e.g. "Interest: ..."). Real tickers are short and
    // usually all-caps or contain a dot.
    if (sym.length > 6 && sym.indexOf('.') === -1) return '';
    return sym;
  }

  // Pull quantity and price out of a trade description.
  //   "Bought 10.0000 shares at $12.34"            -> { quantity: 10, price: 12.34 }
  //   "Sold 5 shares of AAPL at US$150.00"          -> { quantity: 5, price: 150 }
  //   "Bought 1.4258 shares, received on 2024-11-04"-> { quantity: 1.4258, price: NaN }
  // The price is only taken when it's unambiguous: preceded by at/@/"price of"
  // and either $-anchored or written with decimals. A bare integer such as a
  // year (2024) is never treated as a price — the caller derives it from the
  // cash amount instead.
  function extractTrade(description) {
    var s = String(description == null ? '' : description);
    var quantity = NaN;
    var q = s.match(/([\d,]*\.?\d+)\s*(?:shares?|units?)\b/i);
    if (q) quantity = parseAmount(q[1]);

    var price = NaN;
    var p = s.match(/(?:\bat\b|@|price of)\s*(?:US|CA|C|CAD|USD)?\s*\$\s*([\d,]+(?:\.\d+)?)/i)
         || s.match(/(?:\bat\b|@|price of)\s*([\d,]+\.\d+)\b/i);
    if (p) price = parseAmount(p[1]);

    return { quantity: quantity, price: price };
  }

  // ---------------------------------------------------------------------------
  // Activity-type classification
  // ---------------------------------------------------------------------------

  // For investing accounts: look at the type code AND the description, since
  // the useful signal lives in one or the other depending on the export.
  function classifyInvesting(haystack) {
    var h = ' ' + haystack.toLowerCase() + ' ';
    if (/split/.test(h)) return 'SPLIT';
    if (/divid|distribution/.test(h)) return 'DIVIDEND';
    if (/non.?resident|withhold|\bnr[tw]\b|\btax\b/.test(h)) return 'TAX';
    if (/interest/.test(h)) return 'INTEREST';
    if (/\bfee\b|commission|management fee|\bmgmt\b|adr fee/.test(h)) return 'FEE';
    if (/\bbought\b|\bbuy\b|purchase of|market buy|limit buy/.test(h)) return 'BUY';
    if (/\bsold\b|\bsell\b|market sell|limit sell/.test(h)) return 'SELL';
    if (/withdraw|transfer out|\baft out\b|\beft out\b|cash out/.test(h)) return 'WITHDRAWAL';
    if (/contribution|deposit|transfer in|\baft in\b|\beft in\b|funding|received/.test(h)) return 'DEPOSIT';
    return null; // unknown — caller falls back to sign
  }

  // For spending / credit accounts everything is cash: direction comes from the
  // sign of the amount, with interest and fees pulled out by keyword.
  function classifyCash(haystack, amount) {
    var h = ' ' + haystack.toLowerCase() + ' ';
    if (/interest/.test(h)) return 'INTEREST';
    if (/\bfee\b|\bnsf\b|service charge|monthly plan/.test(h)) return 'FEE';
    if (!isNaN(amount) && amount !== 0) return amount > 0 ? 'DEPOSIT' : 'WITHDRAWAL';
    if (/refund|reimburs|cash ?back|rebate|reward|received|credit|payment received/.test(h)) return 'DEPOSIT';
    if (/purchase|withdraw|paid|payment|bill|sent|debit/.test(h)) return 'WITHDRAWAL';
    return null;
  }

  var SECURITY_TYPES = { BUY: 1, SELL: 1, DIVIDEND: 1, SPLIT: 1 };

  // ---------------------------------------------------------------------------
  // Main conversion
  // ---------------------------------------------------------------------------

  // options:
  //   accountType   'investing' | 'spending' | 'credit'   (default 'investing')
  //   defaultCurrency  fallback currency code             (default 'CAD')
  //   symbolSuffix  appended to symbols lacking a '.'      (default '', e.g. '.TO')
  function convert(text, options) {
    options = options || {};
    var accountType = options.accountType || 'investing';
    var isCash = accountType === 'spending' || accountType === 'credit';
    var defaultCurrency = (options.defaultCurrency || 'CAD').toUpperCase();
    var symbolSuffix = options.symbolSuffix || '';

    var grid = parseCSV(text);
    var result = {
      header: OUTPUT_COLUMNS.slice(),
      records: [],
      warnings: [],
      detected: {},
      stats: { input: 0, output: 0, byType: {} },
    };

    if (!grid.length) {
      result.warnings.push('The file appears to be empty.');
      return result;
    }

    var header = grid[0];
    var cols = detectColumns(header);
    result.detected = describeDetection(header, cols);

    if (cols.date == null) result.warnings.push('No date column was detected — check the mapping.');
    if (cols.amount == null && cols.price == null) result.warnings.push('No amount column was detected — amounts may be blank.');
    if (cols.description == null && cols.type == null) result.warnings.push('No description or transaction-type column was detected — activity types will be guessed from amount sign only.');

    var unknownTypes = {};

    for (var r = 1; r < grid.length; r++) {
      var row = grid[r];
      if (row.every(function (f) { return String(f).trim() === ''; })) continue;
      result.stats.input++;

      var get = function (field) { return cols[field] != null ? row[cols[field]] : ''; };

      var date = normalizeDate(get('date'));
      var rawType = String(get('type') || '').trim();
      var description = String(get('description') || '').trim();
      var currency = String(get('currency') || '').trim().toUpperCase() || defaultCurrency;
      var amount = parseAmount(get('amount'));
      var haystack = rawType + ' ' + description;

      var activityType = isCash
        ? classifyCash(haystack, amount)
        : classifyInvesting(haystack);

      if (!activityType) {
        // Last-resort fallback: use amount sign.
        if (!isNaN(amount) && amount !== 0) activityType = amount > 0 ? 'DEPOSIT' : 'WITHDRAWAL';
        else activityType = 'DEPOSIT';
        var key = rawType || '(blank)';
        unknownTypes[key] = (unknownTypes[key] || 0) + 1;
      }

      var isSecurity = !isCash && SECURITY_TYPES[activityType] === 1;
      var symbol, quantity = '', unitPrice = '', fee = parseAmount(get('fee'));
      if (isNaN(fee)) fee = 0;
      var amountOverride = null; // set to force a specific output amount (or '' to blank it)

      // Append the optional exchange suffix (e.g. ".TO") only to plain,
      // non-USD tickers — a US-dollar holding like AAPL must not become AAPL.TO.
      var applySuffix = function (sym) {
        if (!symbolSuffix || !sym || sym[0] === '$' || sym.indexOf('.') !== -1 || currency === 'USD') return sym;
        return sym + symbolSuffix;
      };

      if (isSecurity) {
        symbol = applySuffix(extractSymbol(description) || String(get('symbol') || '').trim().toUpperCase());
        if (!symbol) {
          result.warnings.push('Row ' + (r + 1) + ': could not find a ticker in "' + truncate(description, 60) + '". Set the symbol manually before importing.');
        }

        if (activityType === 'BUY' || activityType === 'SELL') {
          // Wealthfolio's amount convention:
          //   BUY  amount = quantity * unitPrice + fee   (cash out)
          //   SELL amount = quantity * unitPrice - fee   (cash in)
          // Wealthsimple's net cash already equals that, so amount = |net|.
          // The gross (quantity * unitPrice) is |net| minus the signed fee.
          var aSign = activityType === 'BUY' ? 1 : -1;
          var trade = extractTrade(description);
          if (!isNaN(trade.quantity)) quantity = trade.quantity;
          var parsedPrice = isNaN(trade.price) ? null : trade.price;

          // The net cash amount is authoritative, so whenever we have quantity
          // and an amount we can derive the exact unit price:
          //   gross (quantity * unitPrice) = |amount| - aSign*fee
          var derivedPrice = null;
          if (quantity !== '' && !isNaN(amount) && quantity) {
            derivedPrice = round(Math.abs((Math.abs(amount) - aSign * fee) / quantity), 6);
          }

          if (parsedPrice !== null && derivedPrice !== null) {
            // Both available: trust the description price only if it reconciles
            // with the cash; otherwise the description number was misread
            // (e.g. a date/year), so use the amount-derived price silently.
            var disagree = Math.abs(parsedPrice - derivedPrice) > Math.max(0.01, derivedPrice * 0.01);
            unitPrice = disagree ? derivedPrice : parsedPrice;
          } else if (parsedPrice !== null) {
            unitPrice = parsedPrice;
          } else if (derivedPrice !== null) {
            unitPrice = derivedPrice;
          }

          // Derive a missing net amount from parsed quantity/price/fee.
          if (isNaN(amount) && quantity !== '' && unitPrice !== '') {
            amountOverride = round(quantity * unitPrice + aSign * fee, 2);
          }

          // Only warn when we genuinely couldn't determine a field — a clean,
          // reconciled row (the common case) produces no noise.
          if (quantity === '') {
            result.warnings.push('Row ' + (r + 1) + ': ' + activityType + ' with no share count found — set quantity manually.');
          } else if (unitPrice === '') {
            result.warnings.push('Row ' + (r + 1) + ': ' + activityType + ' with no price and no amount to derive it from — set the unit price manually.');
          }
        } else if (activityType === 'SPLIT') {
          // Wealthfolio treats a SPLIT's amount as the ratio (e.g. 2 for 2:1),
          // not a dollar value, and needs no quantity/unitPrice. We can't infer
          // the ratio from a Wealthsimple line, so leave it blank to fill in.
          amountOverride = '';
          result.warnings.push('Row ' + (r + 1) + ': stock split for ' + (symbol || 'this holding') + ' — set the split ratio (e.g. 2 for 2:1) as the amount in Wealthfolio.');
        }
      } else {
        // Cash-side activity: dividends stay attached to their security symbol,
        // everything else rides the $CASH pseudo-symbol.
        if (activityType === 'DIVIDEND') {
          symbol = extractSymbol(description);
          if (!symbol) {
            symbol = '$CASH-' + currency;
            result.warnings.push('Row ' + (r + 1) + ': dividend with no ticker — filed against ' + symbol + '.');
          } else {
            symbol = applySuffix(symbol);
          }
        } else if (activityType === 'TAX') {
          symbol = applySuffix(extractSymbol(description)) || ('$CASH-' + currency);
        } else {
          symbol = '$CASH-' + currency;
        }
      }

      var outAmount = amountOverride !== null
        ? amountOverride
        : (isNaN(amount) ? '' : round(Math.abs(amount), 2));

      var record = {
        date: date,
        symbol: symbol,
        quantity: quantity === '' ? (isSecurity ? '' : '0') : String(quantity),
        activityType: activityType,
        unitPrice: unitPrice === '' ? '0' : String(unitPrice),
        currency: currency,
        fee: String(round(fee, 2)),
        amount: outAmount === '' ? '' : String(outAmount),
      };
      result.records.push(record);
      result.stats.output++;
      result.stats.byType[activityType] = (result.stats.byType[activityType] || 0) + 1;
    }

    Object.keys(unknownTypes).forEach(function (t) {
      result.warnings.push('Unrecognized transaction type "' + t + '" (' + unknownTypes[t] + ' row' + (unknownTypes[t] > 1 ? 's' : '') + ') — classified by amount sign. Review these.');
    });

    return result;
  }

  function describeDetection(header, cols) {
    var out = {};
    Object.keys(cols).forEach(function (field) { out[field] = header[cols[field]]; });
    return out;
  }

  function round(n, dp) {
    if (isNaN(n)) return n;
    var f = Math.pow(10, dp);
    return Math.round((n + Number.EPSILON) * f) / f;
  }

  function truncate(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  return {
    OUTPUT_COLUMNS: OUTPUT_COLUMNS,
    parseCSV: parseCSV,
    toCSV: toCSV,
    detectColumns: detectColumns,
    normalizeDate: normalizeDate,
    parseAmount: parseAmount,
    extractSymbol: extractSymbol,
    extractTrade: extractTrade,
    convert: convert,
  };
});
