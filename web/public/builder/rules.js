/* rules.js — the DPWH-CCDEO document conventions, as data and pure functions.
 * No DOM here: everything is testable on its own.
 */
(function (root) {
  'use strict';

  /* ---- amount in words: the SpellNumber macro from Book1.xlsm ------------ */
  const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const TEENS = { 10: 'Ten', 11: 'Eleven', 12: 'Twelve', 13: 'Thirteen', 14: 'Fourteen',
    15: 'Fifteen', 16: 'Sixteen', 17: 'Seventeen', 18: 'Eighteen', 19: 'Nineteen' };
  // The trailing spaces are deliberate. They are what produces the doubled spaces in
  // the office's existing resolutions ("SEVENTY  THOUSAND", "FIFTY  MILLION"), and
  // matching them is what makes a new resolution look like every previous one.
  // Never trim the pesos portion.
  const TENS = { 2: 'Twenty ', 3: 'Thirty ', 4: 'Forty ', 5: 'Fifty ',
    6: 'Sixty ', 7: 'Seventy ', 8: 'Eighty ', 9: 'Ninety ' };
  const PLACE = ['', '', ' Thousand ', ' Million ', ' Billion ', ' Trillion '];

  const getDigit = d => (/^[0-9]$/.test(d) ? ONES[+d] : '');
  function getTens(text) {
    text = (text + '0').slice(0, 2);
    const v = parseInt(text, 10);
    if (v >= 10 && v <= 19) return TEENS[v];
    return (TENS[+text[0]] || '') + getDigit(text[1]);
  }
  function getHundreds(num) {
    if (parseInt(num, 10) === 0) return '';
    num = ('000' + num).slice(-3);
    let r = '';
    if (num[0] !== '0') r = getDigit(num[0]) + ' Hundred ';
    r += (num[1] !== '0') ? getTens(num.slice(1)) : getDigit(num[2]);
    return r;
  }
  /** The pesos words, spacing quirks intact. */
  function spellPesos(whole) {
    let words = '', count = 1;
    whole = String(whole);
    while (whole) {
      const t = getHundreds(whole.slice(-3));
      if (t) words = t + PLACE[count] + words;
      whole = whole.length > 3 ? whole.slice(0, -3) : '';
      count++;
    }
    return words || 'No Pesos';
  }
  /**
   * House style: "<WORDS> PESOS ONLY" / "<WORDS> PESOS & <WORDS> CENTS ONLY".
   * Verified against the 43 resolutions in bac res/2026 — including the doubled
   * spaces, which appear in 15 of them. The cents words ARE trimmed ("FORTY CENTS",
   * not "FORTY  CENTS"); only the pesos portion keeps the quirk.
   */
  function amountInWords(value) {
    const s = Number(value).toFixed(2);
    const [whole, cents] = s.split('.');
    const words = spellPesos(whole);
    const c = parseInt(cents, 10);
    if (!c) return (words + ' Pesos Only').toUpperCase();
    const cw = getTens(cents).trim();
    return (words + ' Pesos & ' + cw + (c === 1 ? ' Cent Only' : ' Cents Only')).toUpperCase();
  }

  /* ---- dates ------------------------------------------------------------ */
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  const pad2 = n => String(n).padStart(2, '0');
  const D = v => (v instanceof Date ? new Date(v.getTime()) : new Date(v + 'T00:00:00'));
  /** "July 09, 2026" — zero-padded, the form used everywhere but the signing line. */
  const longDate = v => { const d = D(v); return `${MONTHS[d.getMonth()]} ${pad2(d.getDate())}, ${d.getFullYear()}`; };
  /** "September 4, 2026" — un-padded, used in the witness letters' schedule lines. */
  const letterDate = v => { const d = D(v); return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; };
  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  /** "this 21st day of July, 2026" — the resolution's own signing line. */
  const signingDate = v => { const d = D(v); return `this ${ordinal(d.getDate())} day of ${MONTHS[d.getMonth()]}, ${d.getFullYear()}`; };
  const addDays = (v, n) => { const d = D(v); d.setDate(d.getDate() + n); return d; };  // D() copies, so the input is never mutated
  const iso = v => { const d = D(v); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
  const shortDate = v => { const d = D(v); return `${pad2(d.getDate())}-${MONTHS[d.getMonth()].slice(0, 3)}-${String(d.getFullYear()).slice(-2)}`; };

  /* ---- working days ----------------------------------------------------- */
  // Regular Philippine holidays. Special non-working days are proclaimed with little
  // notice, so this is a starting point the user can extend — never an authority.
  const HOLIDAYS = {
    2026: ['2026-01-01', '2026-04-02', '2026-04-03', '2026-04-09', '2026-05-01',
      '2026-06-12', '2026-08-31', '2026-11-30', '2026-12-25', '2026-12-30'],
    2027: ['2027-01-01', '2027-04-09', '2027-05-01', '2027-06-12', '2027-08-30',
      '2027-11-30', '2027-12-25', '2027-12-30'],
  };
  const holidaySet = extra => new Set([].concat(...Object.values(HOLIDAYS), extra || []));
  const isWorkingDay = (d, hs) => d.getDay() !== 0 && d.getDay() !== 6 && !hs.has(iso(d));
  function workingDays(start, count, hs, includeStart) {
    const out = [];
    let cur = includeStart ? D(start) : addDays(start, 1);
    while (out.length < count) {
      if (isWorkingDay(cur, hs)) out.push(new Date(cur));
      cur = addDays(cur, 1);
    }
    return out;
  }
  /** "September 18 & September 21-22, 2026" — runs hyphenated, groups joined by &. */
  function formatSpan(days) {
    if (!days.length) return '';
    const groups = [[days[0]]];
    for (let i = 1; i < days.length; i++) {
      const prev = groups[groups.length - 1];
      if ((days[i] - prev[prev.length - 1]) === 86400000) prev.push(days[i]);
      else groups.push([days[i]]);
    }
    const parts = groups.map(g => {
      const a = g[0], b = g[g.length - 1];
      if (g.length === 1) return `${MONTHS[a.getMonth()]} ${a.getDate()}`;
      if (a.getMonth() === b.getMonth()) return `${MONTHS[a.getMonth()]} ${a.getDate()}-${b.getDate()}`;
      return `${MONTHS[a.getMonth()]} ${a.getDate()}-${MONTHS[b.getMonth()]} ${b.getDate()}`;
    });
    return parts.join(' & ') + ', ' + days[days.length - 1].getFullYear();
  }
  /** Bid evaluation = 2 working days from the opening date; post-qual = the next 3. */
  function deriveSchedule(opening, opts) {
    opts = opts || {};
    const hs = holidaySet(opts.extraHolidays);
    const ev = workingDays(opening, opts.evalDays || 2, hs, true);
    const pq = workingDays(ev[ev.length - 1], opts.postQualDays || 3, hs, false);
    return {
      opening: D(opening), bidEval: ev, postQual: pq,
      bidEvalText: formatSpan(ev), postQualText: formatSpan(pq),
      // The PACC table carries the LAST day of each span, not the range.
      paccRow: [shortDate(opening), shortDate(ev[ev.length - 1]), shortDate(pq[pq.length - 1])],
    };
  }

  /* ---- the 08 July 2026 cutoff ------------------------------------------ */
  const CUTOFF = '2026-07-08';
  /** Governed by the NOTICE date, for both documents — not each document's own date. */
  function cutoffForm(noticeDate) {
    const pre = iso(noticeDate) < CUTOFF;
    return {
      preCutoff: pre,
      noticeSignatory: pre ? 'ALFREDO E. HERNANDEZ' : 'CHRISTIAN B. FELICES',
      noticeTitle: pre ? 'BAC – Chairperson' : 'BAC – Vice Chairperson',
      soLine: pre ? '' : '\t\t\t\t   PROMOTED S.O. NO. 223 S. 2026',
    };
  }

  /* ---- bidders ---------------------------------------------------------- */
  const NUMWORD = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT'];
  const bidCount = n => `${NUMWORD[n] || n} (${n})`;
  const money = v => Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const variance = (abc, calc) => (((abc - calc) / abc) * 100).toFixed(3) + ' %';
  // Deliberate padding in the bid tables, carried over from the templates.
  const asReadCell = v => 'Php' + ' '.repeat(14) + money(v);
  const asCalcCell = v => 'Php' + ' '.repeat(11) + money(v);

  /** Winner = lowest calculated bid among bidders that passed. */
  function pickWinner(bidders) {
    const ok = bidders.filter(b => b.status === 'passed' && b.asCalculated != null);
    if (!ok.length) return null;
    return ok.reduce((a, b) => (Number(b.asCalculated) < Number(a.asCalculated) ? b : a));
  }
  /** True when a lower bid than the winner's was disqualified at post-qualification. */
  function isSecondLowest(bidders, winner) {
    return bidders.some(b => b.status === 'disqualified' && b.asCalculated != null &&
      Number(b.asCalculated) < Number(winner.asCalculated));
  }

  const api = { spellPesos, amountInWords, getTens, MONTHS, longDate, letterDate, signingDate,
    shortDate, ordinal, addDays, iso, HOLIDAYS, holidaySet, isWorkingDay, workingDays,
    formatSpan, deriveSchedule, CUTOFF, cutoffForm, bidCount, money, variance,
    asReadCell, asCalcCell, pickWinner, isSecondLowest, NUMWORD };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.rules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
