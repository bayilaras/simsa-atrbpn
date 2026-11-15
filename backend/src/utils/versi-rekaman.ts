import { DataSudahBerubahError } from './errors.js';

/**
 * Optimistic concurrency for edit forms. `dimuat` is the updatedAt the client
 * loaded, sent back from JSON with millisecond precision. The locked row is
 * read through Drizzle, which also yields a Date in milliseconds (PostgreSQL
 * keeps microseconds; both reads drop them the same way), so an unchanged row
 * always compares equal. Without `dimuat`, as from a client of the previous
 * release, nothing is compared.
 */
export function pastikanBelumBerubah(updatedAt: Date | null | undefined, dimuat: Date | undefined): void {
    if (dimuat === undefined) return;
    if (!(updatedAt instanceof Date) || updatedAt.getTime() !== dimuat.getTime()) {
        throw new DataSudahBerubahError();
    }
}
