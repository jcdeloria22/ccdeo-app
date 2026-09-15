/**
 * DOM test setup.
 *
 * This file is loaded for every spec, including the backend ones that run under
 * Node, so everything is guarded on a document existing and the DOM libraries
 * are imported dynamically — importing React Testing Library in a Node
 * environment would fail at import time, before any guard could run.
 *
 * Cleanup after each test is not optional. Testing Library mounts into a shared
 * document, and a component left mounted keeps its state and in-flight fetches
 * running into the next test, which produces failures that move when you reorder
 * files.
 */
import { afterEach } from 'vitest';

if (typeof document !== 'undefined') {
  const { cleanup } = await import('@testing-library/react');
  afterEach(() => {
    cleanup();
  });

  /*
   * jsdom implements neither of these.
   *
   * Anything that hands the user a file goes through them — the Builder's zips,
   * the contractor export. Without a stand-in the click throws an unhandled
   * rejection that vitest reports separately from the test, so a download path
   * could break without any test turning red.
   */
  if (typeof URL.createObjectURL !== 'function') {
    URL.createObjectURL = () => 'blob:test';
    URL.revokeObjectURL = () => undefined;
  }
}
