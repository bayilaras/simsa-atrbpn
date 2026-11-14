import { Router, type Response } from 'express';
import { authMiddleware, type AuthRequest } from '../middlewares/auth.middleware.js';
import { roleMiddleware } from '../middlewares/role.middleware.js';
import { httpMetrics } from '../services/http-metrics.service.js';
import { pool } from '../config/database.js';
import { timingSafeEqual } from 'node:crypto';
import { getOperationsStatus, invalidateOperationsStatus } from '../services/operations-status.service.js';
import { hasWaitingScanWork, listFailedScans, recordScannerRun, requeueFailedScans } from '../services/malware-scan-requeue.service.js';
import { sensitiveLimiter } from '../middlewares/rate-limiter.middleware.js';
import { getReadiness } from '../services/readiness.service.js';
import { scheduleMalwareScanWake } from '../services/malware-scan-dispatch.service.js';
import { MALWARE_DEFINITION_REFRESH_BEFORE_MS } from '../services/malware-scanner.service.js';
import { getObjectStorageConfigurationStatus } from '../config/blob-storage.js';
import { measureStorageLatency, vercelBlobLatencyClient } from '../services/storage-latency.service.js';

const router = Router();
// Dedicated automation credentials, never an application session.
function bearerAuthorized(supplied: string, secret: string) {
    const suppliedBytes = Buffer.from(supplied), expectedBytes = Buffer.from(`Bearer ${secret}`);
    return secret.length >= 32 && suppliedBytes.length === expectedBytes.length
        && timingSafeEqual(suppliedBytes, expectedBytes);
}
const monitorAuthorized = (supplied: string) => bearerAuthorized(supplied, process.env.OPERATIONS_MONITOR_TOKEN || '');

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
// Acceleration only, like an upload: it never changes queue or quarantine
// state. Wakes once less than the refresh margin of the 24-hour antivirus
// definition lease remains, so the woken scanner renews it before it lapses,
// and whenever a file has waited for its scan longer than an upload's own
// wake should take (that wake may have failed or been cut short).
async function wakeScannerIfDue(res: Response) {
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
    if (worker.state === 'ready' && expires - Date.now() > MALWARE_DEFINITION_REFRESH_BEFORE_MS) {
        // An unreadable queue is treated as waiting work, never as an empty one.
        const waiting = await hasWaitingScanWork().catch(() => true);
        if (!waiting) {
            res.json({ status: 'fresh' });
            return;
        }
    }
    if (!scheduleMalwareScanWake()) {
        res.status(503).json({ status: 'unavailable' });
        return;
    }
    res.status(202).json({ status: 'scheduled' });
}
// Hourly GitHub monitor (best-effort schedule).
router.post('/scanner-wake', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!monitorAuthorized(req.get('authorization') || '')) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    await wakeScannerIfDue(res);
});
// Vercel Cron (backend/vercel.json) sends GET with `Bearer ${CRON_SECRET}`.
router.get('/scanner-wake', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!bearerAuthorized(req.get('authorization') || '', process.env.CRON_SECRET || '')) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    await wakeScannerIfDue(res);
});
// Operator-dispatched measurement (Operations Monitor input), never scheduled:
// each run writes, reads and deletes six small private probe objects.
let storageLatencyInFlight = false;
router.post('/storage-latency', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!monitorAuthorized(req.get('authorization') || '')) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    const storage = getObjectStorageConfigurationStatus();
    if (storage.provider !== 'vercel-blob-private' || !storage.ready) {
        res.json({ status: 'not_supported' });
        return;
    }
    if (storageLatencyInFlight) {
        res.status(429).json({ status: 'busy' });
        return;
    }
    storageLatencyInFlight = true;
    try {
        const measurement = await measureStorageLatency(vercelBlobLatencyClient, { sizes: [16 * 1024, 1024 * 1024], rounds: 3 });
        res.json({ status: 'measured', provider: storage.provider, functionRegion: process.env.VERCEL_REGION || null, ...measurement });
    } catch {
        res.status(503).json({ status: 'failed' });
    } finally {
        storageLatencyInFlight = false;
    }
});
router.use(authMiddleware);
router.use(roleMiddleware(['super_admin']));
router.get('/status', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: await getOperationsStatus() });
});
// Failed scans only; infected files are never listed or requeued.
router.get('/scan-failures', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
        res.json({ success: true, data: await listFailedScans() });
    } catch {
        res.status(503).json({ success: false, message: 'Daftar berkas yang gagal dipindai belum dapat dimuat. Coba lagi beberapa saat lagi.' });
    }
});
async function requeueScans(req: AuthRequest, res: Response, attachmentId?: string) {
    res.setHeader('Cache-Control', 'no-store');
    if (Object.keys(req.query).length || (req.body != null
        && (typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length))
        || (attachmentId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(attachmentId))) {
        res.status(400).json({ success: false, message: 'Permintaan antre ulang tidak valid.' });
        return;
    }
    try {
        const result = await requeueFailedScans({ attachmentId },
            { userId: req.user?.id, userEmail: req.user?.email, ipAddress: req.ip });
        if (attachmentId && !result.requeued) {
            res.status(409).json({ success: false, message: 'Berkas ini tidak sedang berstatus gagal dipindai. Muat ulang halaman untuk melihat status terbaru.' });
            return;
        }
        invalidateOperationsStatus();
        // Acceleration only; without it the scheduled scanner picks the files up.
        let wakeScheduled = false;
        if (result.requeued) { try { wakeScheduled = scheduleMalwareScanWake(); } catch { /* Queue state is already persisted. */ } }
        res.json({ success: true, data: { ...result, wakeScheduled } });
    } catch {
        res.status(503).json({ success: false, message: 'Berkas belum dapat diantre ulang. Coba lagi beberapa saat lagi.' });
    }
}
router.post('/scan-failures/requeue', sensitiveLimiter, (req: AuthRequest, res) => requeueScans(req, res));
router.post('/scan-failures/:attachmentId/requeue', sensitiveLimiter,
    (req: AuthRequest, res) => requeueScans(req, res, String(req.params.attachmentId)));
// "Jalankan pemindai": wakes the on-demand scanner now, as an upload does. It
// never changes queue or quarantine state. The request is audited first, so
// no run starts without its audit record.
router.post('/scanner-run', sensitiveLimiter, async (req: AuthRequest, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (Object.keys(req.query).length || (req.body != null
        && (typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length))) {
        res.status(400).json({ success: false, message: 'Permintaan menjalankan pemindai tidak valid.' });
        return;
    }
    try {
        await recordScannerRun({ userId: req.user?.id, userEmail: req.user?.email, ipAddress: req.ip });
    } catch {
        res.status(503).json({ success: false, message: 'Pemindai belum dapat dijalankan. Coba lagi beberapa saat lagi.' });
        return;
    }
    let wakeScheduled = false;
    try { wakeScheduled = scheduleMalwareScanWake(); } catch { /* reported below */ }
    if (!wakeScheduled) {
        res.status(503).json({ success: false, message: 'Pemindai tidak dapat dijalankan dari layanan ini. Periksa pengaturan pemindai pada layanan backend.' });
        return;
    }
    res.json({ success: true, data: { wakeScheduled } });
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
