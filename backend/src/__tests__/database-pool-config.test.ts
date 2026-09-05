import { describe, expect, it, vi } from 'vitest';

vi.mock('pg', () => ({
    Pool: class MockPool {
        on() {
            return this;
        }
    },
}));

vi.mock('drizzle-orm/node-postgres', () => ({
    drizzle: vi.fn(() => ({})),
}));

vi.mock('../db/schema', () => ({}));
vi.mock('../utils/logger', () => ({
    createLogger: () => ({ error: vi.fn() }),
}));

vi.stubEnv('DATABASE_URL', 'postgresql://bootstrap.invalid/simsa');
const { buildDatabasePoolConfig } = await import('../config/database.js');
vi.unstubAllEnvs();

describe('database pool configuration', () => {
    it('uses bounded local defaults and trims a connection URL', () => {
        expect(buildDatabasePoolConfig({
            DATABASE_URL: '  postgresql://user:pass@db.example.test/simsa  ',
        })).toEqual({
            max: 10,
            idleTimeoutMillis: 30_000,
            connectionTimeoutMillis: 5_000,
            application_name: 'simsa-backend',
            options: '-c timezone=UTC',
            connectionString: 'postgresql://user:pass@db.example.test/simsa',
        });
    });

    it('keeps Cloud Run and Vercel pool defaults deliberately small', () => {
        expect(buildDatabasePoolConfig({
            DATABASE_URL: 'postgresql://db/simsa',
            K_SERVICE: 'simsa-api',
            K_REVISION: 'simsa-api-00042-abc',
        })).toMatchObject({
            max: 5,
            idleTimeoutMillis: 10_000,
            application_name: 'simsa-api-00042-abc',
        });
        expect(buildDatabasePoolConfig({
            DATABASE_URL: 'postgresql://db/simsa',
            K_SERVICE: 'simsa-api',
            VERCEL: '1',
        })).toMatchObject({
            max: 3,
            idleTimeoutMillis: 10_000,
        });
    });

    it('builds a Cloud SQL Unix socket configuration without requiring TLS', () => {
        expect(buildDatabasePoolConfig({
            CLOUD_SQL_UNIX_SOCKET: '/cloudsql/project:asia-southeast2:simsa',
            DB_USER: 'simsa_api',
            DB_PASSWORD: '',
            DB_NAME: 'simsa',
        })).toMatchObject({
            host: '/cloudsql/project:asia-southeast2:simsa',
            user: 'simsa_api',
            password: '',
            database: 'simsa',
            port: 5432,
            ssl: undefined,
        });
    });

    it('supports explicit TCP TLS and connection pool bounds', () => {
        expect(buildDatabasePoolConfig({
            DB_HOST: '10.10.0.3',
            DB_USER: 'simsa_api',
            DB_PASSWORD: 'secret',
            DB_NAME: 'simsa',
            DB_PORT: '5433',
            DB_SSL: ' TRUE ',
            DB_SSL_REJECT_UNAUTHORIZED: ' False ',
            DB_POOL_MAX: '7',
            DB_POOL_IDLE_TIMEOUT_MS: '15000',
            DB_CONNECT_TIMEOUT_MS: '9000',
        })).toMatchObject({
            host: '10.10.0.3',
            port: 5433,
            max: 7,
            idleTimeoutMillis: 15_000,
            connectionTimeoutMillis: 9_000,
            ssl: { rejectUnauthorized: false },
        });
    });

    it.each([
        { CLOUD_SQL_UNIX_SOCKET: '/cloudsql/project:region:instance' },
        { DB_HOST: '127.0.0.1' },
    ])('rejects DATABASE_URL combined with a discrete database host: %j', (authority) => {
        expect(() => buildDatabasePoolConfig({
            DATABASE_URL: 'postgresql://legacy.example/simsa',
            ...authority,
        })).toThrow(/DATABASE_URL cannot be combined/);
    });

    it('rejects simultaneous Unix-socket and TCP authorities', () => {
        expect(() => buildDatabasePoolConfig({
            CLOUD_SQL_UNIX_SOCKET: '/cloudsql/project:region:instance',
            DB_HOST: '127.0.0.1',
            DB_USER: 'simsa',
            DB_PASSWORD: '',
            DB_NAME: 'simsa',
        })).toThrow(/only one of CLOUD_SQL_UNIX_SOCKET or DB_HOST/);
    });

    it.each([
        ['DB_SSL', 'enabled'],
        ['DB_SSL_REJECT_UNAUTHORIZED', 'nope'],
    ])('rejects an invalid %s boolean', (name, value) => {
        expect(() => buildDatabasePoolConfig({
            DB_HOST: '10.10.0.3',
            DB_USER: 'simsa',
            DB_PASSWORD: 'secret',
            DB_NAME: 'simsa',
            [name]: value,
        })).toThrow(new RegExp(`${name} must be true or false`));
    });

    it.each([
        ['DB_POOL_MAX', '0'],
        ['DB_POOL_MAX', '51'],
        ['DB_POOL_MAX', '3.5'],
        ['DB_POOL_IDLE_TIMEOUT_MS', '999'],
        ['DB_CONNECT_TIMEOUT_MS', '60001'],
    ])('rejects an out-of-range %s value', (name, value) => {
        expect(() => buildDatabasePoolConfig({
            DATABASE_URL: 'postgresql://db/simsa',
            [name]: value,
        })).toThrow(/must be an integer between/);
    });

    it('requires either a URL or a complete discrete database authority', () => {
        expect(() => buildDatabasePoolConfig({
            DB_HOST: '127.0.0.1',
            DB_USER: 'simsa',
            DB_NAME: 'simsa',
        })).toThrow(/Configure DATABASE_URL/);
    });

    it('caps PostgreSQL application_name at its protocol limit', () => {
        expect(buildDatabasePoolConfig({
            DATABASE_URL: 'postgresql://db/simsa',
            DB_APPLICATION_NAME: 'x'.repeat(80),
        }).application_name).toBe('x'.repeat(63));
    });

    it.each([
        { DATABASE_URL: 'postgresql://user:pass@db.example.test/simsa' },
        { DB_HOST: '127.0.0.1', DB_USER: 'simsa', DB_PASSWORD: '', DB_NAME: 'simsa' },
        { CLOUD_SQL_UNIX_SOCKET: '/cloudsql/project:region:instance', DB_USER: 'simsa', DB_PASSWORD: '', DB_NAME: 'simsa' },
    ])('sets UTC before the first query for each connection authority: %j', async (authority) => {
        const { Client } = await vi.importActual<typeof import('pg')>('pg');
        const config = buildDatabasePoolConfig(authority);
        const client = new Client(config) as unknown as { getStartupConf(): { options: string } };
        expect(client.getStartupConf().options).toBe('-c timezone=UTC');
    });

    it('preserves other PGOPTIONS while making UTC the final session setting', async () => {
        const { Client } = await vi.importActual<typeof import('pg')>('pg');
        const config = buildDatabasePoolConfig({
            DATABASE_URL: 'postgresql://user:pass@db.example.test/simsa',
            PGOPTIONS: '  -c statement_timeout=9000 -c timezone=Asia/Bangkok  ',
        });
        const client = new Client(config) as unknown as { getStartupConf(): { options: string } };
        expect(client.getStartupConf().options)
            .toBe('-c statement_timeout=9000 -c timezone=Asia/Bangkok -c timezone=UTC');
    });

    it('preserves URL startup settings and TLS without letting a URL timezone override UTC', async () => {
        const { Client } = await vi.importActual<typeof import('pg')>('pg');
        const config = buildDatabasePoolConfig({
            DATABASE_URL: 'postgresql://user:pass@db.example.test/simsa?sslmode=verify-full&options=-c%20statement_timeout%3D9000%20-c%20timezone%3DAsia%2FBangkok',
            PGOPTIONS: '-c statement_timeout=1000 -c timezone=Pacific/Honolulu',
        });
        const url = new URL(config.connectionString!);
        expect(url.searchParams.get('sslmode')).toBe('verify-full');
        const client = new Client(config) as unknown as { getStartupConf(): { options: string } };
        expect(client.getStartupConf().options)
            .toBe('-c statement_timeout=9000 -c timezone=Asia/Bangkok -c timezone=UTC');
    });

    it.each([
        '?options=-c%20timezone%3DAsia%2FBangkok&options=-c%20statement_timeout%3D9000',
        '?%6fptions=-c%20statement_timeout%3D9000',
    ])('handles duplicate or encoded URL option keys using driver precedence: %s', async (query) => {
        const { Client } = await vi.importActual<typeof import('pg')>('pg');
        const config = buildDatabasePoolConfig({
            DATABASE_URL: `postgresql://user:pass@db.example.test/simsa${query}`,
        });
        const client = new Client(config) as unknown as { getStartupConf(): { options: string } };
        expect(client.getStartupConf().options).toBe('-c statement_timeout=9000 -c timezone=UTC');
        expect(new URL(config.connectionString!).searchParams.getAll('options')).toHaveLength(1);
    });

    it.each(['?options=', '?options=-c%20statement_timeout%3D9000&options='])(
        'preserves the driver PGOPTIONS fallback for an empty final URL options value: %s', async (query) => {
            const { Client } = await vi.importActual<typeof import('pg')>('pg');
            const config = buildDatabasePoolConfig({
                DATABASE_URL: `postgresql://user:pass@db.example.test/simsa${query}`,
                PGOPTIONS: '-c default_transaction_read_only=on -c timezone=Asia/Bangkok',
            });
            const client = new Client(config) as unknown as { getStartupConf(): { options: string } };
            expect(client.getStartupConf().options)
                .toBe('-c default_transaction_read_only=on -c timezone=Asia/Bangkok -c timezone=UTC');
        },
    );
});
