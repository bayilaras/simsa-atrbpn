import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { roleMiddleware } from '../middlewares/role.middleware.js';
import { httpMetrics } from '../services/http-metrics.service.js';
import { pool } from '../config/database.js';

const router = Router();
router.use(authMiddleware);
router.use(roleMiddleware(['super_admin']));
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
