import {
    applicationDefault,
    getApps,
    initializeApp,
    type App,
} from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getAppCheck, type AppCheck } from 'firebase-admin/app-check';
import { buildCloudPlatformConfig } from './cloud-platform.js';

const ADMIN_APP_NAME = 'simsa-backend';

export function getFirebaseAdminApp(source: NodeJS.ProcessEnv = process.env): App {
    const config = buildCloudPlatformConfig(source);
    if (!config.firebaseProjectId) {
        throw new Error('FIREBASE_PROJECT_ID is required before Firebase Admin can start');
    }
    const existing = getApps().find(app => app.name === ADMIN_APP_NAME);
    if (existing) {
        if (existing.options.projectId && existing.options.projectId !== config.firebaseProjectId) {
            throw new Error('Firebase Admin was already initialized for a different project');
        }
        return existing;
    }

    // Cloud Run uses Application Default Credentials from its service account.
    // A downloaded JSON service-account key is intentionally unsupported.
    const emulator = Boolean(source.FIREBASE_AUTH_EMULATOR_HOST?.trim());
    return initializeApp({
        projectId: config.firebaseProjectId,
        ...(emulator ? {} : { credential: applicationDefault() }),
    }, ADMIN_APP_NAME);
}

export function getFirebaseAdminAuth(source: NodeJS.ProcessEnv = process.env): Auth {
    return getAuth(getFirebaseAdminApp(source));
}

export function getFirebaseAdminAppCheck(source: NodeJS.ProcessEnv = process.env): AppCheck {
    return getAppCheck(getFirebaseAdminApp(source));
}
