import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { env } from './env';
import * as schema from '../db/schema';

// For Node.js environments (local dev), need websocket polyfill
if (typeof WebSocket === 'undefined') {
    import('ws').then((ws) => {
        neonConfig.webSocketConstructor = ws.default || ws;
    }).catch(() => {
        // ws not available, likely running in edge/serverless with native WebSocket
    });
}

// Create Neon serverless connection pool (works on both Vercel Serverless & local)
const pool = new Pool({ connectionString: env.DATABASE_URL });

// Create drizzle client
export const db = drizzle({ client: pool, schema });

export type Database = typeof db;

