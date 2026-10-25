import { readFileSync } from 'node:fs';
import express from 'express';
import request from 'supertest';
import { rateLimit } from 'express-rate-limit';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresRateLimitStore } from '../src/services/postgres-rate-limit.store.js';
import { createAuthAttemptLimiter } from '../src/middlewares/auth-attempt-limiter.middleware.js';
import { publicErrorResponse, publicErrorStatus } from '../src/utils/public-error.js';

const databaseUrl = process.env.TEST_POSTGRES_URL;
if (!databaseUrl || !/^simsa_(?:test|rate_limit_test(?:_[a-z0-9]+)?)$/.test(new URL(databaseUrl).pathname.slice(1))) {
    throw new Error('TEST_POSTGRES_URL must point to disposable simsa_test or simsa_rate_limit_test.');
}
const pools = [0, 1].map(() => new Pool({ connectionString: databaseUrl, max: 4,
    connectionTimeoutMillis: 5000, query_timeout: 5000, statement_timeout: 5000 }));
const secret = 'synthetic-rate-limit-test-secret-000000';
const store = (bucket: string, poolIndex = 0) => new PostgresRateLimitStore(bucket, secret,
    (text, values) => pools[poolIndex]!.query(text, values));

beforeAll(async () => {
    // CI already runs the canonical migrator/grant policy; an isolated local
    // fixture may start with only its preinstalled runtime roles instead.
    const { rows } = await pools[0]!.query("SELECT to_regclass('public.shared_rate_limits') AS existing");
    if (!rows[0].existing) await pools[0]!.query(readFileSync(new URL('../src/db/migrations/0039_shared_rate_limits.sql', import.meta.url), 'utf8'));
});
beforeEach(async () => { await pools[0]!.query('TRUNCATE public.shared_rate_limits'); });
afterAll(async () => { await Promise.all(pools.map(pool => pool.end())); });

function server(bucket: string, index: number, limit = 5) {
    const app = express();
    app.set('trust proxy', false);
    app.use(rateLimit({ store: store(bucket, index), limit, windowMs: 60_000,
        passOnStoreError: false, standardHeaders: true, legacyHeaders: false }));
    app.get('/', (_req, res) => { res.json({ admitted: true }); });
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        res.status(publicErrorStatus(error)).json(publicErrorResponse(error));
    });
    return app;
}

