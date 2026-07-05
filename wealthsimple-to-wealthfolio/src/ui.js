/* ui.js — DOM wiring for the converter. Depends on WSWF (convert.js). */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    accountType: 'investing',
    fileName: '',
    text: '',
    result: null,
  };

  // ---- Setup controls -------------------------------------------------------
  var seg = $('acct-seg');
  var acctHint = $('acct-hint');
  var suffixField = $('suffix-field');
  var HINTS = {
    investing: 'Trades &amp; dividends keep their ticker; cash moves use <code>$CASH</code>.',
    spending: 'Every row is treated as cash on <code>$CASH</code>; direction comes from the amount.',
    credit: 'Purchases become withdrawals, payments &amp; cashback become deposits, all on <code>$CASH</code>.',
  };
  seg.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-acct]');
    if (!btn) return;
    state.accountType = btn.getAttribute('data-acct');
    Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) {
      b.setAttribute('aria-pressed', String(b === btn));
    });
    acctHint.innerHTML = HINTS[state.accountType];
    suffixField.style.opacity = state.accountType === 'investing' ? '1' : '0.5';
    rerun();
  });

  $('ccy').addEventListener('input', debounce(rerun, 250));
  $('suffix').addEventListener('input', debounce(rerun, 250));

  // ---- File intake ----------------------------------------------------------
  var drop = $('drop');
  var fileInput = $('file');

  drop.addEventListener('click', function () { fileInput.click(); });
  drop.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener('change', function () {
    if (fileInput.files && fileInput.files[0]) readFile(fileInput.files[0]);
  });
  ['dragenter', 'dragover'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('drag'); });
  });
  ['dragleave', 'dragend'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('drag'); });
  });
  drop.addEventListener('drop', function (e) {
    e.preventDefault(); drop.classList.remove('drag');
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) readFile(f);
  });

  function readFile(file) {
    state.fileName = file.name || 'transactions.csv';
    var reader = new FileReader();
    reader.onload = function () { state.text = String(reader.result || ''); run(); };
    reader.onerror = function () { alert('Could not read that file. Make sure it is a .csv text file.'); };
    reader.readAsText(file);
  }

  // ---- Conversion -----------------------------------------------------------
  function currentOptions() {
    return {
      accountType: state.accountType,
      defaultCurrency: ($('ccy').value || 'CAD').trim() || 'CAD',
      symbolSuffix: state.accountType === 'investing' ? ($('suffix').value || '').trim() : '',
    };
  }

  function rerun() { if (state.text) run(); }

  function run() {
    state.result = WSWF.convert(state.text, currentOptions());
    render(state.result);
  }

  // ---- Rendering ------------------------------------------------------------
  function render(res) {
    $('results').hidden = false;
    $('done').hidden = true;
    $('filename').textContent = state.fileName;

    // Summary chips
    var chips = $('chips');
    chips.innerHTML = '';
    chips.appendChild(chip(res.stats.output + ' rows converted', true));
    var order = ['BUY', 'SELL', 'DIVIDEND', 'INTEREST', 'FEE', 'TAX', 'DEPOSIT', 'WITHDRAWAL', 'SPLIT'];
    order.forEach(function (t) {
      if (res.stats.byType[t]) chips.appendChild(chip(t.toLowerCase() + ' ' + res.stats.byType[t]));
    });

    // Detected columns
    var det = $('detected');
    var need = ['date', 'type', 'description', 'amount', 'currency'];
    var parts = need.map(function (f) {
      if (res.detected[f]) return '<code>' + esc(res.detected[f]) + '</code> as ' + f;
      return '<span class="miss">' + f + ' not found</span>';
    });
    det.innerHTML = 'Detected columns: ' + parts.join(' · ');

    // Notices
    renderNotices(res.warnings);

    // Preview table
    renderTable(res);

    // Scroll results into view on first load only
    if (!render._shown) { render._shown = true; $('results').scrollIntoView({ behavior: prefersReduced() ? 'auto' : 'smooth', block: 'start' }); }
  }

  function renderNotices(warnings) {
    var box = $('notices');
    box.innerHTML = '';
    if (!warnings.length) {
      box.appendChild(notice('good', 'Everything mapped cleanly — no rows need attention.', null));
      return;
    }
    var shown = warnings.slice(0, 4);
    var rest = warnings.slice(4);
    var el = document.createElement('div');
    el.className = 'notice warn' + (rest.length ? ' collapsed' : '');
    el.innerHTML = warnIcon() + '<div><strong>' + warnings.length + ' thing' + (warnings.length > 1 ? 's' : '') + ' to review before importing</strong>' +
      '<ul style="margin:6px 0 0;padding-left:18px">' +
      shown.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') +
      rest.map(function (w) { return '<li class="extra">' + esc(w) + '</li>'; }).join('') +
      '</ul></div>';
    box.appendChild(el);
    if (rest.length) {
      var more = document.createElement('button');
      more.className = 'notice-more';
      more.textContent = 'Show ' + rest.length + ' more';
      more.addEventListener('click', function () {
        el.classList.remove('collapsed'); more.remove();
      });
      box.appendChild(more);
    }
  }

  function renderTable(res) {
    var wrap = $('table-wrap');
    var cols = res.header;
    var numeric = { quantity: 1, unitPrice: 1, fee: 1, amount: 1 };
    var max = 60;
    var rows = res.records.slice(0, max);
    var html = '<table><thead><tr>' + cols.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr></thead><tbody>';
    rows.forEach(function (rec) {
      html += '<tr>' + cols.map(function (c) {
        var v = rec[c] == null ? '' : rec[c];
        if (c === 'symbol') return '<td class="sym">' + esc(v) + '</td>';
        if (c === 'activityType') return '<td><span class="tag">' + esc(v) + '</span></td>';
        if (numeric[c]) return '<td class="num">' + esc(v) + '</td>';
        return '<td>' + esc(v) + '</td>';
      }).join('') + '</tr>';
    });
    html += '</tbody></table>';
    if (res.records.length > max) {
      html += '<div class="more-rows">+ ' + (res.records.length - max) + ' more rows in the download</div>';
    }
    wrap.innerHTML = html;
  }

  // ---- Download -------------------------------------------------------------
  $('download').addEventListener('click', function () {
    if (!state.result) return;
    var csv = WSWF.toCSV(state.result.header, state.result.records);
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = outName(state.fileName);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    $('done').hidden = false;
  });

  $('reset').addEventListener('click', function () {
    state.text = ''; state.result = null; state.fileName = '';
    fileInput.value = '';
    $('results').hidden = true;
    render._shown = false;
  });

  function outName(name) {
    var base = String(name).replace(/\.csv$/i, '').replace(/[^\w.-]+/g, '_');
    return (base || 'transactions') + '-wealthfolio.csv';
  }

  // ---- Helpers --------------------------------------------------------------
  function chip(text, accent) {
    var el = document.createElement('span');
    el.className = 'chip' + (accent ? ' accent' : '');
    var m = String(text).match(/^(.*?)(\d+)$/);
    if (m) el.innerHTML = esc(m[1]) + '<b>' + m[2] + '</b>';
    else el.innerHTML = '<b>' + esc(text) + '</b>';
    return el;
  }
  function notice(kind, text, icon) {
    var el = document.createElement('div');
    el.className = 'notice ' + kind;
    el.innerHTML = (kind === 'good' ? goodIcon() : warnIcon()) + '<div>' + esc(text) + '</div>';
    return el;
  }
  function warnIcon() { return '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4m0 4h.01"/><path d="M10.3 3.9L2.4 18a2 2 0 001.7 3h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/></svg>'; }
  function goodIcon() { return '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }
  function prefersReduced() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
})();
