import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { env } from './env';
import * as schema from '../db/schema';
import { createLogger } from '../utils/logger';

const isServerless = Boolean(process.env.VERCEL);
const log = createLogger('DatabasePool');

// Use PostgreSQL's native wire protocol so the API and persistent workers work
// with both managed providers (including Neon pooled URLs) and ordinary
// PostgreSQL installations. The previous Neon WebSocket-only pool could not
// connect to the PostgreSQL service used by the documented Docker deployment.
// On Vercel, keep the per-instance pool small and retire idle connections.
const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: isServerless ? 3 : 10,
    idleTimeoutMillis: isServerless ? 10000 : 30000,
    // A dependency probe or request must not wait forever while establishing
    // a dead WebSocket/database connection.
    connectionTimeoutMillis: 5_000,
});

// node-postgres emits errors from idle clients on the Pool itself. Keeping an
// error listener prevents a transient database/network interruption from
// becoming an uncaught EventEmitter exception; the failed client is removed by
// pg and subsequent requests can establish a new connection.
pool.on('error', (error) => {
    const databaseError = error as Error & { code?: unknown };
    log.error({
        errorType: databaseError.name,
        errorCode: typeof databaseError.code === 'string' ? databaseError.code : undefined,
        errorMessage: databaseError.message,
    }, 'Idle PostgreSQL client failed and was removed from the pool');
});

// Create drizzle client
export const db = drizzle({ client: pool, schema });

// Export raw pool for queries that need to bypass Drizzle ORM
export { pool };

export type Database = typeof db;

