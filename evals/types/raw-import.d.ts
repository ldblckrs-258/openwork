/**
 * Ambient stub for Vite's `?raw` imports.
 *
 * Specs import app modules directly, and the roleplay generation prompts are
 * markdown documents loaded with `?raw` so they can be edited without touching
 * code. Vite supplies these declarations to the app through `vite/client`, which
 * is not installed here and would pull the whole DOM lib in with it.
 */
declare module "*?raw" {
  const content: string;
  export default content;
}
