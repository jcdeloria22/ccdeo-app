/**
 * Injection token for the storage seam.
 *
 * `Storage` is an interface, so it cannot be a token itself. Which implementation
 * is bound is decided once, in CoreModule — the point of the seam is that moving
 * to R2 changes that binding and nothing else.
 */
export const STORAGE = Symbol('STORAGE');
