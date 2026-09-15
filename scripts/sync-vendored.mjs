/**
 * Copy the files this project vendors from CCDEO-App, and record what it copied.
 *
 *   node scripts/sync-vendored.mjs          # copy and rewrite the record
 *   node scripts/sync-vendored.mjs --check  # report drift, change nothing
 *
 * Two kinds of thing are vendored, for the same reason: this project deploys on
 * its own, so a build that reached into a sibling directory would work on one
 * machine and nowhere else.
 *
 *   - the design system (one stylesheet)
 *   - the Document Builder's libraries, which are byte-identical to the ones
 *     proven against 43 real BAC resolutions. Copying them keeps that proof
 *     meaningful; rewriting them would throw it away.
 *
 * `test/vendored.spec.ts` runs the same comparison, so drift fails the suite
 * rather than waiting to be noticed. This replaces the earlier
 * sync-design-system.mjs, which did the same job for one file.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

/** Relative to this project, so it resolves wherever the two sit side by side. */
const SOURCE_ROOT = process.env.CCDEO_APP_DIR || path.join(ROOT, '..', 'CCDEO-App');

/**
 * source (within CCDEO-App) → destination (within this project).
 *
 * Only what is genuinely shared. `builder-ui.js` is deliberately absent: it is
 * written against the other app's shell and is rewritten here, not copied.
 */
export const MANIFEST = [
  ['src/app.css', 'web/src/tokens.css'],

  ['lib/rules.js', 'web/public/builder/rules.js'],
  ['lib/builders.js', 'web/public/builder/builders.js'],
  ['lib/letters.js', 'web/public/builder/letters.js'],
  ['lib/docxkit.js', 'web/public/builder/docxkit.js'],
  ['lib/extract.js', 'web/public/builder/extract.js'],
  ['lib/builder-core.js', 'web/public/builder/builder-core.js'],
  ['lib/seed-templates.js', 'web/public/builder/seed-templates.js'],

  /*
   * The question banks and the workflow's content.
   *
   * Plain scripts assigning to `window`, like the Builder's libraries, and
   * loaded the same way. ~1.3 MB in total, which is why they are fetched when a
   * reviewer is opened rather than on every page load.
   */
  ['data/me-questions.js', 'web/public/data/me-questions.js'],
  ['data/me-recall.js', 'web/public/data/me-recall.js'],
  ['data/pe-questions.js', 'web/public/data/pe-questions.js'],
  ['data/inventory.js', 'web/public/data/inventory.js'],
  ['data/workflow-data.js', 'web/public/data/workflow-data.js'],

  ['vendor/jszip.js', 'web/public/vendor/jszip.js'],
  ['vendor/pdf.min.js', 'web/public/vendor/pdf.min.js'],
  ['vendor/pdf.worker.min.js', 'web/public/vendor/pdf.worker.min.js'],
  ['vendor/xlsx.full.min.js', 'web/public/vendor/xlsx.full.min.js'],
  ['vendor/tesseract.min.js', 'web/public/vendor/tesseract.min.js'],

  /*
   * Text recognition, kept OUT of the frontend build.
   *
   * Roughly 15 MB, and only needed when someone opens a scanned PDF with no text
   * layer. In `web/public` Vite would copy it on every build and the browser
   * would still fetch it lazily; served from here by the API instead, the build
   * stays fast and the download still only happens the first time OCR runs.
   *
   * Only the three files the worker actually loads — the full `vendor/tess`
   * directory is 29 MB of variants nothing asks for.
   */
  ['vendor/tess/worker.min.js', 'ocr-assets/worker.min.js'],
  ['vendor/tess/tesseract-core-simd-lstm.wasm.js', 'ocr-assets/tesseract-core-simd-lstm.wasm.js'],
  ['vendor/tess/eng.traineddata.gz', 'ocr-assets/eng.traineddata.gz'],
];

export const RECORD = path.join(ROOT, 'web', 'src', 'vendored.json');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function compare() {
  const rows = [];
  for (const [from, to] of MANIFEST) {
    const src = path.join(SOURCE_ROOT, from);
    const dst = path.join(ROOT, to);
    rows.push({
      from,
      to,
      sourceExists: existsSync(src),
      sourceHash: existsSync(src) ? sha256(readFileSync(src)) : null,
      destHash: existsSync(dst) ? sha256(readFileSync(dst)) : null,
    });
  }
  return rows;
}

function main() {
  const check = process.argv.includes('--check');
  const rows = compare();

  const missing = rows.filter((r) => !r.sourceExists);
  if (missing.length) {
    console.error(
      `Source files not found under ${SOURCE_ROOT}:\n` +
        missing.map((m) => `  ${m.from}`).join('\n') +
        '\nSet CCDEO_APP_DIR if it lives elsewhere. Nothing was changed.',
    );
    process.exit(1);
  }

  const drifted = rows.filter((r) => r.sourceHash !== r.destHash);

  if (check) {
    if (!drifted.length) {
      console.log(`All ${rows.length} vendored files are in step with ${SOURCE_ROOT}.`);
      process.exit(0);
    }
    console.error(
      `${drifted.length} vendored file(s) have DRIFTED:\n` +
        drifted.map((d) => `  ${d.to}\n    source ${d.sourceHash}\n    here   ${d.destHash ?? 'missing'}`).join('\n') +
        '\n\nRun `npm run sync:vendored` if the source is right, or fix the source if the change belongs there.',
    );
    process.exit(1);
  }

  for (const [from, to] of MANIFEST) {
    const dst = path.join(ROOT, to);
    mkdirSync(path.dirname(dst), { recursive: true });
    writeFileSync(dst, readFileSync(path.join(SOURCE_ROOT, from)));
  }

  writeFileSync(
    RECORD,
    `${JSON.stringify(
      {
        sourceProject: '../CCDEO-App',
        copiedOn: new Date().toISOString().slice(0, 10),
        note:
          'Byte-identical copies. Do not edit them here — edit the source and re-run `npm run sync:vendored`. ' +
          'Anything specific to this app belongs in its own file.',
        files: Object.fromEntries(rows.map((r) => [r.to, r.sourceHash])),
      },
      null,
      2,
    )}\n`,
  );

  console.log(`Copied ${rows.length} files from ${SOURCE_ROOT}.`);
  if (drifted.length) console.log(`  ${drifted.length} were out of step and are now current.`);
}

/* Compare resolved paths, not URL strings: on Windows `file://` vs `file:///`
   and backslashes make the string form quietly never match. */
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();
