import { pool } from '../config/database.js';

// Two-key PostgreSQL advisory locks avoid colliding with application locks and
// serialize each immutable bootstrap edition across processes/hosts.
const REGULATORY_SEED_LOCK_NAMESPACE = 0x53494d53; // "SIMS"

export const REGULATORY_SEED_LOCK = {
  klasifikasi: 1,
  jra: 2,
} as const;

export async function withRegulatorySeedLock<T>(
  instrumentKey: number,
  operation: () => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let destroyReason: Error | undefined;

  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock($1, $2)',
      [REGULATORY_SEED_LOCK_NAMESPACE, instrumentKey],
    );

    try {
      const result = await operation();
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        destroyReason = rollbackError instanceof Error
          ? rollbackError
          : new Error('Failed to roll back the regulatory seed lock transaction');
      }
      throw error;
    }
  } catch (error) {
    if (!destroyReason && error instanceof Error) destroyReason = error;
    throw error;
  } finally {
    client.release(destroyReason);
  }
}
