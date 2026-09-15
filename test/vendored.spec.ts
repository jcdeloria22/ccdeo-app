/**
 * The vendored files, and whether they have drifted.
 *
 * Sixteen files are byte-identical copies from CCDEO-App: the design system, the
 * Document Builder's libraries, and the browser libraries they need. The copies
 * are deliberate — this project deploys on its own, so a build reaching into a
 * sibling directory would work here and nowhere else — but a copy that goes stale
 * without anyone noticing is the failure that matters.
 *
 * Drift is checked in both directions:
 *
 *   - each vendored file against its recorded hash, which catches someone editing
 *     a copy in place. This runs everywhere, including where the source is absent.
 *   - the recorded hashes against the live sources, which catches CCDEO-App moving
 *     on without this project. Only possible where the two sit side by side, and
 *     it says so out loud when it skips.
 *
 * The Builder's libraries matter most here: `rules.js` is proven to reproduce 43
 * real BAC resolutions exactly. Copying it keeps that proof meaningful. Editing
 * the copy would quietly throw it away.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const ROOT = path.join(__dirname, '..');
const RECORD = path.join(ROOT, 'web', 'src', 'vendored.json');
const APP_CSS = path.join(ROOT, 'web', 'src', 'app.css');
const SOURCE = process.env.CCDEO_APP_DIR ?? path.join(ROOT, '..', 'CCDEO-App');

const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');

interface VendorRecord {
  sourceProject: string;
  copiedOn: string;
  note: string;
  files: { [dest: string]: string };
}

const record = (): VendorRecord => JSON.parse(readFileSync(RECORD, 'utf8')) as VendorRecord;

/** destination in this project → path in CCDEO-App. Mirrors the sync manifest. */
const sourceOf = (dest: string): string => {
  if (dest === 'web/src/tokens.css') return path.join(SOURCE, 'src', 'app.css');
  if (dest.startsWith('web/public/builder/')) return path.join(SOURCE, 'lib', path.basename(dest));
  if (dest.startsWith('web/public/data/')) return path.join(SOURCE, 'data', path.basename(dest));
  if (dest.startsWith('web/public/vendor/')) return path.join(SOURCE, 'vendor', path.basename(dest));
  if (dest.startsWith('ocr-assets/')) return path.join(SOURCE, 'vendor', 'tess', path.basename(dest));
  throw new Error(`No source known for ${dest}`);
};

describe('the vendored files', () => {
  const r = record();
  const entries = Object.entries(r.files);

  it('records where they came from and when', () => {
    expect(r.sourceProject).toBe('../CCDEO-App');
    expect(r.copiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(entries.length).toBeGreaterThanOrEqual(21);
  });

  it('includes the question banks the reviewers read', () => {
    const dests = entries.map(([d]) => d);
    for (const bank of ['me-questions.js', 'me-recall.js', 'pe-questions.js']) {
      expect(dests, `${bank} is not vendored`).toContain(`web/public/data/${bank}`);
    }
  });

  it('includes the Builder libraries that carry the resolution proof', () => {
    const dests = entries.map(([d]) => d);
    for (const lib of ['rules.js', 'builders.js', 'letters.js', 'docxkit.js', 'extract.js', 'builder-core.js']) {
      expect(dests, `${lib} is not vendored`).toContain(`web/public/builder/${lib}`);
    }
  });

  it('have not been edited in place', () => {
    for (const [dest, hash] of entries) {
      const full = path.join(ROOT, dest);
      expect(existsSync(full), `${dest} is recorded but missing — run npm run sync:vendored`).toBe(true);
      expect(
        sha256(readFileSync(full)),
        `${dest} differs from its recorded hash. It is a copy: edit the source in CCDEO-App and run ` +
          'npm run sync:vendored. Anything specific to this app belongs in its own file.',
      ).toBe(hash);
    }
  });

  const sideBySide = existsSync(SOURCE);

  (sideBySide ? it : it.skip)('are in step with the sources they were copied from', () => {
    const drifted: string[] = [];
    for (const [dest, hash] of entries) {
      const src = sourceOf(dest);
      if (existsSync(src)) {
        if (sha256(readFileSync(src)) !== hash) drifted.push(dest);
      } else {
        drifted.push(`${dest} — source missing at ${src}`);
      }
    }
    expect(
      drifted,
      'CCDEO-App has moved on without these copies. Run npm run sync:vendored if the source is right, ' +
        'or fix the source if the change belongs there.',
    ).toEqual([]);
  });

  if (sideBySide === false) {
    // eslint-disable-next-line no-console
    console.warn(
      `CCDEO-App not found at ${SOURCE} — the drift check against it was skipped. ` +
        'Expected where this project is deployed on its own; not expected on a development machine.',
    );
  }
});

/**
 * The rule that made the earlier collision worth writing down.
 *
 * The first version of the shell declared its own `.shell` and `.rail`, which the
 * design system already defines, and the two sets of rules fought — a rail
 * overlapping the content, a view shrink-wrapped inside its column. Redefining a
 * name the system owns is the mistake; this catches it returning.
 */
describe('app.css', () => {
  const OWNED = [
    '.shell', '.rail', '.rail-brand', '.rail-scroll', '.rail-f', '.grp-h', '.navbtn',
    '.viewwrap', '.view', '.card', '.cards', '.btn', '.chip', '.figure', '.meter', '.vhead', '.q', '.row',
  ];

  /**
   * Media blocks are removed before scanning.
   *
   * Overriding one of the system's classes inside a media query is how the rail
   * becomes a strip on a phone — the system has no narrow treatment, and layering
   * one on is the point of the cascade. What broke the shell was declaring a
   * competing BASE rule, so that is what this looks for.
   */
  const stripMediaBlocks = (css: string): string => {
    let out = '';
    for (let i = 0; i < css.length; ) {
      const at = css.indexOf('@media', i);
      if (at < 0) {
        out += css.slice(i);
        break;
      }
      out += css.slice(i, at);
      const open = css.indexOf('{', at);
      if (open < 0) break;
      let depth = 1;
      let j = open + 1;
      for (; j < css.length && depth > 0; j++) {
        if (css[j] === '{') depth++;
        else if (css[j] === '}') depth--;
      }
      i = j;
    }
    return out;
  };

  const selectorsIn = (file: string): string[] => {
    const css = stripMediaBlocks(readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''));
    return [...css.matchAll(/(^|[},])\s*([^{}@]+?)\s*\{/g)]
      .flatMap((m) => m[2].split(','))
      .map((s) => s.trim())
      .filter(Boolean);
  };

  it('declares no competing base rule for a class the design system owns', () => {
    const offenders = selectorsIn(APP_CSS).filter((sel) => OWNED.includes(sel));
    expect(
      offenders,
      `app.css declares base rules for ${offenders.join(', ')} — names tokens.css already owns. ` +
        'Use a new name, a compound modifier (.vhead h1 .badge), or a media-query override.',
    ).toEqual([]);
  });

  it('may still override an owned class inside a media query', () => {
    expect(readFileSync(APP_CSS, 'utf8')).toMatch(/@media[^{]*900px[\s\S]*\.rail\s*\{/);
  });

  it('still contains the deliberate font override', () => {
    expect(readFileSync(APP_CSS, 'utf8')).toMatch(/--font-heading:\s*'Helvetica Neue'/);
  });

  it('leaves the font untouched in the vendored copy', () => {
    expect(readFileSync(path.join(ROOT, 'web', 'src', 'tokens.css'), 'utf8')).toContain('"Archivo"');
  });
});
