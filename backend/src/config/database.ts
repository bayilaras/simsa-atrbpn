import { Pool, type PoolConfig } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema';
import { createLogger } from '../utils/logger';

const log = createLogger('DatabasePool');

function boundedInteger(
    value: string | undefined,
    fallback: number,
    minimum: number,
    maximum: number,
    name: string,
): number {
    if (!value?.trim()) return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
        throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
    }
    return parsed;
}

function strictBoolean(
    value: string | undefined,
    fallback: boolean,
    name: string,
): boolean {
    if (value === undefined || value.trim() === '') return fallback;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    throw new Error(`${name} must be true or false`);
}

function utcSessionOptions(configuredOptions: string | undefined): string {
    return [configuredOptions?.trim(), '-c timezone=UTC'].filter(Boolean).join(' ');
}

export function buildDatabasePoolConfig(
    source: NodeJS.ProcessEnv = process.env,
): PoolConfig {
    const cloudRun = Boolean(source.K_SERVICE);
    const vercel = Boolean(source.VERCEL);
    const serverless = cloudRun || vercel;
    const defaultPoolMax = vercel ? 3 : cloudRun ? 5 : 10;
    const applicationName = (
        source.DB_APPLICATION_NAME
        || source.K_REVISION
        || source.K_SERVICE
        || 'simsa-backend'
    ).slice(0, 63);
    const shared: PoolConfig = {
        max: boundedInteger(source.DB_POOL_MAX, defaultPoolMax, 1, 50, 'DB_POOL_MAX'),
        idleTimeoutMillis: boundedInteger(
            source.DB_POOL_IDLE_TIMEOUT_MS,
            serverless ? 10_000 : 30_000,
            1_000,
            300_000,
            'DB_POOL_IDLE_TIMEOUT_MS',
        ),
        connectionTimeoutMillis: boundedInteger(
            source.DB_CONNECT_TIMEOUT_MS,
            5_000,
            1_000,
            60_000,
            'DB_CONNECT_TIMEOUT_MS',
        ),
        application_name: applicationName,
        // Drizzle maps timestamp-without-time-zone columns as UTC and writes
        // JavaScript Dates as UTC. Set the session before its first query so
        // PostgreSQL defaultNow() values follow the same convention, regardless
        // of the host/cluster timezone. Preserve other operator startup options.
        options: utcSessionOptions(source.PGOPTIONS),
    };

    const connectionString = source.DATABASE_URL?.trim();
    const cloudSqlSocket = source.CLOUD_SQL_UNIX_SOCKET?.trim();
    const tcpHost = source.DB_HOST?.trim();
    const sslEnabled = strictBoolean(source.DB_SSL, false, 'DB_SSL');
    const rejectUnauthorized = strictBoolean(
        source.DB_SSL_REJECT_UNAUTHORIZED,
        true,
        'DB_SSL_REJECT_UNAUTHORIZED',
    );

    if (connectionString && (cloudSqlSocket || tcpHost)) {
        throw new Error(
            'DATABASE_URL cannot be combined with CLOUD_SQL_UNIX_SOCKET or DB_HOST',
        );
    }
    if (cloudSqlSocket && tcpHost) {
        throw new Error('Configure only one of CLOUD_SQL_UNIX_SOCKET or DB_HOST');
    }
    if (connectionString) {
        // node-postgres lets URL options override the PoolConfig options field.
        // Preserve the last URL options value (its existing precedence), then
        // enforce UTC last so a URL or PGOPTIONS cannot reintroduce clock drift.
        const url = new URL(connectionString);
        if (url.searchParams.has('options')) {
            // An empty final URL value falls back to PGOPTIONS in the driver;
            // retain that fallback so read-only and timeout settings survive.
            const configuredOptions = url.searchParams.getAll('options').at(-1) || source.PGOPTIONS;
            url.searchParams.set('options', utcSessionOptions(configuredOptions));
            return { ...shared, connectionString: url.toString() };
        }
        return { ...shared, connectionString };
    }

    const host = cloudSqlSocket || tcpHost;
    const user = source.DB_USER?.trim();
    const database = source.DB_NAME?.trim();
    if (!host || !user || !database || source.DB_PASSWORD === undefined) {
        throw new Error(
            'Configure DATABASE_URL or CLOUD_SQL_UNIX_SOCKET/DB_HOST with DB_USER, DB_PASSWORD, and DB_NAME',
        );
    }
    return {
        ...shared,
        host,
        user,
        password: source.DB_PASSWORD,
        database,
        port: boundedInteger(source.DB_PORT, 5432, 1, 65_535, 'DB_PORT'),
        // Cloud SQL Unix sockets are already protected by IAM at the attachment
        // boundary. TCP callers can explicitly enable TLS below.
        ssl: sslEnabled
            ? { rejectUnauthorized }
            : undefined,
    };
}

// Use PostgreSQL's native wire protocol so the API and persistent workers work
// with both managed providers (including Neon pooled URLs) and ordinary
// PostgreSQL installations. The previous Neon WebSocket-only pool could not
// connect to the PostgreSQL service used by the documented Docker deployment.
// On Vercel, keep the per-instance pool small and retire idle connections.
const pool = new Pool(buildDatabasePoolConfig());

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

