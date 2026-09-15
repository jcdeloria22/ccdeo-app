/* builder-core.js — convention helpers lifted VERBATIM from the original
 * CCDEO Document Builder ui.js. These encode how a contract record is normalised,
 * how a bid winner is matched to a letter addressee, what the data-entry CSV
 * contains and how pasted rows are read. They are behaviour, not presentation,
 * so they were moved rather than rewritten.
 *
 * The only change: functions that read the old module-level `S` now take what
 * they need as an argument. Each such change is marked CHANGED.
 */
(function (root) {
  'use strict';

  const R = root.rules;
  const X = root.extract;

  /* The lifted bodies refer to a module-level `S`, exactly as they did in the
     original. The UI hands its state in here rather than the bodies being
     rewritten to take arguments. */
  let S = null;
  function setState(state) { S = state; }
  const keyOf = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 14);

  const houseNameFor = name => (S.contractors[keyOf(name)] || {}).houseName || '';

  const shortOf = a => String(a.company || '').split(/\s+/)[0].replace(/[^A-Za-z&]/g, '');

  function conf(c, field) { return (c._confidence || {})[field]; }

  function templateKey(kind, name) {
    if (kind !== 'tplLetters') return kind;
    const n = name.toLowerCase();
    if (n.includes('pacc')) return 'tplPACC';
    if (n.includes('pice')) return 'tplPICE';
    if (n.includes('auditor')) return 'tplAuditor';
    return 'tplCebuContractors';
  }

  function mergeContract(c) {
    const ex = S.contracts.find(x => x.contractId === c.contractId);
    if (!ex) { S.contracts.push(c); return; }
    for (const [k, v] of Object.entries(c)) if (v && (!ex[k] || (Array.isArray(v) && v.length))) ex[k] = v;
  }

  function parsePasted(text) {
    const out = [];
    for (const raw of String(text).split('\n')) {
      const line = raw.trim();
      if (!line || /^#/.test(line)) continue;
      // Tabs, two-or-more spaces, or a pipe. Never a bare comma — amounts
      // ("23,422,000.00") and dates ("May 19, 2026") both contain them.
      const f = line.split(/\t+|\s{2,}|\s*\|\s*/).map(x => x.trim()).filter(Boolean);
      const id = X.repairContractId(f[0], null);
      if (!id) continue;
      const money = v => Number(String(v || '').replace(/[^0-9.]/g, '')) || null;
      const rec = { contractId: id, contractName: '', location: 'Cebu City',
        abc: money(f[1]), adDate: X.toISO(f[2]), openingDate: X.toISO(f[3]),
        asCalcDate: X.toISO(f[4]), noticeDate: X.toISO(f[5]),
        bidders: [], _confidence: {} };
      // remaining fields come in pairs: contractor, amount
      for (let i = 6; i + 1 < f.length + 1; i += 2) {
        const nm = f[i], amt = money(f[i + 1]);
        if (!nm || !amt) break;
        // Use the scored matcher, not a substring test: "Power Move" contains
        // "power" and would otherwise match POWER FRAME, a different company.
        const cand = X.matchContractor(nm, S.contractors, 2);
        const hit = cand.length && cand[0].score >= 0.5 &&
          (cand.length === 1 || cand[0].score - cand[1].score > 0.1) ? cand[0] : null;
        rec.bidders.push({ name: hit ? hit.company : nm,
          houseName: hit ? (hit.houseName || hit.company.toUpperCase()) : nm.toUpperCase(),
          asRead: amt, asCalculated: amt, status: 'passed', remarks: 'Passed',
          _nameOK: !!hit, _candidates: cand });
      }
      out.push(rec);
    }
    return out;
  }

  function normalize(c) {
    const n = JSON.parse(JSON.stringify(c));
    n.abc = Number(n.abc);
    n.bidders = (n.bidders || []).map(b => Object.assign({}, b, {
      houseName: b.houseName || houseNameFor(b.name) || String(b.name || '').toUpperCase(),
      asRead: b.asRead == null ? null : Number(b.asRead),
      asCalculated: b.asCalculated == null ? null : Number(b.asCalculated),
    }));
    return n;
  }

  function findAddressee(winner) {
    if (!winner) return null;
    const want = keyOf(winner.houseName || winner.name);
    for (const [k, v] of Object.entries(S.contractors)) {
      if (k === want || keyOf(v.company) === want || keyOf(v.houseName) === want) return v;
      if (want.startsWith(k) || k.startsWith(want.slice(0, 8))) return v;
    }
    return null;
  }

  /* CHANGED: took the two wanted-document flags from the DOM; they are now
     arguments, so this stays testable and free of the old markup. */
  function validate(want) {
    want = want || { res: true, notice: true };
    const blockers = [], warns = [];
    if (!S.templates.tplBacres && want.res) blockers.push('no BAC Resolution template loaded (Templates & settings)');
    if (!S.templates.tplNotice && want.notice) blockers.push('no Notice template loaded');
    S.contracts.forEach(c => {
      const id = c.contractId || '(no contract id)';
      const bidders = normalize(c).bidders;
      if (!c.contractId) blockers.push('a row has no contract ID');
      const winner = R.pickWinner(bidders);
      if (!winner) blockers.push(`${id} · no passing bidder to award to`);
      else if (!winner.houseName && !winner.name)
        blockers.push(`${id} · the winning bidder has no name — OCR could not read it, pick the contractor in the bidders panel`);
      if (!c.abc) warns.push(`${id} · no ABC`);
      if (!c.noticeDate) warns.push(`${id} · no Post Qual date — this sets the July 08 cutoff and the resolution date`);
      if (!c.asCalcDate) warns.push(`${id} · no As CALC date — the evaluation range needs it`);
      if (!c.adDate) warns.push(`${id} · no advertisement date`);
      if (c.adDate && c.openingDate && c.adDate >= c.openingDate) warns.push(`${id} · advertised on or after the bid opening`);
      if (c.openingDate && c.noticeDate && c.openingDate > c.noticeDate) warns.push(`${id} · bid opening falls after post-qualification`);
      // fields OCR read but nothing has confirmed
      for (const [f, k] of Object.entries(c._confidence || {})) {
        if (!k.ok) warns.push(`${id} · ${f}: ${k.why}`);
      }
      bidders.forEach(b => {
        if (b.asCalculated && c.abc && Number(b.asCalculated) > Number(c.abc))
          warns.push(`${id} · ${b.houseName || b.name} bid above the ABC`);
        if (b._printedVariance != null && b._varianceOK === false)
          warns.push(`${id} · ${b.houseName || b.name}: the printed variance does not match the arithmetic — a figure is misread`);
        if (!b.houseName) warns.push(`${id} · a bidder has no house-style name for the resolution tables`);
      });
    });
    return { blockers, warns };
  }

  function dataEntryCsv() {
    const esc2 = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const head = ['Contract ID', 'Contract name', 'ABC', 'Contractor', 'Amount', 'Amount in words',
      '% variance', 'Advertised', 'Bid opening', 'Prep As CALC', 'Notice date', 'Resolution date',
      'Notice signed by', 'S.O. line', 'Bidders'];
    const lines = [head.map(esc2).join(',')];
    for (const raw of S.contracts) {
      const c = normalize(raw);
      const w = R.pickWinner(c.bidders);
      const f = c.noticeDate ? R.cutoffForm(c.noticeDate) : { noticeSignatory: '', soLine: '' };
      lines.push([c.contractId, c.contractName, c.abc, w ? w.houseName : '',
        w ? R.money(w.asCalculated) : '', w ? R.amountInWords(w.asCalculated) : '',
        w ? R.variance(c.abc, w.asCalculated) : '', c.adDate, c.openingDate, c.asCalcDate,
        c.noticeDate, c.noticeDate ? R.longDate(R.addDays(c.noticeDate, 1)) : '',
        f.noticeSignatory, f.soLine ? 'yes' : 'removed', c.bidders.length].map(esc2).join(','));
    }
    return lines.join('\r\n');
  }

  function stamp() {
    const d = new Date();
    return String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') +
      String(d.getFullYear()).slice(-2);
  }
  root.builderCore = { setState, templateKey, mergeContract, parsePasted, normalize,
                       findAddressee, validate, dataEntryCsv, stamp,
                       keyOf, houseNameFor, shortOf };
})(window);
