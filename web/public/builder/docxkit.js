/* docxkit — run-preserving .docx editing in the browser.
 *
 * Word splits one visible word across several <w:r> runs ("March 1" + "7" + ", 2026"),
 * and the underline that marks a variable field lives on the run, not the paragraph.
 * So we never edit run text in place. We delete a paragraph's runs and rebuild them
 * from a donor run's <w:rPr>, exactly the way the Python helper does it.
 */
(function (root) {
  'use strict';

  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const XML_HDR = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

  /** insertAfter — xmldom (used for testing) has no Element.after(). */
  function after(ref, node) {
    if (ref.parentNode) ref.parentNode.insertBefore(node, ref.nextSibling);
    return node;
  }

  function parse(xml) {
    const d = new DOMParser().parseFromString(xml, 'application/xml');
    if (d.getElementsByTagName('parsererror').length) throw new Error('bad xml');
    return d;
  }
  function serialize(doc) {
    let s = new XMLSerializer().serializeToString(doc);
    if (s.startsWith('<?xml')) s = s.slice(s.indexOf('?>') + 2).replace(/^\s*/, '');
    return XML_HDR + s;
  }
  const el = (doc, name) => doc.createElementNS(W, 'w:' + name);
  const kids = (node, name) => Array.from(node.getElementsByTagNameNS(W, name));
  const childEls = (node, name) =>
    Array.from(node.childNodes).filter(n => n.nodeType === 1 && n.localName === name);

  /* ---- reading ---------------------------------------------------------- */

  function paraText(p) {
    let out = '';
    for (const n of p.getElementsByTagNameNS(W, '*')) {
      if (n.localName === 't') out += n.textContent;
      else if (n.localName === 'tab') out += '\t';
      else if (n.localName === 'br' || n.localName === 'cr') out += '\n';
    }
    return out;
  }
  const paragraphs = doc => kids(doc, 'p');

  /** Index of the first paragraph whose text contains `needle`, else -1. */
  function findPara(doc, needle, from) {
    const ps = paragraphs(doc);
    for (let i = from || 0; i < ps.length; i++) if (paraText(ps[i]).includes(needle)) return i;
    return -1;
  }
  function findParaRe(doc, re, from) {
    const ps = paragraphs(doc);
    for (let i = from || 0; i < ps.length; i++) if (re.test(paraText(ps[i]))) return i;
    return -1;
  }

  /* ---- writing ---------------------------------------------------------- */

  function runsOf(p) {
    // Direct-child runs only: a run nested in a table inside this paragraph is not ours.
    return childEls(p, 'r');
  }

  function makeRun(doc, text, rPrDonor, opts) {
    const r = el(doc, 'r');
    if (rPrDonor) r.appendChild(rPrDonor.cloneNode(true));
    if (opts) {
      let rPr = childEls(r, 'rPr')[0];
      if (!rPr) { rPr = el(doc, 'rPr'); r.insertBefore(rPr, r.firstChild); }
      const set = (tag, on) => {
        const ex = childEls(rPr, tag)[0];
        if (on === undefined || on === null) return;
        if (on === false) { if (ex) rPr.removeChild(ex); return; }
        if (!ex) rPr.appendChild(el(doc, tag));
      };
      set('b', opts.bold);
      set('i', opts.italic);
      if (opts.underline !== undefined && opts.underline !== null) {
        const ex = childEls(rPr, 'u')[0];
        if (opts.underline === false) { if (ex) rPr.removeChild(ex); }
        else {
          const u = ex || el(doc, 'u');
          u.setAttributeNS(W, 'w:val', 'single');
          if (!ex) rPr.appendChild(u);
        }
      }
    }
    // Split on tabs and newlines so they survive as real Word elements.
    const parts = String(text).split(/(\t|\n)/);
    for (const part of parts) {
      if (part === '') continue;
      if (part === '\t') { r.appendChild(el(doc, 'tab')); continue; }
      if (part === '\n') { r.appendChild(el(doc, 'br')); continue; }
      const t = el(doc, 't');
      t.setAttribute('xml:space', 'preserve');
      t.textContent = part;
      r.appendChild(t);
    }
    return r;
  }

  /**
   * Replace every run in paragraph `p`.
   * parts: [{text, bold, italic, underline}] — omitted flags inherit the donor.
   */
  function setRuns(doc, p, parts, donorRun) {
    const existing = runsOf(p);
    const donor = donorRun || existing[0];
    const rPr = donor ? childEls(donor, 'rPr')[0] : null;
    for (const r of existing) p.removeChild(r);
    let anchor = null;
    for (const part of parts) {
      const run = makeRun(doc, part.text, rPr, part);
      if (anchor) after(anchor, run); else {
        const pPr = childEls(p, 'pPr')[0];
        if (pPr) after(pPr, run); else p.insertBefore(run, p.firstChild);
      }
      anchor = run;
    }
    return p;
  }

  /** Empty a paragraph but keep the paragraph itself (the pre-cutoff S.O. line). */
  function blankPara(p) {
    for (const r of runsOf(p)) p.removeChild(r);
    return p;
  }

  /** Deep-copy a paragraph and insert the copy directly after it. */
  function cloneParaAfter(p) {
    const c = p.cloneNode(true);
    after(p, c);
    return c;
  }

  /* ---- tables ----------------------------------------------------------- */

  const tables = doc => kids(doc, 'tbl');
  const rowsOf = tbl => childEls(tbl, 'tr');
  const cellsOf = tr => childEls(tr, 'tc');
  const cellParas = tc => childEls(tc, 'p');

  function setCell(doc, tc, parts) {
    const ps = cellParas(tc);
    const p = ps[0];
    setRuns(doc, p, parts);
    for (let i = 1; i < ps.length; i++) tc.removeChild(ps[i]);
    return p;
  }

  /** Grow/shrink a table's body to `n` data rows, cloning `templateIdx` as needed. */
  function fitRows(tbl, n, templateIdx) {
    const ti = templateIdx === undefined ? 1 : templateIdx;
    let rows = rowsOf(tbl);
    while (rows.length - ti < n) {
      const c = rows[ti].cloneNode(true);
      after(rows[rows.length - 1], c);
      rows = rowsOf(tbl);
    }
    while (rows.length - ti > n) {
      tbl.removeChild(rows[rows.length - 1]);
      rows = rowsOf(tbl);
    }
    return rowsOf(tbl).slice(ti);
  }

  /* ---- package ---------------------------------------------------------- */

  async function openDocx(data, JSZipRef) {
    const zip = await (new (JSZipRef || root.JSZip)()).loadAsync(data);
    const part = async name => {
      const f = zip.file(name);
      return f ? parse(await f.async('string')) : null;
    };
    const body = await part('word/document.xml');
    const headers = {};
    for (const name of Object.keys(zip.files)) {
      if (/^word\/header\d*\.xml$/.test(name)) headers[name] = await part(name);
    }
    return {
      zip, body, headers,
      async blob(type) {
        this.zip.file('word/document.xml', serialize(this.body));
        for (const [n, d] of Object.entries(this.headers)) this.zip.file(n, serialize(d));
        return this.zip.generateAsync({
          type: type || (typeof window === 'undefined' ? 'nodebuffer' : 'blob'),
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          compression: 'DEFLATE',
        });
      },
    };
  }

  const api = { parse, serialize, after, paraText, paragraphs, findPara, findParaRe, setRuns,
                blankPara, cloneParaAfter, runsOf, tables, rowsOf, cellsOf, cellParas,
                setCell, fitRows, openDocx };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.docxkit = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
