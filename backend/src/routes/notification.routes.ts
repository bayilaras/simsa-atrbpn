import { Router, Response } from 'express';
import { notificationService } from '../services/notification.service';
import { authMiddleware, AuthRequest } from '../middlewares/auth.middleware';
import { validateBody } from '../middlewares/validate.middleware';
import { markAllReadSchema } from '../validators/schemas';
import { createLogger } from '../utils/logger';

const log = createLogger('NotificationRoutes');

const router = Router();

// All routes require authentication
router.use(authMiddleware);

/**
 * @swagger
 * /api/notifications:
 *   get:
 *     summary: Get all notifications
 *     tags: [Notifications]
 *     parameters:
 *       - in: query
 *         name: unitKerjaId
 *         required: false
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: List of notifications with counts
 */
router.get('/', async (req: AuthRequest, res: Response) => {
    try {
        const { limit } = req.query;
        // Use user's unitKerjaId if not provided in query (or override if strict)
        // For now, allow query param but default to user's
        const unitKerjaId = (req.query.unitKerjaId as string) || req.user?.unitKerjaId || 'ditjen';

        if (!unitKerjaId) {
            res.status(400).json({ error: 'unitKerjaId is required' });
            return;
        }

        const userId = req.user?.id;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const result = await notificationService.getAllNotifications(
            unitKerjaId,
            userId,
            limit ? parseInt(limit as string) : 10
        );

        res.json(result);
    } catch (error) {
        log.error({ err: error }, 'Error fetching notifications:');
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
});

/**
 * @swagger
 * /api/notifications/count:
 *   get:
 *     summary: Get notification count
 *     tags: [Notifications]
 *     parameters:
 *       - in: query
 *         name: unitKerjaId
 *         required: false
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Notification counts by type
 */
router.get('/count', async (req: AuthRequest, res: Response) => {
    try {
        const unitKerjaId = (req.query.unitKerjaId as string) || req.user?.unitKerjaId || 'ditjen';

        if (!unitKerjaId) {
            res.status(400).json({ error: 'unitKerjaId is required' });
            return;
        }

        const userId = req.user?.id;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const counts = await notificationService.getNotificationCount(unitKerjaId, userId);
        res.json(counts);
    } catch (error) {
        log.error({ err: error }, 'Error fetching notification count:');
        res.status(500).json({ error: 'Failed to fetch notification count' });
    }
});

/**
 * @swagger
 * /api/notifications/surat-masuk:
 *   get:
 *     summary: Get pending surat masuk notifications
 *     tags: [Notifications]
 */
router.get('/surat-masuk', async (req: AuthRequest, res: Response) => {
    try {
        const unitKerjaId = (req.query.unitKerjaId as string) || req.user?.unitKerjaId || 'ditjen';

        if (!unitKerjaId) {
            res.status(400).json({ error: 'unitKerjaId is required' });
            return;
        }

        const userId = req.user?.id;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const notifications = await notificationService.getPendingSuratMasuk(unitKerjaId, userId);
        res.json({ notifications });
    } catch (error) {
        log.error({ err: error }, 'Error fetching surat masuk notifications:');
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
});

/**
 * @swagger
 * /api/notifications/arsip:
 *   get:
 *     summary: Get expiring archive notifications
 *     tags: [Notifications]
 */
router.get('/arsip', async (req: AuthRequest, res: Response) => {
    try {
        const { daysAhead } = req.query;
        const unitKerjaId = (req.query.unitKerjaId as string) || req.user?.unitKerjaId || 'ditjen';

        if (!unitKerjaId) {
            res.status(400).json({ error: 'unitKerjaId is required' });
            return;
        }

        const userId = req.user?.id;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const notifications = await notificationService.getExpiringArchives(
            unitKerjaId,
            userId,
            daysAhead ? parseInt(daysAhead as string) : 30
        );
        res.json({ notifications });
    } catch (error) {
        log.error({ err: error }, 'Error fetching arsip notifications:');
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
});

/**
 * @swagger
 * /api/notifications/:id/read:
 *   patch:
 *     summary: Mark notification as read
 *     tags: [Notifications]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Notification marked as read
 */
router.patch('/:id/read', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;

        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        await notificationService.markAsRead(userId, id as string);
        res.json({ success: true, message: 'Notification marked as read' });
    } catch (error) {
        log.error({ err: error }, 'Error marking notification as read:');
        res.status(500).json({ error: 'Failed to mark notification as read' });
    }
});

/**
 * @swagger
 * /api/notifications/read-all:
 *   patch:
 *     summary: Mark all notifications as read
 *     tags: [Notifications]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notificationIds:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: All notifications marked as read
 */
router.patch('/read-all', validateBody(markAllReadSchema), async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const { notificationIds } = req.body;

        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        if (!Array.isArray(notificationIds)) {
            res.status(400).json({ error: 'notificationIds must be an array' });
            return;
        }

        await notificationService.markAllAsRead(userId, notificationIds);
        res.json({ success: true, message: 'All notifications marked as read' });
    } catch (error) {
        log.error({ err: error }, 'Error marking all notifications as read:');
        res.status(500).json({ error: 'Failed to mark notifications as read' });
    }
});

export const notificationRoutes = router;