describe('shared rate limits on native PostgreSQL', () => {
    it('atomically counts 80 requests across independent pools and replacement instances', async () => {
        const stores = [store('atomic', 0), store('atomic', 1)];
        const responses = await Promise.all(Array.from({ length: 80 }, (_, index) => stores[index % 2]!.increment('synthetic-client')));
        expect(responses.map(response => response.totalHits).sort((a, b) => a - b)).toEqual(Array.from({ length: 80 }, (_, index) => index + 1));
        expect((await store('atomic').increment('synthetic-client')).totalHits).toBe(81);
        const rows = await pools[0]!.query('SELECT * FROM public.shared_rate_limits');
        expect(rows.rowCount).toBe(1);
        expect(rows.rows[0].key_hash).toMatch(/^[a-f0-9]{64}$/);
        expect(JSON.stringify(rows.rows)).not.toContain('synthetic-client');
    });

    it('enforces one HTTP quota across two servers and does not reset on replacement', async () => {
        const apps = [server('http', 0), server('http', 1)];
        const responses = await Promise.all(Array.from({ length: 20 }, (_, index) => request(apps[index % 2]!).get('/')));
        expect(responses.filter(response => response.status === 200)).toHaveLength(5);
        expect(responses.filter(response => response.status === 429)).toHaveLength(15);
        await request(server('http', 1)).get('/').expect(429);
        await pools[0]!.query("UPDATE public.shared_rate_limits SET reset_at = statement_timestamp() - interval '1 second'");
        await request(apps[0]!).get('/').expect(200);
    });

    it('enforces Better Auth admission atomically without extending a blocked window', async () => {
        const stores = [store('better-auth', 0), store('better-auth', 1)];
        const decisions = await Promise.all(Array.from({ length: 25 }, (_, index) => stores[index % 2]!.consume('login:synthetic-client', { max: 3, window: 60 })));
        expect(decisions.filter(result => result.allowed)).toHaveLength(3);
        expect(decisions.filter(result => !result.allowed)).toHaveLength(22);
        const before = (await pools[0]!.query('SELECT reset_at FROM public.shared_rate_limits')).rows[0].reset_at;
        expect((await store('better-auth').consume('login:synthetic-client', { max: 3, window: 60 })).allowed).toBe(false);
        const after = (await pools[0]!.query('SELECT reset_at FROM public.shared_rate_limits')).rows[0].reset_at;
        expect(after).toEqual(before);
    });

    it('refunds successful logins across servers while retaining failed attempts', async () => {
        const apps = [0, 1].map(index => {
            const app = express();
            app.use(createAuthAttemptLimiter({ store: store('auth-http', index), shared: true, maximum: 5 }));
            app.post('/success', (_req, res) => { res.sendStatus(204); });
            app.post('/failure', (_req, res) => { res.sendStatus(401); });
            return app;
        });
        for (let index = 0; index < 12; index++) {
            await request(apps[index % 2]!).post('/success').expect(204);
            await expect.poll(async () => Number((await pools[0]!.query(
                "SELECT hits FROM public.shared_rate_limits WHERE bucket = 'auth-http'"
            )).rows[0]?.hits)).toBe(0);
        }
        for (let index = 0; index < 5; index++) {
            await request(apps[index % 2]!).post('/failure').expect(401);
        }
        await request(apps[1]!).post('/failure').expect(429);
    });

    it('matches PostgreSQL microsecond windows and rejects late refunds from an older window', async () => {
        const first = store('auth-window');
        const replacement = store('auth-window', 1);
        await first.increment('synthetic-client');
        // Fix the fractional part so this test always exercises the precision
        // difference between timestamptz and node-postgres JavaScript Date.
        await pools[0]!.query("UPDATE public.shared_rate_limits SET reset_at = date_trunc('second', reset_at) + interval '123456 microseconds'");
        const admitted = await first.increment('synthetic-client');
        expect(admitted.resetTime!.getUTCMilliseconds()).toBe(123);
        await replacement.decrementInWindow('synthetic-client', admitted.resetTime!);
        expect((await pools[0]!.query('SELECT hits FROM public.shared_rate_limits')).rows[0].hits).toBe(1);
        await pools[0]!.query("UPDATE public.shared_rate_limits SET reset_at = statement_timestamp() - interval '1 second'");
        await replacement.increment('synthetic-client');
        await first.decrementInWindow('synthetic-client', admitted.resetTime!);
        expect((await pools[0]!.query('SELECT hits FROM public.shared_rate_limits')).rows[0].hits).toBe(1);
    });

    it.each([204, 401])('returns capacity rejections across pools while preserving admitted response status %i', async status => {
        let release: () => void = () => {};
        const pending = new Promise<void>(resolve => { release = resolve; });
        let admitted = 0;
        let rejected = 0;
        const apps = [0, 1].map(index => {
            const app = express();
            app.use(createAuthAttemptLimiter({ store: store('auth-burst', index), shared: true, maximum: 5 }));
            app.post('/', async (_req, res) => {
                admitted++;
                await pending;
                res.sendStatus(status);
            });
            return app;
        });
        const hits = async () => Number((await pools[0]!.query(
            "SELECT hits FROM public.shared_rate_limits WHERE bucket = 'auth-burst'"
        )).rows[0]?.hits);
        const attempts = Array.from({ length: 10 }, (_, index) => request(apps[index % 2]!).post('/').then(response => {
            if (response.status === 429) rejected++;
            return response.status;
        }));
        try {
            await expect.poll(() => rejected).toBe(5);
            expect(admitted).toBe(5);
            expect(await hits()).toBe(5);
            await request(apps[1]!).post('/').expect(429);
            expect(admitted).toBe(5);
        } finally { release(); }
        const responses = await Promise.all(attempts);
        expect(responses.filter(value => value === status)).toHaveLength(5);
        expect(responses.filter(value => value === 429)).toHaveLength(5);
        await expect.poll(hits).toBe(status === 204 ? 0 : 5);
        await request(apps[0]!).post('/').expect(status === 204 ? 204 : 429);
        await expect.poll(hits).toBe(status === 204 ? 0 : 5);
    });

    it('returns a sanitized 503 when the database store cannot accept a request', async () => {
        await pools[0]!.query('ALTER TABLE public.shared_rate_limits RENAME TO shared_rate_limits_offline');
        try {
            const response = await request(server('outage', 0)).get('/').expect(503);
            expect(response.body.code).toBe('SERVICE_UNAVAILABLE');
            expect(response.text).not.toMatch(/relation|shared_rate_limits|SELECT|INSERT|password/i);
        } finally {
            await pools[0]!.query('ALTER TABLE public.shared_rate_limits_offline RENAME TO shared_rate_limits');
        }
    });

    it('keeps the Better Auth burst gate across pools without turning its rejections into failed logins', async () => {
        let checkedCredentials = 0;
        const apps = [0, 1].map(index => {
            const app = express();
            const burst = store('better-auth-burst', index);
            app.use(createAuthAttemptLimiter({ store: store('auth-nested', index), shared: true, maximum: 5 }));
            app.post('/', async (_req, res) => {
                const admission = await burst.consume('sign-in:office-network', { window: 10, max: 3 });
                if (!admission.allowed) return res.sendStatus(429);
                checkedCredentials++;
                res.sendStatus(204);
            });
            return app;
        });
        const responses: number[] = [];
        for (let wave = 0; wave < 2; wave++) {
            responses.push(...await Promise.all(Array.from({ length: 5 }, (_, index) =>
                request(apps[index % 2]!).post('/').then(response => response.status))));
            await expect.poll(async () => Number((await pools[0]!.query(
                "SELECT hits FROM public.shared_rate_limits WHERE bucket='auth-nested'"
            )).rows[0]?.hits)).toBe(0);
        }
        expect(responses.filter(status => status === 204)).toHaveLength(3);
        expect(responses.filter(status => status === 429)).toHaveLength(7);
        expect(checkedCredentials).toBe(3);
        expect((await pools[0]!.query("SELECT hits FROM public.shared_rate_limits WHERE bucket='better-auth-burst'")).rows[0].hits).toBe(10);
    });
});
