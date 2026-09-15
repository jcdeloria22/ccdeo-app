/**
 * Injection token for the scan seam.
 *
 * `Scanner` is an interface. Which implementation is bound is decided once, in
 * CoreModule — tests construct repositories directly and pass their own.
 */
export const SCANNER = Symbol('SCANNER');
