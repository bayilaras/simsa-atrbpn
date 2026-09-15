import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { roleMiddleware } from '../middlewares/role.middleware.js';
import { httpMetrics } from '../services/http-metrics.service.js';
import { pool } from '../config/database.js';
import { timingSafeEqual } from 'node:crypto';
import { getOperationsStatus } from '../services/operations-status.service.js';

const router = Router();
// Dedicated read-only automation credential, never an application session.
router.get('/probe', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const secret = process.env.OPERATIONS_MONITOR_TOKEN || '';
    const supplied = req.get('authorization') || '';
    const expected = `Bearer ${secret}`;
    const suppliedBytes = Buffer.from(supplied), expectedBytes = Buffer.from(expected);
    if (secret.length < 32 || suppliedBytes.length !== expectedBytes.length
        || !timingSafeEqual(suppliedBytes, expectedBytes)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    const result = await getOperationsStatus();
    res.status(result.status === 'healthy' ? 200 : 503).json({
        timestamp: result.timestamp, status: result.status,
        checks: result.checks.map(({ id, status }) => ({ id, status })),
    });
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
