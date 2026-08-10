/**
 * Ambient stub for `bun:sqlite`.
 *
 * Specs import server modules directly, and `apps/server/src/runtime-db.ts`
 * type-imports `bun:sqlite` for the branch it takes under the Bun runtime. Specs
 * run on Node and always take the `node:sqlite` branch, so the real declarations
 * (`bun-types`) are not installed here — and pulling them in would redefine
 * global types across every spec in this package.
 *
 * This declares only the surface the server's Bun branch touches.
 */
declare module "bun:sqlite" {
  export class Database {
    constructor(path: string, options?: { create?: boolean; readonly?: boolean });
    run(sql: string): void;
    query(sql: string): { get(...parameters: unknown[]): unknown; all(...parameters: unknown[]): unknown[] };
    close(): void;
  }
}
