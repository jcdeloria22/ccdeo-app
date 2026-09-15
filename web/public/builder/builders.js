/* builders.js — fill the DPWH-CCDEO templates from a contract record.
 *
 * Each paragraph is rebuilt segment by segment, mirroring the template's own
 * underline pattern: static wording plain, variable fields underlined. That is the
 * office convention and it is how the next person finds what changed.
 */
(function (root) {
  'use strict';
  const K = root.docxkit || (typeof require !== 'undefined' && require('./docxkit.js'));
  const R = root.rules || (typeof require !== 'undefined' && require('./rules.js'));

  const U = t => ({ text: t, underline: true });
  const P = t => ({ text: t, underline: false });
  const OFFICE = 'CEBU CITY DISTRICT ENGINEERING OFFICE';

  function editPara(doc, needle, parts) {
    const i = K.findPara(doc, needle);
    if (i < 0) throw new Error('paragraph not found: ' + needle);
    K.setRuns(doc, K.paragraphs(doc)[i], parts);
    return i;
  }

  /* ---- header (Contract ID / Name / Location) ---------------------------- */
  function fillHeader(headers, c) {
    for (const doc of Object.values(headers)) {
      if (!doc) continue;
      for (const p of K.paragraphs(doc)) {
        const t = K.paraText(p);
        if (/^Contract ID\b/.test(t))
          K.setRuns(doc, p, [P('Contract ID\t\t\t: ' + c.contractId)]);
        else if (/^Contract Name\b/.test(t))
          K.setRuns(doc, p, [P('Contract Name\t: ' + c.contractName)]);
        else if (/^Location of the Contract\b/.test(t))
          K.setRuns(doc, p, [P('Location of the Contract\t: ' + (c.location || 'Cebu City') + ' ')]);
      }
    }
  }

  /* ---- bid tables -------------------------------------------------------- */
  function fillBidTables(doc, c, bidders) {
    const tbls = K.tables(doc);
    const asRead = K.fitRows(tbls[0], bidders.length, 1);
    asRead.forEach((tr, i) => {
      const b = bidders[i], cells = K.cellsOf(tr);
      // The tables carry the uppercase house-style name, not the long name on the abstract.
      K.setCell(doc, cells[0], [P(b.houseName || b.name)]);
      K.setCell(doc, cells[1], [P(b.asRead == null ? '' : R.asReadCell(b.asRead))]);
      if (cells[2]) K.setCell(doc, cells[2], [P(b.discount || '')]);
    });
    const asCalc = K.fitRows(tbls[1], bidders.length, 1);
    asCalc.forEach((tr, i) => {
      const b = bidders[i], cells = K.cellsOf(tr);
      K.setCell(doc, cells[0], [P(b.houseName || b.name)]);
      K.setCell(doc, cells[1], [P(b.asCalculated == null ? '' : R.asCalcCell(b.asCalculated))]);
      K.setCell(doc, cells[2], [P(b.asCalculated == null ? '' : R.variance(c.abc, b.asCalculated))]);
      // A post-disqualified bidder keeps its row; the reason goes HERE, not in a WHEREAS.
      K.setCell(doc, cells[3], [P(b.remarks || (b.status === 'passed' ? 'Passed' : ''))]);
    });
  }

  /* ---- BAC Resolution ---------------------------------------------------- */
  function buildResolution(pkg, c) {
    const doc = pkg.body;
    // A bidder that failed the preliminary examination is dropped from both tables;
    // a bidder disqualified at post-qualification stays in them.
    const tableBidders = c.bidders.filter(b => b.status !== 'failed');
    const failed = c.bidders.filter(b => b.status === 'failed');
    const winner = R.pickWinner(c.bidders);
    if (!winner) throw new Error(c.contractId + ': no passing bidder');
    const second = R.isSecondLowest(c.bidders, winner);
    const form = R.cutoffForm(c.noticeDate);
    const resDate = R.addDays(c.noticeDate, 1);
    const nAll = R.bidCount(c.bidders.length);
    const plural = c.bidders.length > 1;

    fillHeader(pkg.headers, c);

    const resNo = String(c.contractId).slice(-4).replace(/^0+/, '') || '0';
    editPara(doc, 'RESOLUTION NO.', [P('RESOLUTION NO. '), U(resNo.padStart(2, '0'))]);

    editPara(doc, 'continuously for 7 days starting on', [
      P('WHEREAS, the '), U(OFFICE),
      P(' advertised the Invitation to Bid for the above stated Contract at the websites of the DPWH and the PhilGEPS and at a conspicuous place at the premises of the '),
      U(OFFICE), P(' continuously for 7 days starting on '),
      U(R.longDate(c.adDate) + ';'),
    ]);

    // "received only N bids" keeps "only" even in the plural, and the two sentences
    // below stay singular ("after opening the bid", "the bid from the eligible bidder")
    // however many bidders there were. Verified against the 2026 resolutions — the
    // office's wording is not grammatically consistent, and matching it matters more.
    editPara(doc, 'in response to the said Invitation', [
      P('WHEREAS, in response to the said Invitation, the BAC received only '),
      U(nAll), P(plural ? ' bids' : ' bid'), P(' for the Contract; '),
    ]);

    editPara(doc, 'after opening the bid', [
      P('WHEREAS, on '), U(R.longDate(c.openingDate)),
      P(', after opening the bid, the BAC conducted the Eligibility Check and found the '),
      U(nAll), P(' bidder' + (plural ? 's' : '') + ' eligible; '),
    ]);

    // Everyone who did not fail the preliminary examination is counted as passing.
    const nPassed = R.bidCount(c.bidders.length - failed.length);
    const passedPlural = (c.bidders.length - failed.length) > 1;
    const passedIdx = editPara(doc, 'passed the preliminary examination', [
      P('WHEREAS, the bid from the eligible bidder, '), U(nPassed),
      P(' bid' + (passedPlural ? 's' : '') + ' passed the preliminary examination by the BAC of the Technical and Financial Proposals based on the presence of the submitted documents as against the checklist of required documents, and, consequently, the BAC read and recorded its bids as follows:'),
    ]);

    // A bidder that failed the preliminary examination gets its own WHEREAS, placed
    // BEFORE the passing sentence, and is dropped from both bid tables.
    if (failed.length) {
      let target = K.paragraphs(doc)[passedIdx];
      for (const b of failed) {
        const moved = K.cloneParaAfter(target);      // the clone carries the passing text
        K.setRuns(doc, target, [
          P('WHEREAS, the bid from the eligible bidder, '), U(b.houseName || b.name),
          P(', failed the preliminary examination for the following reason: ' + (b.remarks || '').replace(/\.$/, '') + '.'),
        ]);
        target = moved;
      }
    }

    // The detailed-evaluation sentence carries a RANGE (As CALC -> Post Qual),
    // never the bid-opening date. This was corrected by hand once already.
    const range = R.longDate(c.asCalcDate) + ' - ' + R.longDate(c.noticeDate);
    editPara(doc, 'conducted the detailed evaluation', [
      P('WHEREAS, the BAC, with the assistance of its Technical Working Group, conducted the detailed evaluation of the abovementioned bid on '),
      U(range + ','),
      P(' which resulted in the following bids as calculated:'),
    ]);

    editPara(doc, 'upon post-qualification', [
      P('WHEREAS, upon post-qualification, validation and verification of the eligibility, technical and financial documents submitted by the Bidder with the '),
      P(second ? 'Second Lowest' : 'Lowest'), P(' Calculated Bid, '), U(winner.houseName || winner.name),
      P(', the BAC found its bid responsive and, therefore, the bidder is post-qualified; '),
    ]);

    editPara(doc, 'To declare', [
      P('To declare '), U(winner.houseName || winner.name),
      P(', as the Bidder with the Lowest Calculated Responsive Bid (LCRB) for the abovementioned Contract; and '),
    ]);

    editPara(doc, 'To recommend to the', [
      P('To recommend to the '), U('District Engineer,'),
      P(' for approval, the award of the said Contract to '), U(winner.houseName || winner.name),
      P(', at its total submitted bid, in the amount of ' + R.amountInWords(winner.asCalculated) + ' '),
      U('(Php ' + R.money(winner.asCalculated) + ').'),
    ]);

    const d = new Date(resDate);
    editPara(doc, 'RESOLVED, at', [
      P('RESOLVED, at '), U('DPWH-CEBU CITY DISTRICT ENGINEERING'), P(', this '),
      U(R.ordinal(d.getDate())), P(' day of '), U(R.MONTHS[d.getMonth()] + ', ' + d.getFullYear()), P('.'),
    ]);

    // Pre-cutoff form: the S.O. paragraph stays but goes EMPTY. Deleting the
    // paragraph shifts the whole signature block up a line.
    const soIdx = K.findPara(doc, 'PROMOTED S.O.');
    if (soIdx >= 0) {
      if (form.soLine) K.setRuns(doc, K.paragraphs(doc)[soIdx], [P(form.soLine)]);
      else K.blankPara(K.paragraphs(doc)[soIdx]);
    } else if (form.soLine) {
      const ai = K.findPara(doc, 'ALFREDO E. HERNANDEZ');
      if (ai > 0) K.setRuns(doc, K.paragraphs(doc)[ai - 1], [P(form.soLine)]);
    }

    fillBidTables(doc, c, tableBidders);

    return { winner, second, form, resDate, resNo };
  }

  /* ---- Notice of Post-Qualification -------------------------------------- */
  function buildNotice(pkg, c, addressee) {
    const doc = pkg.body;
    const form = R.cutoffForm(c.noticeDate);
    fillHeader(pkg.headers, c);

    const di = K.findParaRe(doc, /^\s*[A-Z][a-z]+ \d{1,2}, \d{4}\s*$/);
    if (di >= 0) K.setRuns(doc, K.paragraphs(doc)[di], [P(R.longDate(c.noticeDate))]);

    // The addressee block is four paragraphs between the date and the salutation:
    // name, position, company, then the whole mailing address as ONE paragraph whose
    // line breaks are <w:br/>, not separate paragraphs. setRuns turns \n into those.
    const si = K.findParaRe(doc, /^Dear\b/);
    if (si < 0) throw new Error('no salutation found in the notice template');
    const block = [addressee.name, addressee.position,
      addressee.company, String(addressee.address || '')];
    const ps = K.paragraphs(doc);
    const slots = [];
    for (let j = di + 1; j < si; j++) if (K.paraText(ps[j]).trim()) slots.push(ps[j]);
    let last = slots[slots.length - 1];
    while (slots.length < block.length && last) { last = K.cloneParaAfter(last); slots.push(last); }
    slots.forEach((p, j) => (j < block.length ? K.setRuns(doc, p, [P(block[j])]) : K.blankPara(p)));
    K.setRuns(doc, K.paragraphs(doc)[K.findParaRe(doc, /^Dear\b/)], [P(addressee.salutation)]);

    // Cutoff: before 08 Jul 2026 the notice is signed by the Chairperson.
    const chair = K.findPara(doc, 'ALFREDO E. HERNANDEZ');
    const vice = K.findPara(doc, 'CHRISTIAN B. FELICES');
    const sigIdx = chair >= 0 ? chair : vice;
    if (sigIdx >= 0) {
      const ps = K.paragraphs(doc);
      K.setRuns(doc, ps[sigIdx], [P(form.noticeSignatory)]);
      if (ps[sigIdx + 1] && /BAC/.test(K.paraText(ps[sigIdx + 1])))
        K.setRuns(doc, ps[sigIdx + 1], [P(form.noticeTitle)]);
    }
    return { form };
  }

  const api = { buildResolution, buildNotice, fillHeader, fillBidTables, U, P, editPara };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.builders = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
