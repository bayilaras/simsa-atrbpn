import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { roleMiddleware } from '../middlewares/role.middleware.js';
import { httpMetrics } from '../services/http-metrics.service.js';
import { pool } from '../config/database.js';
import { timingSafeEqual } from 'node:crypto';
import { getOperationsStatus } from '../services/operations-status.service.js';
import { getReadiness } from '../services/readiness.service.js';
import { scheduleMalwareScanWake } from '../services/malware-scan-dispatch.service.js';

const router = Router();
// Wake before on-demand antivirus verification lapses (24 h definition TTL),
// so an idle day never leaves uploads waiting or /ready failing.
const SCANNER_REFRESH_BEFORE_MS = 6 * 3600_000;

// Dedicated automation credential, never an application session.
function monitorAuthorized(supplied: string) {
    const secret = process.env.OPERATIONS_MONITOR_TOKEN || '';
    const suppliedBytes = Buffer.from(supplied), expectedBytes = Buffer.from(`Bearer ${secret}`);
    return secret.length >= 32 && suppliedBytes.length === expectedBytes.length
        && timingSafeEqual(suppliedBytes, expectedBytes);
}

router.get('/probe', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!monitorAuthorized(req.get('authorization') || '')) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    const result = await getOperationsStatus();
    res.status(result.status === 'healthy' ? 200 : 503).json({
        timestamp: result.timestamp, status: result.status,
        checks: result.checks.map(({ id, status }) => ({ id, status })),
    });
});
// Acceleration only, like an upload: it never changes queue or quarantine state.
router.post('/scanner-wake', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!monitorAuthorized(req.get('authorization') || '')) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    let worker: { state?: unknown; required?: unknown; definitionsExpiresAt?: unknown } = {};
    try {
        const readiness = await getReadiness() as { dependencies?: { malwareWorker?: typeof worker } };
        worker = readiness?.dependencies?.malwareWorker ?? {};
    } catch { /* Unknown verification is treated as expired. */ }
    if (worker.state === 'disabled' || worker.required === false) {
        res.json({ status: 'not_required' });
        return;
    }
    const expires = typeof worker.definitionsExpiresAt === 'string' ? Date.parse(worker.definitionsExpiresAt) : NaN;
    if (worker.state === 'ready' && expires - Date.now() > SCANNER_REFRESH_BEFORE_MS) {
        res.json({ status: 'fresh' });
        return;
    }
    if (!scheduleMalwareScanWake()) {
        res.status(503).json({ status: 'unavailable' });
        return;
    }
    res.status(202).json({ status: 'scheduled' });
});
router.use(authMiddleware);
router.use(roleMiddleware(['super_admin']));
router.get('/status', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: await getOperationsStatus() });
});
router.get('/metrics', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const memory = process.memoryUsage();
    res.json({
        success: true,
        data: {
            ...httpMetrics.snapshot(),
            uptimeSeconds: Math.floor(process.uptime()),
            memoryBytes: { rss: memory.rss, heapUsed: memory.heapUsed, heapTotal: memory.heapTotal },
            databasePool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount },
        },
    });
});

export default router;
