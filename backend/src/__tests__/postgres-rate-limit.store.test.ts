import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import express from 'express';
import request from 'supertest';
import { waitUntil } from '@vercel/functions';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PostgresRateLimitStore, type RateLimitQuery } from '../services/postgres-rate-limit.store.js';
import { createAuthAttemptLimiter } from '../middlewares/auth-attempt-limiter.middleware.js';
import { logger } from '../utils/logger.js';
import { publicErrorResponse, publicErrorStatus } from '../utils/public-error.js';

vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() }));

let database: PGlite;
const secret = 'test-secret-not-a-production-credential'.repeat(2);
const execute: RateLimitQuery = (sql, values) => database.query(sql, values);
const store = (bucket = 'auth') => {
    const value = new PostgresRateLimitStore(bucket, secret, execute);
    value.init({ windowMs: 60_000 } as any);
    return value;
};
beforeAll(async () => {
    database = new PGlite();
    await database.waitReady;
    await database.exec('CREATE ROLE simsa_api_runtime; CREATE ROLE simsa_backup_reader;');
    await database.exec(readFileSync(new URL('../db/migrations/0039_shared_rate_limits.sql', import.meta.url), 'utf8'));
}, 30_000);
beforeEach(() => { vi.clearAllMocks(); return database.exec('TRUNCATE public.shared_rate_limits'); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
afterAll(() => database?.close());

describe('shared PostgreSQL rate limits', () => {
    it('applies Better Auth rolling rules atomically across consumers without extending rejected windows', async () => {
        const one = store('better-auth'); const two = store('better-auth');
        const rule = { window: 60, max: 3 };
        const results = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? one : two).consume('login-client', rule)));
        expect(results.filter(value => value.allowed)).toHaveLength(3);
        expect(results.filter(value => !value.allowed).every(value => value.retryAfter! > 0)).toBe(true);
        const before = (await database.query<any>('SELECT reset_at FROM shared_rate_limits')).rows[0].reset_at;
        expect(await store('better-auth').consume('login-client', rule)).toMatchObject({ allowed: false });
        expect((await database.query<any>('SELECT reset_at FROM shared_rate_limits')).rows[0].reset_at).toEqual(before);
        await database.exec("UPDATE shared_rate_limits SET reset_at = statement_timestamp() - interval '1 second'");
        expect(await two.consume('login-client', rule)).toEqual({ allowed: true, retryAfter: null });
    });
    it('shares atomic increments across instances and a replacement process store', async () => {
        const first = store(); const second = store();
        const results = await Promise.all(Array.from({ length: 30 }, (_, index) =>
            (index % 2 ? first : second).increment('192.0.2.10')));
        expect(results.map(value => value.totalHits).sort((a, b) => a - b)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
        expect(new Set(results.map(value => value.resetTime!.getTime())).size).toBe(1);
        expect((await store().increment('192.0.2.10')).totalHits).toBe(31);
    });
    it('isolates policies and users, stores only HMAC keys, and never exposes identifiers in SQL', async () => {
        await store().increment('192.0.2.10');
        expect((await store('upload').increment('192.0.2.10')).totalHits).toBe(1);
        expect((await store().increment('192.0.2.11')).totalHits).toBe(1);
        const { rows } = await database.query('SELECT * FROM public.shared_rate_limits');
        expect(rows).toHaveLength(3);
        expect(JSON.stringify(rows)).not.toContain('192.0.2');
    });
    it('resets expired windows with the database clock and clears stale rows on a cold start', async () => {
        const first = store(); await first.increment('client'); await first.increment('client');
        await database.exec("UPDATE public.shared_rate_limits SET reset_at = statement_timestamp() - interval '1 second'");
        expect((await first.increment('client')).totalHits).toBe(1);
        await database.exec("UPDATE public.shared_rate_limits SET reset_at = statement_timestamp() - interval '1 second'");
        await store().increment('other');
        expect((await database.query('SELECT * FROM public.shared_rate_limits')).rows).toHaveLength(1);
    });
    it('does not let a late successful response reduce another request window', async () => {
        const first = store(); const original = await first.increment('client');
        await first.decrementInWindow('client', original.resetTime!);
        expect((await first.increment('client')).totalHits).toBe(1);
        await database.exec("UPDATE public.shared_rate_limits SET reset_at = statement_timestamp() - interval '1 second'");
        first.init({ windowMs: 120_000 } as any);
        await first.increment('client');
        await first.decrementInWindow('client', original.resetTime!);
        await first.decrement('client');
        expect((await first.increment('client')).totalHits).toBe(2);
    });
    it('never makes a refunded counter negative', async () => {
        const first = store(); const original = await first.increment('client');
        await first.decrementInWindow('client', original.resetTime!);
        await first.decrementInWindow('client', original.resetTime!);
        expect((await database.query('SELECT hits FROM shared_rate_limits')).rows).toEqual([{ hits: 0 }]);
    });
    it('fails closed on a database outage without disclosing its exception', async () => {
        const unavailable = new PostgresRateLimitStore('auth', secret, async () => { throw new Error('private-database-canary'); });
        await expect(unavailable.increment('client')).rejects.toMatchObject({ statusCode: 503 });
        await expect(unavailable.increment('client')).rejects.not.toThrow('private-database-canary');
    });
    it('grants API counters only, without public mutation or backup mutation', async () => {
        const result = await database.query(`SELECT
            has_table_privilege('simsa_api_runtime', 'public.shared_rate_limits', 'INSERT') AS api_write,
            has_table_privilege('simsa_backup_reader', 'public.shared_rate_limits', 'SELECT') AS backup_read,
            has_table_privilege('simsa_backup_reader', 'public.shared_rate_limits', 'UPDATE') AS backup_write`);
        expect(result.rows).toEqual([{ api_write: true, backup_read: true, backup_write: false }]);
    });
});

