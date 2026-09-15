/**
 * Injection token for the validated configuration.
 *
 * `Env` is an interface, so it cannot be a DI token itself — interfaces do not
 * survive to runtime. The token lives here rather than in a feature module so
 * that anything needing config does not have to import a module to get at it,
 * which would make the dependency arrow point the wrong way.
 */
export const ENV = Symbol('ENV');
