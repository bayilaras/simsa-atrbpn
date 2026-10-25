import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { RequestHandler } from 'express';
import { httpMetrics, type HttpMetrics } from '../services/http-metrics.service.js';
import { requestContext } from '../utils/request-context.js';
import { logger } from '../utils/logger.js';

export function createHttpObservability(metrics: HttpMetrics = httpMetrics): RequestHandler {
    return (req, res, next) => {
        // A server-generated identifier cannot be forged into another request's
        // log context by a caller-controlled header.
        const requestId = randomUUID();
        res.locals.requestId = requestId;
        res.setHeader('X-Request-ID', requestId);
        const started = performance.now();
        const observation = metrics.start(req.path, req.method);
        let recorded = false;
        const complete = () => {
            if (recorded) return;
            recorded = true;
            const aborted = !res.writableFinished;
            const durationMs = Math.round((performance.now() - started) * 100) / 100;
            observation.finish(res.statusCode, durationMs, aborted);
            const fields = {
                event: 'http_request_completed', requestId,
                group: observation.group, method: observation.method,
                statusCode: res.statusCode, durationMs, aborted,
            };
            if (aborted || res.statusCode >= 500) logger.error(fields, 'HTTP request failed');
            else if (res.statusCode >= 400) logger.warn(fields, 'HTTP request rejected');
            else if (observation.group !== 'health' && observation.group !== 'frontend') logger.info(fields, 'HTTP request completed');
        };
        res.once('finish', complete);
        res.once('close', complete);
        requestContext.run({ requestId }, next);
    };
}
