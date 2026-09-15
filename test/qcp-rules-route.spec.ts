/**
 * Serving the verified rules.
 *
 * The route exists so a study screen can show what has actually been verified
 * without copying a specification value into a second place. What matters is
 * therefore not that it returns rows, but that every row it returns carries the
 * citation that makes it a verified rule rather than a remembered number — and
 * that it is read-only, because a rule is changed by editing `rules.ts` with a
 * source in hand.
 */
import { describe, it, expect } from 'vitest';
import { QcpRulesController } from '../src/generators/qcp/qcp-rules.controller';
import { QCP_RULES_VERSION } from '../src/generators/qcp/rules';

const body = new QcpRulesController().rules();

describe('the rules route', () => {
  it('names the version by its source, not a release number', () => {
    expect(body.version).toBe(QCP_RULES_VERSION);
    expect(body.version).toMatch(/mtr-vol-ii/);
  });

  it('lists the items it covers', () => {
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.rules.length).toBeGreaterThan(0);
  });

  /** A frequency with no source is not a rule anyone may cite. */
  it('gives every rule a provenance with a document, a section and a tier', () => {
    for (const r of body.rules) {
      expect(r.provenance.sourceDocument, r.id).toBeTruthy();
      expect(r.provenance.sourceSection, r.id).toBeTruthy();
      expect(r.provenance.tier, r.id).toBeGreaterThan(0);
      expect(r.provenance.verifiedOn, r.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  /**
   * Acceptance limits are tier 1 — the Standard Specifications. A limit carrying
   * a tier 2 provenance would mean a testing manual was cited as the authority
   * for what the material must meet, which is the mix-up this whole hierarchy
   * exists to prevent.
   */
  it('cites a tier 1 source for every acceptance limit', () => {
    const limits = body.rules.filter((r) => r.acceptance);
    expect(limits.length).toBeGreaterThan(0);

    for (const r of limits) {
      expect(r.acceptance!.provenance.tier, `${r.id} acceptance`).toBe(1);
      expect(r.acceptance!.provenance.sourceSection, `${r.id} acceptance`).toMatch(/§/);
    }
  });

  /**
   * The specific thing the study screen is there to correct: the vendored table
   * records this as unresolved between editions, and it was settled at 30%.
   */
  it('carries the settled Item 200 soaked CBR, cited to the edition it was read from', () => {
    const cbr = body.rules.find((r) => r.id === 'qc.200.cbr-abrasion');
    expect(cbr, 'the Item 200 CBR rule must be present').toBeTruthy();
    expect(cbr!.acceptance!.requirement).toMatch(/not less than 30%/);
    expect(cbr!.acceptance!.provenance.sourceYear).toBe(2013);
    expect(cbr!.acceptance!.provenance.sourceSection).toBe('§200.2');
  });

  /**
   * An extraction is not a countersignature, so the two are recorded separately.
   * The owner countersigned these on 15 September 2026; `verifiedBy` still says
   * how each row was checked, because that fact did not change.
   */
  it('records the countersignature as its own fact, without overwriting how the row was checked', () => {
    for (const r of body.rules.filter((x) => x.acceptance)) {
      const p = r.acceptance!.provenance;
      expect(p.countersignedBy, r.id).toBe('Jayz');
      expect(p.countersignedOn, r.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.verifiedBy, r.id).toBe('extracted-from-source-pdf');
      expect(p.caveat, `${r.id} must still name the edition it was read from`).toMatch(/2013 edition/);
    }
  });

  it('exposes no way to change a rule', () => {
    const proto = Object.getOwnPropertyNames(QcpRulesController.prototype);
    expect(proto.sort()).toEqual(['constructor', 'rules']);
  });
});
