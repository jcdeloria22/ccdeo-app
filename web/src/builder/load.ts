/**
 * Loading the Document Builder's machinery, only when it is needed.
 *
 * None of this is in the main bundle. The Builder's libraries are ~1.8 MB (mostly
 * the six .docx templates), the browser libraries another 2.4 MB, and text
 * recognition 15 MB on top — a cost nobody opening the Reminders tab should pay.
 *
 * The libraries are the ones proven against 43 real BAC resolutions, vendored
 * byte-identically. They are plain scripts that attach themselves to `window`
 * rather than modules that export, so they are loaded for their side effects and
 * then read off the global — which is exactly what they were doing before, and
 * changing them would throw away what they are trusted for.
 */

declare global {
  interface Window {
    JSZip?: unknown;
    XLSX?: unknown;
    pdfjsLib?: { GlobalWorkerOptions: { workerSrc: string } };
    Tesseract?: unknown;
    SEED_TEMPLATES?: Record<string, string>;
    SEED_CONTRACTORS?: Record<string, unknown>;
    rules?: BuilderLib;
    builders?: BuilderLib;
    letterBuilders?: BuilderLib;
    docxkit?: BuilderLib;
    extract?: BuilderLib;
    builderCore?: BuilderLib;
  }
}

/* The vendored libraries are untyped plain scripts; this is the honest shape. */
export type BuilderLib = Record<string, (...args: never[]) => unknown>;

export interface Builder {
  rules: BuilderLib;
  builders: BuilderLib;
  letters: BuilderLib;
  docxkit: BuilderLib;
  extract: BuilderLib;
  core: BuilderLib;
  templates: Record<string, ArrayBuffer>;
  contractors: Record<string, unknown>;
  JSZip: new () => {
    file(name: string, data: Blob | string): void;
    generateAsync(opts: { type: 'blob' }): Promise<Blob>;
  };
  pdfjsLib: unknown;
}

/** Load a plain script once, and resolve when it has run. */
function script(src: string): Promise<void> {
  const existing = document.querySelector(`script[src="${src}"]`);
  if (existing) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Could not load ${src}. Run npm run sync:vendored.`));
    document.head.appendChild(el);
  });
}

const b64ToBuf = (b64: string): ArrayBuffer => {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
};

let loading: Promise<Builder> | null = null;

/** Everything except text recognition, which is loaded separately and rarely. */
export function loadBuilder(): Promise<Builder> {
  if (loading) return loading;

  loading = (async () => {
    await Promise.all([
      script('/vendor/jszip.js'),
      script('/vendor/pdf.min.js'),
      script('/vendor/xlsx.full.min.js'),
    ]);

    // pdf.js needs its worker; served over http it is an ordinary URL.
    if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.js';

    /*
     * Loaded as scripts, in order, not as modules.
     *
     * They are plain scripts — an IIFE attaching to `globalThis`, and in one case
     * a bare `window.SEED_TEMPLATES = {...}` assignment — so importing them as
     * ES modules fails on the two that export nothing at all. Script tags are
     * what they were written for, and a served script is fetched exactly as
     * lazily as a dynamic import would be.
     */
    for (const name of ['rules', 'docxkit', 'builders', 'letters', 'extract', 'builder-core', 'seed-templates']) {
      await script(`/builder/${name}.js`);
    }

    const templates: Record<string, ArrayBuffer> = {};
    for (const [k, v] of Object.entries(window.SEED_TEMPLATES ?? {})) templates[k] = b64ToBuf(v);

    const need = <T,>(v: T | undefined, what: string): T => {
      if (v === undefined) throw new Error(`${what} did not load. Run npm run sync:vendored.`);
      return v;
    };

    return {
      rules: need(window.rules, 'rules.js'),
      builders: need(window.builders, 'builders.js'),
      letters: need(window.letterBuilders, 'letters.js'),
      docxkit: need(window.docxkit, 'docxkit.js'),
      extract: need(window.extract, 'extract.js'),
      core: need(window.builderCore, 'builder-core.js'),
      templates,
      contractors: (window.SEED_CONTRACTORS ?? {}) as Record<string, unknown>,
      JSZip: need(window.JSZip, 'jszip.js') as Builder['JSZip'],
      pdfjsLib: need(window.pdfjsLib, 'pdf.min.js'),
    };
  })();

  return loading;
}

let ocr: Promise<unknown> | null = null;

/**
 * Text recognition, loaded on first use and not before.
 *
 * Only a scanned PDF with no text layer needs it. The assets are served by the
 * API from `ocr-assets/` rather than bundled — see `scripts/sync-vendored.mjs`.
 *
 * Served over http the worker is an ordinary script, so none of the Blob-worker
 * machinery the offline build needed applies here. If the assets are absent this
 * rejects, and the Builder offers pasting instead of failing silently.
 */
export function loadOcr(): Promise<unknown> {
  if (ocr) return ocr;

  ocr = (async () => {
    const probe = await fetch('/ocr/worker.min.js', { method: 'HEAD' });
    if (!probe.ok) {
      throw new Error(
        'Text recognition is not installed on this server. Run npm run sync:vendored, ' +
          'or paste the rows instead.',
      );
    }
    await script('/vendor/tesseract.min.js');
    if (!window.Tesseract) throw new Error('tesseract.min.js did not load.');
    return window.Tesseract;
  })();

  return ocr;
}

/** Where the recognition worker finds its own pieces. */
export const OCR_PATHS = {
  workerPath: '/ocr/worker.min.js',
  corePath: '/ocr/tesseract-core-simd-lstm.wasm.js',
  langPath: '/ocr/',
};
