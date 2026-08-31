import type { NextFunction, Request, Response } from 'express';
import { buildCloudPlatformConfig } from '../config/cloud-platform.js';
import { getFirebaseAdminAppCheck } from '../config/firebase-admin.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('FirebaseAppCheck');

function createFirebaseAppCheckMiddleware(consume: boolean) {
    /** App Check reduces automated abuse; authorization still comes from SIMSA. */
    return async function verifyFirebaseAppCheck(
        req: Request,
        res: Response,
        next: NextFunction,
    ): Promise<void> {
        const config = buildCloudPlatformConfig();
        if (config.authProvider !== 'firebase' || !config.firebaseAppCheckRequired) {
            next();
            return;
        }
        const token = req.header('X-Firebase-AppCheck');
        if (!token) {
            res.status(401).json({ error: 'Firebase App Check token required' });
            return;
        }
        try {
            const verified = await getFirebaseAdminAppCheck().verifyToken(token, { consume });
            if (!config.firebaseAppCheckAppIds.includes(verified.appId)) {
                log.warn({ appId: verified.appId, path: req.path }, 'Rejected Firebase App Check token from an untrusted app');
                res.status(401).json({ error: 'Invalid Firebase App Check token' });
                return;
            }
            if (consume && verified.alreadyConsumed === true) {
                log.warn({ appId: verified.appId, path: req.path }, 'Rejected replayed Firebase App Check token');
                res.status(401).json({ error: 'Firebase App Check token was already consumed' });
                return;
            }
            next();
        } catch (error) {
            log.warn({ err: error, path: req.path }, 'Rejected invalid Firebase App Check token');
            res.status(401).json({ error: 'Invalid Firebase App Check token' });
        }
    };
}

export const firebaseAppCheckMiddleware = createFirebaseAppCheckMiddleware(false);

/** Limited-use App Check tokens are consumed for low-volume, sensitive operations. */
export const firebaseReplayProtectedAppCheckMiddleware = createFirebaseAppCheckMiddleware(true);
