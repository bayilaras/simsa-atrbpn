import express from 'express';
import request from 'supertest';
import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpMetrics } from '../services/http-metrics.service.js';
import { createHttpObservability } from '../middlewares/http-observability.middleware.js';
import { currentRequestId } from '../utils/request-context.js';

const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../utils/logger.js', () => ({ logger: log }));
beforeEach(() => vi.clearAllMocks());

describe('HTTP operational telemetry', () => {
    it('counts responses and latency buckets once, keeping aborts distinct from successes', () => {
        const metrics = new HttpMetrics();
        const success = metrics.start('/api/surat-masuk/secret-id', 'GET');
        const failure = metrics.start('/api/surat-masuk/another-id', 'GET');
        const aborted = metrics.start('/api/surat-masuk', 'GET');
        expect(metrics.snapshot().activeRequests).toBe(3);
        success.finish(200, 20);
        success.finish(200, 40);
        failure.finish(503, 750);
        aborted.finish(200, 15000, true);
        const snapshot = metrics.snapshot();
        expect(snapshot.activeRequests).toBe(0);
        expect(snapshot.requests).toHaveLength(1);
        expect(snapshot.requests[0]).toMatchObject({ count: 3, aborted: 1, statusClasses: { '2xx': 1, '5xx': 1 } });
        expect(snapshot.requests[0].latencyMs).toContainEqual({ upperBound: 25, count: 1 });
        expect(snapshot.requests[0].latencyMs).toContainEqual({ upperBound: 1000, count: 2 });
        expect(snapshot.requests[0].latencyMs.at(-1)).toEqual({ upperBound: null, count: 3 });
    });

    it('bounds labels even for many arbitrary paths and methods', () => {
        const metrics = new HttpMetrics();
        for (let index = 0; index < 5000; index++) metrics.start(`/api/private-${index}`, `CUSTOM-${index}`).finish(404, 3);
        const snapshot = metrics.snapshot();
        expect(snapshot.requests).toHaveLength(1);
        expect(snapshot.requests[0]).toMatchObject({ group: 'other-api', method: 'OTHER', count: 5000 });
        expect(JSON.stringify(snapshot)).not.toContain('private-');
    });

    it('keeps concurrent request contexts separate and never trusts a supplied correlation ID', async () => {
        const metrics = new HttpMetrics();
        const app = express();
        app.use(createHttpObservability(metrics));
        app.get('/api/arsip/:id', async (_req, res) => {
            const before = currentRequestId();
            await new Promise(resolve => setTimeout(resolve, 10));
            res.json({ before, after: currentRequestId() });
        });
        const [one, two] = await Promise.all([
            request(app).get('/api/arsip/secret-one?token=secret-query').set('X-Request-ID', 'forged').set('Authorization', 'Bearer secret-token'),
            request(app).get('/api/arsip/secret-two').set('Cookie', 'secret-cookie'),
        ]);
        for (const response of [one, two]) {
            expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
            expect(response.body.before).toBe(response.headers['x-request-id']);
            expect(response.body.after).toBe(response.body.before);
        }
        expect(one.body.before).not.toBe(two.body.before);
        expect(currentRequestId()).toBeUndefined();
        const logs = JSON.stringify(log.info.mock.calls);
        expect(logs).not.toMatch(/secret-|forged/);
        expect(metrics.snapshot().requests[0]).toMatchObject({ count: 2, group: '/api/arsip' });
    });

    it('records rejected responses without serializing body, query, or headers', async () => {
        const metrics = new HttpMetrics();
        const app = express();
        app.use(createHttpObservability(metrics));
        app.use(express.json());
        app.post('/api/auth/sign-in/email', (_req, res) => res.status(401).json({ error: 'Rejected' }));
        await request(app).post('/api/auth/sign-in/email?email=private@example.test').send({ password: 'super-secret' }).expect(401);
        expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401, group: '/api/auth' }), expect.any(String));
        expect(JSON.stringify(log.warn.mock.calls)).not.toMatch(/super-secret|private@example/);
    });

    it('releases the active request count when a client disconnects before finish', () => {
        const metrics = new HttpMetrics();
        const response = Object.assign(new EventEmitter(), { locals: {}, statusCode: 200, writableFinished: false, setHeader: vi.fn() });
        createHttpObservability(metrics)({ path: '/api/files/private', method: 'GET' } as any, response as any, vi.fn());
        response.emit('close');
        response.emit('finish');
        expect(metrics.snapshot().activeRequests).toBe(0);
        expect(metrics.snapshot().requests[0]).toMatchObject({ count: 1, aborted: 1, statusClasses: { '2xx': 0 } });
        expect(log.error).toHaveBeenCalledTimes(1);
    });
});