function authServer(counter: PostgresRateLimitStore, handler: express.RequestHandler) {
    const app = express();
    app.use(createAuthAttemptLimiter({ store: counter, shared: true, maximum: 5 }));
    app.post('/', handler);
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        res.status(publicErrorStatus(error)).json(publicErrorResponse(error));
    });
    return app;
}

const finishRefunds = () => Promise.all(vi.mocked(waitUntil).mock.calls.map(([work]) => work));

describe('successful authentication refunds', () => {
    it('permits repeated successful logins behind one NAT but shares five failed attempts across two instances', async () => {
        vi.stubEnv('VERCEL', '1');
        const apps = [store(), store()].map(counter => authServer(counter, (req, res) => {
            res.sendStatus(req.header('x-test-result') === 'failed' ? 401 : 204);
        }));
        for (let i = 0; i < 12; i += 1) {
            await request(apps[i % 2]!).post('/').expect(204);
            await finishRefunds();
        }
        expect((await database.query('SELECT hits FROM shared_rate_limits')).rows).toEqual([{ hits: 0 }]);
        for (let i = 0; i < 5; i += 1) {
            await request(apps[i % 2]!).post('/').set('x-test-result', 'failed').expect(401);
        }
        await request(apps[1]!).post('/').set('x-test-result', 'failed').expect(429);
        await finishRefunds();
        expect((await database.query('SELECT hits FROM shared_rate_limits')).rows).toEqual([{ hits: 5 }]);
    });

    it.each([204, 401])('returns rejected reservations across two instances while preserving admitted responses with status %i', async status => {
        vi.stubEnv('VERCEL', '1');
        let release: () => void = () => {};
        const pending = new Promise<void>(resolve => { release = resolve; });
        let admitted = 0;
        let rejected = 0;
        const apps = [store(), store()].map(counter => authServer(counter, async (_req, res) => {
            admitted++;
            await pending;
            res.sendStatus(status);
        }));
        const attempts = Array.from({ length: 10 }, (_, index) => request(apps[index % 2]!).post('/').then(response => {
            if (response.status === 429) rejected++;
            return response.status;
        }));
        try {
            await expect.poll(() => rejected).toBe(5);
            expect(admitted).toBe(5);
            expect((await database.query('SELECT hits FROM shared_rate_limits')).rows).toEqual([{ hits: 5 }]);
            await request(apps[0]!).post('/').expect(429);
            expect(admitted).toBe(5);
        } finally { release(); }
        const results = await Promise.all(attempts);
        expect(results.filter(value => value === status)).toHaveLength(5);
        expect(results.filter(value => value === 429)).toHaveLength(5);
        await finishRefunds();
        expect((await database.query('SELECT hits FROM shared_rate_limits')).rows)
            .toEqual([{ hits: status === 204 ? 0 : 5 }]);
        await request(apps[1]!).post('/').expect(status === 204 ? 204 : 429);
        await finishRefunds();
    });

    it('does not let a delayed rejected reservation refund reduce a newer window', async () => {
        vi.stubEnv('VERCEL', '1');
        const counter = store();
        const app = authServer(counter, (_req, res) => res.sendStatus(401));
        for (let i = 0; i < 5; i++) await request(app).post('/').expect(401);
        const refund = counter.decrementInWindow.bind(counter);
        let release: () => void = () => {};
        const pending = new Promise<void>(resolve => { release = resolve; });
        const delayed = vi.spyOn(counter, 'decrementInWindow').mockImplementationOnce(async (key, resetTime) => {
            await pending;
            await refund(key, resetTime);
        });
        const rejected = request(app).post('/').then(response => response.status);
        try {
            await expect.poll(() => delayed.mock.calls.length).toBe(1);
            expect(waitUntil).toHaveBeenCalledTimes(6);
            await database.exec("UPDATE shared_rate_limits SET reset_at = statement_timestamp() - interval '1 second'");
            counter.init({ windowMs: 120_000 } as any);
            await request(app).post('/').expect(401);
            expect((await database.query('SELECT hits FROM shared_rate_limits')).rows).toEqual([{ hits: 1 }]);
        } finally { release(); }
        expect(await rejected).toBe(429);
        await finishRefunds();
        expect((await database.query('SELECT hits FROM shared_rate_limits')).rows).toEqual([{ hits: 1 }]);
    });

    it('preserves Better Auth burst limits without poisoning the outer failure quota with its 429 responses', async () => {
        vi.stubEnv('VERCEL', '1');
        const burst = store('better-auth');
        let checkedCredentials = 0;
        const app = authServer(store(), async (_req, res) => {
            const admission = await burst.consume('sign-in:office-network', { window: 10, max: 3 });
            if (!admission.allowed) return res.sendStatus(429);
            checkedCredentials++;
            res.sendStatus(204);
        });
        const responses: number[] = [];
        for (let wave = 0; wave < 2; wave++) {
            responses.push(...await Promise.all(Array.from({ length: 5 }, () =>
                request(app).post('/').then(response => response.status))));
            await finishRefunds();
            expect((await database.query("SELECT hits FROM shared_rate_limits WHERE bucket='auth'")).rows).toEqual([{ hits: 0 }]);
        }
        expect(responses.filter(status => status === 204)).toHaveLength(3);
        expect(responses.filter(status => status === 429)).toHaveLength(7);
        expect(checkedCredentials).toBe(3);
        expect((await database.query("SELECT hits FROM shared_rate_limits WHERE bucket='better-auth'")).rows).toEqual([{ hits: 10 }]);
    });

    it('keeps a rejected reservation refund registered after its client disconnects', async () => {
        vi.stubEnv('VERCEL', '1');
        const counter = store();
        const app = authServer(counter, (_req, res) => res.sendStatus(401));
        for (let i = 0; i < 5; i++) await request(app).post('/').expect(401);
        const refund = counter.decrementInWindow.bind(counter);
        let release: () => void = () => {};
        const pending = new Promise<void>(resolve => { release = resolve; });
        const delayed = vi.spyOn(counter, 'decrementInWindow').mockImplementationOnce(async (key, resetTime) => {
            await pending;
            await refund(key, resetTime);
        });
        const blocked = request(app).post('/');
        const completed = blocked.then(() => undefined, () => undefined);
        try {
            await expect.poll(() => delayed.mock.calls.length).toBe(1);
            expect(waitUntil).toHaveBeenCalledTimes(6);
            blocked.abort();
        } finally { release(); }
        await completed;
        await finishRefunds();
        expect((await database.query('SELECT hits FROM shared_rate_limits')).rows).toEqual([{ hits: 5 }]);
    });

    it('fails closed before returning a rejection if its database refund times out', async () => {
        vi.stubEnv('VERCEL', '1');
        const counter = new PostgresRateLimitStore('auth', secret, async (sql, values) => {
            if (sql.trimStart().startsWith('UPDATE public.shared_rate_limits')) {
                throw Object.assign(new Error('private-refund-timeout-canary'), { code: 'ETIMEDOUT' });
            }
            return execute(sql, values);
        });
        const handler = vi.fn((_req: express.Request, res: express.Response) => res.sendStatus(401));
        const app = authServer(counter, handler);
        for (let i = 0; i < 5; i++) await request(app).post('/').expect(401);
        const response = await request(app).post('/').expect(503);
        expect(response.body.code).toBe('SERVICE_UNAVAILABLE');
        expect(response.text).not.toContain('private-refund-timeout-canary');
        expect(handler).toHaveBeenCalledTimes(5);
        expect((await database.query('SELECT hits FROM shared_rate_limits')).rows).toEqual([{ hits: 6 }]);
        await finishRefunds();
    });

    it('does not refund a saturated counter when the rejection did not add a new hit', async () => {
        vi.stubEnv('VERCEL', '1');
        const counter = store();
        const refund = vi.spyOn(counter, 'decrementInWindow');
        const app = authServer(counter, (_req, res) => res.sendStatus(401));
        await request(app).post('/').expect(401);
        await database.exec('UPDATE shared_rate_limits SET hits = 2147483647');
        await request(app).post('/').expect(503);
        expect(refund).not.toHaveBeenCalled();
        expect((await database.query('SELECT hits FROM shared_rate_limits')).rows).toEqual([{ hits: 2147483647 }]);
        await finishRefunds();
    });

    it('registers Vercel background work before the handler and captures immutable request-window metadata', async () => {
        vi.stubEnv('VERCEL', '1');
        const app = authServer(store(), (req, res) => {
            expect(waitUntil).toHaveBeenCalledOnce();
            const info = (req as any).authRateLimit;
            info.key = 'different-limiter-key';
            info.resetTime.setFullYear(2000);
            res.sendStatus(204);
        });
        await request(app).post('/').expect(204);
        await finishRefunds();
        expect((await database.query('SELECT hits FROM shared_rate_limits')).rows).toEqual([{ hits: 0 }]);
    });

    it('retains server errors and aborted responses while returning only the capacity rejection reservation', async () => {
        vi.stubEnv('VERCEL', '1');
        const counter = store();
        const refund = vi.spyOn(counter, 'decrementInWindow');
        const app = authServer(counter, (_req, res) => res.sendStatus(503));
        for (let i = 0; i < 5; i += 1) await request(app).post('/').expect(503);
        await request(app).post('/').expect(429);
        const aborted = authServer(store('aborted'), (_req, res) => { res.destroy(); });
        await expect(request(aborted).post('/')).rejects.toThrow();
        await finishRefunds();
        expect(refund).toHaveBeenCalledOnce();
        expect((await database.query("SELECT hits FROM shared_rate_limits WHERE bucket='auth'")).rows).toEqual([{ hits: 5 }]);
        expect((await database.query("SELECT hits FROM shared_rate_limits WHERE bucket='aborted'")).rows).toEqual([{ hits: 1 }]);
    });

    it('settles refund failures without changing the response or exposing database errors', async () => {
        vi.stubEnv('VERCEL', '1');
        const counter = store();
        vi.spyOn(counter, 'decrementInWindow').mockRejectedValue(new Error('private-db-canary'));
        const log = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        await request(authServer(counter, (_req, res) => res.sendStatus(204))).post('/').expect(204);
        await expect(finishRefunds()).resolves.toBeDefined();
        expect(log).toHaveBeenCalledWith({ event: 'auth_rate_limit_refund_failed' }, expect.any(String));
        expect(JSON.stringify(log.mock.calls)).not.toContain('private-db-canary');
        expect((await database.query('SELECT hits FROM shared_rate_limits')).rows).toEqual([{ hits: 1 }]);
    });
});
