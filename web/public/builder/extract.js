/* extract.js — pull contract data out of the files Jayz actually receives.
 *
 * His abstracts are always scans: zero extractable text, one image per page. So OCR
 * is the primary path, not a fallback, and everything here is built around the fact
 * that OCR gets some characters wrong. Three defences:
 *
 *   1. Two OCR passes with different settings. One reads highlighted contract IDs,
 *      the other reads bold figures in table cells; neither reads both. Their word
 *      lists are merged.
 *   2. Lines are rebuilt from word coordinates, not from tesseract's reading order.
 *      The abstract is a table — flattening it loses which amount belongs to which
 *      bidder.
 *   3. Every field carries a confidence. Where the printed % variance agrees with
 *      (ABC - as calculated) / ABC, the two figures prove each other and are marked
 *      confirmed; everything else stays flagged for a human to read against the
 *      cropped image the UI shows beside it.
 *
 * Nothing here decides anything. It proposes values; the review table disposes.
 */
(function (root) {
  'use strict';

  const CID_RE = /\b(\d{2}HH\d{4})\b/g;        // global: only for matchAll
  const CID_ONE = /\b\d{2}HH\d{4}\b/;          // non-global: safe for .test()
  const MONEY_RE = /\d{1,3}(?:[,\s]\d{3})*\.\d{2}/g;
  const PCT_RE = /(\d{1,3}\.\d{1,3})\s*%/g;
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
    'august', 'september', 'october', 'november', 'december'];
  const MONTH_RE = new RegExp('\\b(' + MONTHS.join('|') + ')\\b', 'i');

  const pad2 = n => String(n).padStart(2, '0');
  /** OCR inserts spaces inside figures ("23, 187,838.39"); strip them before parsing. */
  const num = s => {
    const v = Number(String(s).replace(/[^0-9.]/g, ''));
    return Number.isFinite(v) && v !== 0 ? v : null;
  };

  /* ---- repairing what OCR gets wrong ------------------------------------- */

  // Confusions seen on Jayz's own scans: 26HH0070 read as "2610070" (H->1, H->0)
  // and, where the ID is highlighted, as bare "070".
  const DIGIT_FIX = { O: '0', o: '0', Q: '0', D: '0', I: '1', l: '1', i: '1', S: '5', s: '5', B: '8', Z: '2', G: '6' };

  /**
   * Coerce an OCR token towards a contract ID, or return null.
   * `hint` is a year prefix seen elsewhere in the batch, used to restore a
   * highlighted prefix that OCR dropped entirely.
   */
  function repairContractId(raw, hint) {
    if (!raw) return null;
    let s = String(raw).toUpperCase().replace(/[^0-9A-Z]/g, '');
    const direct = s.match(/\d{2}HH\d{4}/);
    if (direct) return direct[0];
    // HH misread as digits/letters: 2610070, 26HHOO70, 26NN0070 ...
    let m = s.match(/^(\d{2})[A-Z0-9]{2}(\d{4})$/);
    if (m) return `${m[1]}HH${m[2]}`;
    m = s.match(/^(\d{2})HH([0-9A-Z]{4})$/);
    if (m) {
      const tail = m[2].split('').map(c => DIGIT_FIX[c] || c).join('');
      if (/^\d{4}$/.test(tail)) return `${m[1]}HH${tail}`;
    }
    // a bare trailing number, e.g. "070" where the highlight ate the prefix
    if (hint && /^\d{3,4}$/.test(s)) return `${hint}HH${s.padStart(4, '0')}`;
    return null;
  }

  function toISO(text) {
    if (text == null) return null;
    const s = String(text);
    const m = s.match(new RegExp(MONTH_RE.source + '\\s+([0-9OSIlB]{1,2})\\s*,?\\s*(\\d{4})', 'i'));
    if (m) {
      const mo = MONTHS.indexOf(m[1].toLowerCase()) + 1;
      const day = parseInt(m[2].split('').map(c => DIGIT_FIX[c] || c).join(''), 10);
      if (day >= 1 && day <= 31) return `${m[3]}-${pad2(mo)}-${pad2(day)}`;
    }
    const d = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (d) return `${d[1]}-${d[2]}-${d[3]}`;
    const sl = s.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
    if (sl) {
      const y = sl[3].length === 2 ? '20' + sl[3] : sl[3];
      return `${y}-${pad2(+sl[1])}-${pad2(+sl[2])}`;   // M/D/Y; ambiguous, flagged upstream
    }
    const n = Number(text);                            // Excel serial
    if (n > 30000 && n < 60000) {
      const dt = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
      return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
    }
    return null;
  }

  /* ---- reading words out of a Tesseract result ---------------------------
   * Tesseract.js v5 does NOT populate the page-level `data.words`, despite its own
   * type definitions still advertising it. Words live under
   *   data.blocks[].paragraphs[].lines[].words[]
   * Older versions do expose `data.words`, and `data.tsv` is produced by default in
   * every version, so all three are handled — the shape varies by version and this
   * is not worth being brittle about.
   */
  function wordsFrom(data) {
    if (!data) return [];
    if (Array.isArray(data.blocks) && data.blocks.length) {
      const out = [];
      for (const bl of data.blocks || []) {
        for (const par of (bl && bl.paragraphs) || []) {
          for (const ln of (par && par.lines) || []) {
            for (const w of (ln && ln.words) || []) {
              if (w && w.text && String(w.text).trim()) out.push(w);
            }
          }
        }
      }
      if (out.length) return out;
    }
    if (Array.isArray(data.words) && data.words.length) return data.words;
    if (typeof data.tsv === 'string' && data.tsv) return wordsFromTSV(data.tsv);
    return [];
  }

  /** Tesseract's TSV: level, ..., left, top, width, height, conf, text (12 columns). */
  function wordsFromTSV(tsv) {
    const out = [];
    for (const row of tsv.split('\n')) {
      const f = row.split('\t');
      if (f.length < 12 || f[0] !== '5') continue;          // level 5 = word
      const text = f[11];
      if (!text || !text.trim()) continue;
      const left = +f[6], top = +f[7], width = +f[8], height = +f[9];
      if (!Number.isFinite(left) || !Number.isFinite(top)) continue;
      out.push({ text, conf: parseFloat(f[10]),
                 bbox: { x0: left, y0: top, x1: left + width, y1: top + height } });
    }
    return out;
  }

  /* ---- turning word boxes into lines ------------------------------------- */

  /**
   * Group OCR words into visual lines by vertical position, then order each line
   * left to right. `scale` normalises passes rendered at different resolutions so
   * their coordinates can be compared.
   */
  function linesFromWords(words, opts) {
    opts = opts || {};
    const scale = opts.scale || 1;
    const tol = opts.tol || 10;
    const w = words
      .filter(x => String(x.text).trim() && (x.conf === undefined || x.conf > (opts.minConf ?? -1)))
      .map(x => ({
        text: String(x.text).trim(),
        x: (x.bbox ? x.bbox.x0 : x.x0) / scale,
        y: (x.bbox ? (x.bbox.y0 + x.bbox.y1) / 2 : x.y0) / scale,
      }))
      .sort((a, b) => a.y - b.y);
    const lines = [];
    for (const word of w) {
      const line = lines.find(L => Math.abs(L.y - word.y) <= tol);
      if (line) { line.words.push(word); line.y = (line.y + word.y) / 2; }
      else lines.push({ y: word.y, words: [word] });
    }
    return lines
      .sort((a, b) => a.y - b.y)
      .map(L => {
        const ws = L.words.sort((a, b) => a.x - b.x);
        return { y: L.y, words: ws, text: ws.map(x => x.text).join(' ') };
      });
  }

  /**
   * Find dates in a word sequence, tolerating interleaved noise.
   * OCR reads the abstract's centred heading as
   *   "ABSTRACT OF BID AS CALCULATED Date Prepared: (AFTER June 19, THE 2026 ..."
   * so "June 19, 2026" is not contiguous. Scan for a month, then the next
   * plausible day, then the next 4-digit year, skipping whatever sits between.
   */
  function datesFromWords(words) {
    const out = [];
    for (let i = 0; i < words.length; i++) {
      const mo = MONTHS.indexOf(String(words[i].text).replace(/[^A-Za-z]/g, '').toLowerCase());
      if (mo < 0) continue;
      let day = null, year = null, dayIdx = -1;
      for (let j = i + 1; j < Math.min(i + 6, words.length); j++) {
        const raw = String(words[j].text);
        // OCR sometimes drops the space after the comma, fusing day and year into
        // one token ("July 08,2026"). Split it before anything else.
        const fused = raw.match(/^([0-9OSIlBZG]{1,2})\s*,\s*([0-9]{4})$/);
        if (day === null && fused) {
          const d = +fused[1].split('').map(c => DIGIT_FIX[c] || c).join('');
          if (d >= 1 && d <= 31) { day = d; dayIdx = j; year = +fused[2]; break; }
        }
        const t = raw.replace(/[^0-9OSIlBZG]/g, '');
        if (!t) continue;
        const fixed = t.split('').map(c => DIGIT_FIX[c] || c).join('');
        if (day === null && /^\d{1,2}$/.test(fixed) && +fixed >= 1 && +fixed <= 31) { day = +fixed; dayIdx = j; continue; }
        if (day !== null && /^\d{4}$/.test(fixed) && +fixed > 2000 && +fixed < 2100) { year = +fixed; break; }
      }
      if (day !== null && year !== null) {
        out.push({ x: words[i].x, iso: `${year}-${pad2(mo + 1)}-${pad2(day)}`,
                   raw: words.slice(i, dayIdx + 1).map(w => w.text).join(' ') });
        i = dayIdx;
      }
    }
    return out;
  }

  /** Merge two OCR passes: neither reads everything, together they read more. */
  function mergePasses(passA, passB) {
    const A = linesFromWords(passA.words, { scale: passA.scale || 1 });
    const B = linesFromWords(passB.words, { scale: passB.scale || 1 });
    const out = A.slice();
    for (const b of B) {
      const near = out.find(a => Math.abs(a.y - b.y) <= 12);
      if (!near) { out.push(b); continue; }
      // Pass A keeps the geometry — it is the higher-resolution render and its word
      // boxes are what the column logic depends on. Pass B contributes text only,
      // as `alt`, so string lookups can see both readings without the two passes'
      // words interleaving into nonsense.
      near.alt = (near.alt ? near.alt + ' ' : '') + b.text;
      // Keep pass B's word boxes too. Both passes are scaled to PDF points, so
      // their x values are comparable — and pass B sometimes reads a column that
      // pass A misses entirely (it was the only pass to see "Power Move Builders").
      near.altWords = (near.altWords || []).concat(b.words);
    }
    return out.sort((a, b) => a.y - b.y);
  }
  const searchable = L => (L.text + ' ' + (L.alt || ''));

  /* ---- rendering a PDF page for OCR -------------------------------------- */

  /** True when the PDF carries real text — his don't, but a digital one might. */
  async function hasTextLayer(arrayBuffer, pdfjsLib) {
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
    let chars = 0;
    for (let i = 1; i <= Math.min(pdf.numPages, 3); i++) {
      const tc = await (await pdf.getPage(i)).getTextContent();
      chars += tc.items.reduce((n, it) => n + it.str.trim().length, 0);
    }
    return chars > 100;
  }

  async function pdfPageCanvas(pdf, pageNo, scale) {
    const page = await pdf.getPage(pageNo);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return canvas;
  }

  /** The text-layer path, for the rare digital abstract. */
  async function pdfTextPages(arrayBuffer, pdfjsLib) {
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const tc = await (await pdf.getPage(i)).getTextContent();
      const words = tc.items.filter(it => it.str.trim()).map(it => ({
        text: it.str, bbox: { x0: it.transform[4], y0: -it.transform[5], x1: it.transform[4], y1: -it.transform[5] },
      }));
      pages.push({ lines: linesFromWords(words, { tol: 3 }), source: 'text' });
    }
    return pages;
  }

  /**
   * The OCR path. Two passes per page:
   *   A — 400dpi, default segmentation: reads bold figures inside table cells
   *   B — 300dpi greyscale, single-block: reads highlighted contract IDs
   * Verified on Jayz's own abstract, where neither pass alone found both.
   */
  async function pdfOcrPages(arrayBuffer, pdfjsLib, Tesseract, onProgress) {
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
    const worker = await Tesseract.createWorker('eng');
    const pages = [];
    try {
      for (let i = 1; i <= pdf.numPages; i++) {
        if (onProgress) onProgress(i, pdf.numPages);
        const big = await pdfPageCanvas(pdf, i, 400 / 72);
        const small = await pdfPageCanvas(pdf, i, 300 / 72);
        await worker.setParameters({ tessedit_pageseg_mode: '3' });
        const a = await worker.recognize(big);
        await worker.setParameters({ tessedit_pageseg_mode: '6' });
        const b = await worker.recognize(small);
        const wa = wordsFrom(a.data), wb = wordsFrom(b.data);
        if (!wa.length && !wb.length && onProgress) onProgress(i, pdf.numPages, 'no text recognised on this page');
        pages.push({
          lines: mergePasses({ words: wa, scale: 400 / 72 },
                             { words: wb, scale: 300 / 72 }),
          canvas: big, source: 'ocr',
        });
      }
    } finally { await worker.terminate(); }
    return pages;
  }

  /* ---- the abstract ------------------------------------------------------ */

  const LABEL = {
    abc: /approved budget|^\s*abc\b/i,
    opening: /opening of bids/i,
    prepared: /date prepared/i,
    name: /contract name/i,
    location: /location of the contract/i,
    asRead: /bid as read/i,
    asCalc: /bid as calculated/i,
    remarks: /^\s*remarks/i,
  };

  /**
   * Parse one batch of pages into contracts.
   * The abstract runs a cover page then a bid-table page per contract, so pages are
   * grouped by the contract ID found on them rather than assumed to pair up.
   */
  function parseAbstract(pages) {
    // A year prefix seen anywhere helps repair IDs whose highlight ate the prefix.
    let hint = null;
    for (const pg of pages) {
      for (const L of pg.lines) {
        const m = searchable(L).match(CID_ONE);
        if (m) { hint = m[0].slice(0, 2); break; }
      }
      if (hint) break;
    }

    const byId = new Map();
    pages.forEach((pg, idx) => {
      const id = pageContractId(pg, hint);
      if (!id) return;
      if (!byId.has(id)) byId.set(id, { id, pages: [] });
      byId.get(id).pages.push(Object.assign({ index: idx }, pg));
    });

    return [...byId.values()].map(g => buildContract(g.id, g.pages));
  }

  function pageContractId(pg, hint) {
    for (const L of pg.lines) {
      if (!/contract\s*id/i.test(searchable(L))) continue;
      const after = searchable(L).replace(/.*contract\s*id\s*[:.\s]*/i, '');
      for (const tok of after.split(/\s+/)) {
        const id = repairContractId(tok, hint);
        if (id) return id;
      }
    }
    for (const L of pg.lines) {                    // anywhere on the page
      const m = searchable(L).match(CID_ONE);
      if (m) return m[0];
    }
    return null;
  }

  function labelled(lines, re) {
    for (const L of lines) if (re.test(searchable(L))) return L;
    return null;
  }

  function buildContract(id, pgs) {
    const all = [].concat(...pgs.map(p => p.lines));
    const conf = {};                                // per-field confidence notes
    const flag = (f, why) => { conf[f] = { ok: false, why }; };
    const ok = (f, why) => { conf[f] = { ok: true, why: why || 'read cleanly' }; };

    // ABC — the last money figure on the "Approved Budget" line
    let abc = null;
    const abcLine = labelled(all, LABEL.abc);
    if (abcLine) {
      const m = searchable(abcLine).match(MONEY_RE);
      if (m) { abc = num(m[m.length - 1]); ok('abc'); }
    }
    if (!abc) flag('abc', 'no Approved Budget figure found');

    // dates
    const openLine = labelled(all, LABEL.opening);
    const prepLine = labelled(all, LABEL.prepared);
    const openingDate = openLine ? (datesFromWords(openLine.words)[0] || {}).iso || toISO(searchable(openLine)) : null;
    const asCalcDate = prepLine ? (datesFromWords(prepLine.words)[0] || {}).iso || toISO(searchable(prepLine)) : null;
    // OCR reliably mangles day digits ("June 08" -> "June OS"), so dates are never
    // presented as confirmed, even when they parse.
    flag('openingDate', openingDate ? 'OCR date — confirm against the image' : 'not found');
    flag('asCalcDate', asCalcDate ? 'OCR date — confirm against the image' : 'not found');

    // contract name / location: the label sits in one column, the text in another,
    // and the two wrap across both lines, so take everything after the label.
    const nameLine = labelled(all, LABEL.name);
    const locLine = labelled(all, LABEL.location);
    let contractName = '';
    if (nameLine) contractName = searchable(nameLine).replace(/.*contract name\s*[:;.\s]*/i, '').trim();
    if (locLine) {
      const tail = searchable(locLine).replace(/.*location of the contract\s*[:;»,.\s]*/i, '').trim();
      if (tail && tail.length > 12) contractName = (contractName + ' ' + tail).trim();
    }
    contractName = contractName.replace(/\s+/g, ' ').trim();
    contractName ? ok('contractName', 'OCR text — check spelling') : flag('contractName', 'not found');

    const bidders = parseBidders(pgs, abc, conf);
    return {
      contractId: id, contractName, location: 'Cebu City', abc,
      openingDate, asCalcDate, noticeDate: null, adDate: null,
      bidders, _confidence: conf, _source: pgs[0] && pgs[0].source,
      _pageIndexes: pgs.map(p => p.index),
    };
  }

  /**
   * Bidder columns. Names sit above the figures in the header row, so each bidder
   * is a column identified by its x-range; the as-read, as-calculated, variance and
   * remarks values are the tokens falling within that range on the matching rows.
   */
  function parseBidders(pgs, abc, conf) {
    const tablePage = pgs.find(p => labelled(p.lines, LABEL.asRead)) || pgs[pgs.length - 1];
    if (!tablePage) { conf.bidders = { ok: false, why: 'no bid table page' }; return []; }
    const lines = tablePage.lines;

    const readLine = labelled(lines, LABEL.asRead);
    const calcLine = labelled(lines, LABEL.asCalc);
    const remarkLine = labelled(lines, LABEL.remarks);
    const pctLine = lines.find(L => (searchable(L).match(PCT_RE) || []).length >= 1 &&
      !/variance/i.test(searchable(L)));

    // column anchors: money tokens on the as-read row
    const money = (L) => !L ? [] : L.words
      .map((w, i) => ({ w, i }))
      .filter(o => /\d\.\d{2}$|^\d{1,3}([,\s]\d{3})*\.\d{2}$/.test(o.w.text) || /^\d{1,3},$/.test(o.w.text))
      .map(o => o.w);

    // Recombine figures OCR split across tokens ("23," + "187,838.39").
    const figures = (L) => {
      if (!L) return [];
      const out = []; let buf = null;
      // OCR splits figures after a comma, and not always after the first group:
      // "23,187,838.39" arrives as ["23,", "187,838.39"] and "23,367,735.00" as
      // ["23,367,", "735.00"]. Accumulate any comma-terminated prefix.
      for (const w of L.words) {
        const t = w.text;
        if (/^\d{1,3}(?:,\d{3})*,$/.test(t)) { buf = { x: (buf || w).x, text: (buf ? buf.text : '') + t }; continue; }
        if (buf && /^\d{1,3}(?:,\d{3})*\.\d{2}$|^\d{3}\.\d{2}$/.test(t)) {
          out.push({ x: buf.x, text: buf.text + t }); buf = null; continue;
        }
        buf = null;
        if (/^\d{1,3}(?:[,\s]?\d{3})*\.\d{2}$/.test(t)) out.push({ x: w.x, text: t });
      }
      return out;
    };

    const reads = figures(readLine);
    const calcs = figures(calcLine);
    const pcts = pctLine ? pctLine.words.filter(w => /^\d{1,3}\.\d{1,3}%?$/.test(w.text)).map(w => ({ x: w.x, text: w.text })) : [];

    // Bidder names: the block of lines above the as-read row, grouped into columns.
    const headerY = readLine ? readLine.y : (lines[0] || {}).y;
    const nameWords = [];
    for (const L of lines) {
      if (L.y >= headerY - 4) continue;
      if (/contract|department|sheet|location|convergence|buildings/i.test(searchable(L))) continue;
      for (const w of L.words.concat(L.altWords || []))
        if (/[A-Za-z]{2}/.test(w.text)) nameWords.push(w);
    }
    // The two passes often read the same word; drop near-duplicates so a column's
    // fragment is not doubled.
    const dedup = [];
    for (const w of nameWords.sort((a, b) => a.x - b.x)) {
      if (!dedup.some(d => d.text.toLowerCase() === w.text.toLowerCase() && Math.abs(d.x - w.x) < 25)) dedup.push(w);
    }
    nameWords.length = 0; nameWords.push(...dedup);
    const anchors = (reads.length ? reads : calcs).map(f => f.x);
    const names = anchors.map((ax, i) => {
      const lo = i === 0 ? ax - 220 : (anchors[i - 1] + ax) / 2;
      const hi = i === anchors.length - 1 ? ax + 220 : (anchors[i + 1] + ax) / 2;
      const ws = nameWords.filter(w => w.x >= lo - 60 && w.x <= hi + 60)
        .sort((a, b) => a.x - b.x);
      return ws.map(w => w.text).join(' ').replace(/\s+/g, ' ').trim();
    });

    const near = (arr, x) => {
      let best = null, d = 1e9;
      for (const a of arr) { const dd = Math.abs(a.x - x); if (dd < d) { d = dd; best = a; } }
      return d < 200 ? best : null;
    };

    const out = anchors.map((x, i) => {
      const asRead = num((reads[i] || {}).text);
      const c = near(calcs, x);
      // When OCR could not read the as-calculated row at all, fall back to the
      // as-read figure — true for every contract seen so far, but an assumption,
      // so it is recorded as one. The variance check confirms or refutes it.
      const asCalculated = c ? num(c.text) : asRead;
      const calcAssumed = !c;
      const p = near(pcts, x);
      const printedPct = p ? parseFloat(p.text) : null;
      const rem = remarkLine ? (near(remarkLine.words.map(w => ({ x: w.x, text: w.text })), x) || {}).text : '';
      // A fragment that does not read like a company name is NOT offered as one.
      // An empty field is obviously incomplete; "UW" looks like an awardee and
      // would sail into a resolution as one.
      const raw = names[i] || '';
      const plausible = raw.replace(/[^A-Za-z]/g, '').length >= 6 && raw.trim().split(/\s+/).length >= 2;
      return {
        name: plausible ? raw : '', houseName: '', _nameFragment: raw,
        asRead, asCalculated,
        status: /fail|ineligib|disqualif/i.test(rem || '') ? 'failed' : 'passed',
        remarks: rem && /^[A-Za-z]/.test(rem) ? rem : 'Passed',
        _printedVariance: printedPct, _calcAssumed: calcAssumed, _x: x,
        _nameOK: false,          // set only by identifyBidders, on a directory match
      };
    }).filter(b => b.asRead || b.asCalculated);

    if (!out.length) conf.bidders = { ok: false, why: 'no bid figures read — type them from the image' };
    else conf.bidders = { ok: true, why: `${out.length} column(s) read` };
    return out;
  }

  /* ---- identifying the bidder ------------------------------------------- */

  /**
   * OCR cannot reliably read the bidder names on these scans — the winner's name
   * is highlighted, and one page yielded only "UW — a a ee" for VSP Structure
   * Ventures Corp. But the name does not need to be *read*, only *identified*:
   * there are fewer than a hundred contractors the office deals with, so match
   * whatever fragments OCR did produce against the known directory.
   *
   * This is stronger than reading the name, because a match also supplies the
   * uppercase house-style form the resolution tables need.
   */
  const tokens = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/).filter(t => t.length > 2 &&
      !['and','the','construction','const','corporation','corp','inc','supply',
        'development','devt','builders','services','company','ventures'].includes(t));

  /** Score a candidate directory entry against an OCR fragment. */
  function scoreName(fragment, entry) {
    const f = new Set(tokens(fragment));
    if (!f.size) return 0;
    const e = tokens((entry.company || '') + ' ' + (entry.houseName || ''));
    if (!e.length) return 0;
    let hit = 0;
    for (const t of e) {
      if (f.has(t)) { hit += 1; continue; }
      for (const ft of f) if (ft.length > 3 && (ft.startsWith(t.slice(0, 4)) || t.startsWith(ft.slice(0, 4)))) { hit += 0.6; break; }
    }
    return hit / Math.max(e.length, 1);
  }

  /**
   * Rank directory entries against a fragment. `directory` is the app's contractor
   * map; entries need `company` and optionally `houseName`.
   */
  function matchContractor(fragment, directory, limit) {
    const scored = Object.entries(directory || {})
      .filter(([k]) => k !== '_meta')
      .map(([key, v]) => ({ key, company: v.company, houseName: v.houseName || '', score: scoreName(fragment, v) }))
      .filter(c => c.score > 0.25)
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, limit || 3);
  }

  /**
   * Attach identification to each bidder: the whole name band is searched rather
   * than one column, because the two OCR passes interleave the columns' words.
   * A confident single match fills the name and house name; anything ambiguous is
   * left for the review table's picker.
   */
  function identifyBidders(contract, pages, directory) {
    const tablePage = pages.find(p => p.lines.some(L => LABEL.asRead.test(searchable(L)))) || pages[pages.length - 1];
    if (!tablePage) return contract;
    const readLine = tablePage.lines.find(L => LABEL.asRead.test(searchable(L)));

    // Name words come from pass A only. Pass B's text helps string lookups but its
    // words carry different coordinates, and mixing the two scrambles the columns.
    const nameWords = [];
    for (const L of tablePage.lines) {
      if (readLine && L.y >= readLine.y - 4) continue;
      if (/contract|department|sheet|location|convergence|buildings|facilities|highways/i.test(L.text)) continue;
      for (const w of L.words.concat(L.altWords || []))
        if (/[A-Za-z]{2}/.test(w.text)) nameWords.push(w);
    }
    // The two passes often read the same word; drop near-duplicates so a column's
    // fragment is not doubled.
    const dedup = [];
    for (const w of nameWords.sort((a, b) => a.x - b.x)) {
      if (!dedup.some(d => d.text.toLowerCase() === w.text.toLowerCase() && Math.abs(d.x - w.x) < 25)) dedup.push(w);
    }
    nameWords.length = 0; nameWords.push(...dedup);

    // Each bidder is a column. Slice the name words by the x midpoints between the
    // figure anchors so one bidder cannot claim another's name.
    const xs = contract.bidders.map(b => b._x).filter(x => x != null);
    const used = new Set();
    contract.bidders.forEach((b, i) => {
      let fragment = b.name || '';
      if (xs.length === contract.bidders.length) {
        const lo = i === 0 ? xs[i] - 260 : (xs[i - 1] + xs[i]) / 2;
        const hi = i === xs.length - 1 ? xs[i] + 260 : (xs[i] + xs[i + 1]) / 2;
        fragment = nameWords.filter(w => w.x >= lo && w.x <= hi)
          .sort((a, b2) => a.x - b2.x).map(w => w.text).join(' ');
      }
      b._nameFragment = fragment.replace(/\s+/g, ' ').trim();
      const pool = matchContractor(b._nameFragment, directory, 4).filter(c => !used.has(c.key));
      b._candidates = pool;
      if (pool.length && pool[0].score > 0.55 && (pool.length === 1 || pool[0].score - pool[1].score > 0.15)) {
        used.add(pool[0].key);
        b.name = pool[0].company;
        b.houseName = pool[0].houseName || pool[0].company.toUpperCase();
        b._nameOK = true;
        b._matchedKey = pool[0].key;
      } else {
        b._nameOK = false;
        b.name = '';           // leave it blank for the picker rather than guessing
        b.houseName = '';
      }
    });
    const unnamed = contract.bidders.filter(b => !b._nameOK).length;
    contract._confidence.bidderNames = unnamed
      ? { ok: false, why: `${unnamed} bidder name(s) unreadable — pick from the list` }
      : { ok: true, why: 'matched against the contractor directory' };
    return contract;
  }

  /**
   * The maths check. Where the printed % variance agrees with the figure computed
   * from ABC and the as-calculated bid, the two numbers prove each other — OCR
   * cannot produce that agreement by accident. Those fields become confirmed.
   */
  function crossCheckVariance(contract) {
    const notes = [];
    if (!contract.abc) return notes;
    for (const b of contract.bidders) {
      if (b._printedVariance == null || !b.asCalculated) continue;
      const computed = (contract.abc - b.asCalculated) / contract.abc * 100;
      const agrees = Math.abs(computed - b._printedVariance) < 0.002;
      b._varianceOK = agrees;
      notes.push({
        bidder: b.name || '(unnamed)', agrees,
        computed: computed.toFixed(3), printed: b._printedVariance.toFixed(3),
      });
    }
    const all = contract.bidders.filter(b => b._printedVariance != null);
    if (all.length && all.every(b => b._varianceOK)) {
      contract._confidence.abc = { ok: true, why: 'confirmed — printed variance matches the arithmetic' };
      contract._confidence.bidders = { ok: true, why: 'confirmed — every variance recomputes' };
    }
    return notes;
  }

  /* ---- the date summary photo -------------------------------------------- */

  /**
   * Read the batch date summary. It arrives as a screenshot of a spreadsheet, so
   * rows are found by contract ID and the dates are taken in column order.
   * Every date is returned flagged: OCR misread "June 08" as "June OS" on the
   * real file, and a wrong notice date moves the July 08 cutoff.
   */
  function parseSummary(passA, passB, passC) {
    // Pass C (psm 4 over a 3x upscale) is the only setting that reads all four date
    // columns of this table — the others stop short of the rightmost one. When it is
    // available it is used alone; mixing it with the other passes duplicates rows.
    const lines = (passC && passC.words && passC.words.length)
      ? linesFromWords(passC.words, { scale: passC.scale || 1, tol: 14 })
      : mergePasses(passA, passB || { words: [] });
    const header = lines.find(L => /contract\s*id/i.test(searchable(L)) && /bidder|amount|bidding/i.test(searchable(L)));
    const cols = {};
    if (header) {
      for (const w of header.words) {
        const t = w.text.toLowerCase();
        if (/bidding/.test(t)) cols.opening = w.x;
        else if (/calc/.test(t)) cols.asCalcDate = w.x;
        else if (/eval/.test(t)) cols.bidEvalDate = w.x;
        else if (/qual/.test(t)) cols.noticeDate = w.x;
      }
    }
    // A row's contract ID and its dates do not always land on the same OCR line —
    // one of Jayz's rows split with the ID above the figures. Pair a date-only line
    // with the nearest ID-only line before reading it.
    const idOf = L => {
      const t = searchable(L);
      return (t.match(CID_ONE) || [])[0] ||
        t.split(/\s+/).map(x => repairContractId(x, null)).find(Boolean) || null;
    };
    const rows = [];
    for (const L of lines) {
      if (/contract\s*id.*bidder|lowest bidder/i.test(searchable(L))) continue;   // header
      const id = idOf(L);
      const dates = datesFromWords(L.words);
      if (id && dates.length) { rows.push({ id, L, dates }); continue; }
      if (id && !dates.length) { rows.push({ id, L, dates: [], needsDates: true }); continue; }
      if (!id && dates.length >= 2) {
        const orphan = rows.slice().reverse().find(r => r.needsDates) ||
          rows.slice().reverse().find(r => !r.dates.length);
        if (orphan) { orphan.dates = dates; orphan.L = L; delete orphan.needsDates; }
      }
    }

    const out = {};
    for (const row of rows) {
      const idTok = row.id, L = row.L, dates = row.dates;
      if (!idTok || !dates.length) continue;
      const pick = (key, fallbackIdx) => {
        if (cols[key] != null && dates.length) {
          let best = null, d = 1e9;
          for (const dd of dates) { const g = Math.abs(dd.x - cols[key]); if (g < d) { d = g; best = dd; } }
          if (best && d < 400) return best.iso;
        }
        return dates[fallbackIdx] ? dates[fallbackIdx].iso : null;
      };
      // Post-Qual is the last date on the row. It sets the notice date, the
      // resolution date and the July 08 cutoff, so if it was not read at all say
      // so rather than leaving a silent blank.
      const rec = {
        openingDate: pick('opening', 0),
        asCalcDate: pick('asCalcDate', 1),
        bidEvalDate: pick('bidEvalDate', 2),
        noticeDate: pick('noticeDate', dates.length - 1),
        _ocr: true,
        _datesRead: dates.length,
      };
      if (dates.length < 4) rec._short = `only ${dates.length} of 4 date columns were read`;
      out[idTok] = rec;
    }
    return out;
  }

  /* ---- spreadsheets ------------------------------------------------------ */

  const norm = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

  /**
   * Read any sheet with a header row into {contractId: {...}}.
   * Header wording drifts between batches — his ITB sheet says "Contracts" and
   * "Ad start date", not "Contract ID" — so columns are matched on meaning and
   * an ID is looked for in every cell when no ID column is identified.
   */
  function parseDateSheet(rows) {
    if (!rows || !rows.length) return {};
    let hdr = 0;
    for (let i = 0; i < Math.min(rows.length, 12); i++) {
      if ((rows[i] || []).some(c => /contract|bidding|prep|ad\s*start|advertis/i.test(String(c || '')))) { hdr = i; break; }
    }
    const head = (rows[hdr] || []).map(norm);
    const col = (...keys) => head.findIndex(h => h && keys.some(k => h.includes(k)));
    const iCid = col('contractid', 'contractno', 'contracts', 'contract', 'cid');
    const iOpen = col('bidopening', 'biddingdate', 'openingofbids', 'bidopening', 'opening');
    const iCalc = col('ascalc', 'prepascalc');
    const iEval = col('bideval', 'prepbideval');
    const iPost = col('postqual', 'preppostqual');
    const iAd = col('adstartdate', 'adstart', 'advertis', 'addate', 'itbdate', 'invitation');
    const out = {};
    for (let r = hdr + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      let id = null;
      if (iCid >= 0) id = repairContractId(String(row[iCid] || ''), null);
      if (!id) for (const c of row) { id = repairContractId(String(c || ''), null); if (id) break; }
      if (!id) continue;
      const at = i => (i >= 0 ? toISO(row[i]) : null);
      const rec = { openingDate: at(iOpen), asCalcDate: at(iCalc), bidEvalDate: at(iEval),
                    noticeDate: at(iPost), adDate: at(iAd) };
      out[id] = Object.fromEntries(Object.entries(rec).filter(([, v]) => v));
    }
    return out;
  }

  /* ---- Invitation to Bid ------------------------------------------------- */

  function parseITB(text) {
    const blocks = String(text).split(/(?=\b\d{2}HH\d{4}\b)/).filter(b => CID_ONE.test(b));
    const items = blocks.map(b => {
      const id = (b.match(CID_ONE) || [])[0];
      const monies = b.match(MONEY_RE) || [];
      const abcM = b.match(/(?:ABC|Approved Budget[^:]*)[:\s]*(?:Php|₱)?\s*([\d,]+\.\d{2})/i);
      const cd = b.match(/(\d{2,4})\s*(?:C\.?\s*D\.?|calendar days)/i);
      const docs = b.match(/(?:bidding documents?|cost of bid[^:]*)[:\s]*(?:Php|₱)?\s*([\d,]+(?:\.\d{2})?)/i);
      const name = b.replace(/^\s*\d{2}HH\d{4}\s*[-–:]?\s*/, '').split(/\n/)[0].trim();
      return { id, description: '', name, abc: abcM ? abcM[1] : (monies[0] || ''),
               duration: cd ? cd[1] + ' C.D.' : '', bidDocs: docs ? docs[1] : '',
               _needsReview: !abcM || !name };
    });
    const prebid = (text.match(/pre[- ]?bid[^\n]*/i) || [''])[0];
    const opening = (text.match(/(?:opening of bids|deadline[^\n]*bids)[^\n]*/i) || [''])[0];
    return { items, prebidDate: toISO(prebid), openingDate: toISO(opening) };
  }

  const api = { CID_RE, CID_ONE, MONEY_RE, toISO, num, repairContractId, datesFromWords,
    wordsFrom, wordsFromTSV,
    matchContractor, identifyBidders, scoreName,
    linesFromWords, mergePasses, searchable, hasTextLayer, pdfTextPages, pdfOcrPages,
    pdfPageCanvas, parseAbstract, parseBidders, crossCheckVariance, parseSummary,
    parseDateSheet, parseITB };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.extract = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
