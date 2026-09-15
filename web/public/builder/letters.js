/* letters.js — fill the four Invitation-to-Bid witness letters.
 *
 * The three prose letters are identical below the addressee block, but the block is
 * 4, 5 and 6 lines long respectively, so the same content sits at a different index
 * in each file. Everything here locates paragraphs by their text.
 */
(function (root) {
  'use strict';
  const K = root.docxkit || (typeof require !== 'undefined' && require('./docxkit.js'));
  const R = root.rules || (typeof require !== 'undefined' && require('./rules.js'));

  const P = t => ({ text: t, underline: false });
  const HALL = '10:00 A.M., CCDEO Conference Hall';
  const DATE_ONLY = /^\s*[A-Z][a-z]+ \d{1,2}, \d{4}\s*$/;

  // The label padding is copied from the existing letters; it is manual alignment,
  // not a tab stop, which is why it is spelled out rather than computed.
  const SCHEDULE = [
    ['PRE-BID CONFERENCE', 'PRE-BID CONFERENCE                - '],
    ['DEADLINE OF RECEIPT OF BIDS', 'DEADLINE OF RECEIPT OF BIDS  - '],
    ['OPENING OF BIDS', 'OPENING OF BIDS \t                 - '],
    ['BID EVALUATION', 'BID EVALUATION                         - '],
    ['POST QUALIFICATION', 'POST QUALIFICATION                - '],
  ];

  /** "along **Mananga River**, Cebu City" -> segments, the ** marking bold. */
  function boldParts(text) {
    return String(text || '').split('**')
      .map((chunk, i) => ({ text: chunk, bold: i % 2 === 1 }))
      .filter(s => s.text !== '');
  }

  function setLetterDate(doc, text) {
    const i = K.findParaRe(doc, DATE_ONLY);
    if (i < 0) throw new Error('no letter-date paragraph found');
    K.setRuns(doc, K.paragraphs(doc)[i], [P(text)]);
  }

  /** One List Paragraph per contract: ID bold, location bold, ABC italic at the right. */
  function contractLineParts(c, tabs) {
    const parts = [{ text: 'Contract ID No. ' }, { text: c.id + ' ', bold: true }];
    const body = '– ' + (c.description ? c.description + ': ' : '') + c.name;
    for (const s of boldParts(body)) parts.push({ text: s.text, bold: s.bold || undefined });
    parts.push({ text: ' ' });
    parts.push({ text: '\t'.repeat(tabs) + '          ' });
    parts.push({ text: 'ABC: ' + c.abc, italic: true });
    return parts;
  }

  /** Rough tab count so ABC lands near the right margin; the user nudges it in Word. */
  function tabsFor(c) {
    const len = ('Contract ID No. ' + c.id + ' – ' +
      (c.description ? c.description + ': ' : '') + c.name).replace(/\*\*/g, '').length;
    const intoLine = len % 95;                    // ~95 characters fit on a line
    return Math.max(1, Math.min(20, Math.round((95 - intoLine) / 7)));
  }

  function buildProse(pkg, cfg) {
    const doc = pkg.body;
    setLetterDate(doc, cfg.letterDate);

    const ci = K.findPara(doc, 'Contract ID No.');
    if (ci < 0) throw new Error('no contract line found in this letter');
    const base = K.paragraphs(doc)[ci];
    const donor = K.runsOf(base)[0];
    K.setRuns(doc, base, contractLineParts(cfg.contracts[0], tabsFor(cfg.contracts[0])), donor);
    let prev = base;
    for (let k = 1; k < cfg.contracts.length; k++) {
      prev = K.setRuns(doc, K.cloneParaAfter(prev),
        contractLineParts(cfg.contracts[k], tabsFor(cfg.contracts[k])), donor);
    }
    // A previous batch with more contracts leaves spare lines behind; clear them.
    let extra = K.findPara(doc, 'Contract ID No.', K.paragraphs(doc).indexOf(prev) + 1);
    while (extra >= 0) {
      K.blankPara(K.paragraphs(doc)[extra]);
      extra = K.findPara(doc, 'Contract ID No.', extra + 1);
    }

    const s = cfg.sched;
    const values = [
      `${cfg.prebid}, ${HALL}`,
      `${R.letterDate(s.opening)}, ${HALL}`,
      `${R.letterDate(s.opening)}, ${HALL}`,
      s.bidEvalText,
      s.postQualText + '                             ',
    ];
    SCHEDULE.forEach(([needle, prefix], i) => {
      const idx = K.findPara(doc, needle);
      if (idx < 0) throw new Error('schedule line not found: ' + needle);
      K.setRuns(doc, K.paragraphs(doc)[idx], [P(prefix + values[i])]);
    });
  }

  function buildPacc(pkg, cfg) {
    const doc = pkg.body;
    setLetterDate(doc, cfg.letterDate);
    const tbl = K.tables(doc)[0];
    if (!tbl) throw new Error('the PACC letter has no schedule table');
    const rows = K.fitRows(tbl, cfg.contracts.length, 1);
    rows.forEach((tr, i) => {
      const c = cfg.contracts[i], cells = K.cellsOf(tr);
      const parts = [{ text: c.id + ' ', bold: true }]
        .concat(boldParts('– ' + (c.shortName || c.name))
          .map(s => ({ text: s.text, bold: s.bold || undefined })));
      K.setCell(doc, cells[0], parts);
      // The table carries the LAST day of each span, not the range.
      cfg.sched.paccRow.forEach((v, j) => K.setCell(doc, cells[j + 1], [P(v)]));
    });
  }

  const api = { buildProse, buildPacc, boldParts, contractLineParts, tabsFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.letterBuilders = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
