import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import { env } from './env';
import * as schema from '../db/schema';

// For Node.js environments (local dev), need websocket polyfill.
// Must be set synchronously: the pool below is created — and queried by cold-start
// requests and seed scripts — before any async import would have resolved.
if (typeof WebSocket === 'undefined') {
    neonConfig.webSocketConstructor = ws as any;
}

const isServerless = Boolean(process.env.VERCEL);

// Create Neon serverless connection pool (works on both Vercel Serverless & local).
// On Vercel each concurrent instance holds its own pool and frozen instances thaw with dead
// sockets, so keep the pool small and let idle connections be closed rather than reused.
const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: isServerless ? 3 : 10,
    idleTimeoutMillis: isServerless ? 10000 : 30000,
});

// Create drizzle client
export const db = drizzle({ client: pool, schema });

// Export raw pool for queries that need to bypass Drizzle ORM
export { pool };

export type Database = typeof db;

