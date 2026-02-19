import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from './env';
import * as schema from '../db/schema';

// Create postgres connection
const queryClient = postgres(env.DATABASE_URL, {
    ssl: 'require',
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
});

// Create drizzle client
export const db = drizzle(queryClient, { schema });

export type Database = typeof db;
