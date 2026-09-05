import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import * as helmetModule from 'helmet';
const helmet = (helmetModule as any).default || helmetModule;
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { env, validateEnv, cloudPlatformConfig } from './config/env';
import { getPublicAppMetadata } from './config/app-profile.js';
import { getPublicCapabilities, isMetadataDemo } from './config/demo.js';
import { createDemoAccessMiddleware } from './middlewares/demo-access.middleware.js';
import { installFrontendHosting } from './middlewares/frontend-hosting.middleware.js';
import { frontendSecurityDirectives } from './config/frontend-security.js';
import { srikandiConfig } from './config/srikandi.js';
import { isTrustedOrigin } from './config/trusted-origins';
import { generalLimiter, authLimiter } from './middlewares/rate-limiter.middleware';
import { authMiddleware } from './middlewares/auth.middleware';
import { roleMiddleware } from './middlewares/role.middleware';
import { csrfCookieSetter, csrfProtection } from './middlewares/csrf.middleware';
import { firebaseAppCheckMiddleware } from './middlewares/firebase-app-check.middleware.js';
import { sanitizeInput } from './middlewares/sanitize.middleware';
import { setupSwagger } from './config/swagger';
import { AppError, ForbiddenError } from './utils/errors';
import { logger } from './utils/logger';

// Import routes
import suratMasukRoutes from './routes/surat-masuk.routes';
import suratKeluarRoutes from './routes/surat-keluar.routes';
import arsipRoutes from './routes/arsip.routes';
import uploadRoutes from './routes/upload.routes';
import unitKerjaRoutes from './routes/unit-kerja.routes';
import migrationRoutes from './routes/migration.routes';
import dashboardRoutes from './routes/dashboard.routes';
import { exportRoutes } from './routes/export.routes';
import { notificationRoutes } from './routes/notification.routes';
import userManagementRoutes from './routes/user-management.routes';
import auditLogRoutes from './routes/audit-log.routes';
import klasifikasiRoutes from './routes/klasifikasi.routes';
import jraRoutes from './routes/jra.routes';
import arsipPickerRoutes from './routes/arsip-picker.routes';
import storageLocationRoutes from './routes/storage-location.routes';
import archiveLendingRoutes from './routes/archive-lending.routes';
import dosirRoutes from './routes/dosir.routes';
import { retentionRoutes } from './routes/retention.routes';
import bulkUploadRoutes from './routes/bulk-upload.routes';
import distributionRoutes from './routes/distribution.routes';
import { reportRoutes } from './routes/report.routes';
import { settingsRoutes } from './routes/settings.routes';
import searchRoutes from './routes/search.routes';
import penyusutanRoutes from './routes/penyusutan.routes';
import arsipVitalRoutes from './routes/arsip-vital.routes';
import arsipTerjagaRoutes from './routes/arsip-terjaga.routes';
import arsipElektronikRoutes from './routes/arsip-elektronik.routes';
import tunjukSilangRoutes from './routes/tunjuk-silang.routes';
import autentikasiRoutes from './routes/autentikasi.routes';
import layananArsipRoutes from './routes/layanan-arsip.routes';
import supervisionRoutes from './routes/supervision.routes';
import mappingRoutes from './routes/mapping.routes';
import approvalRoutes from './routes/approval.routes';
import securityRoutes from './routes/security.routes';
import googleDriveImportRoutes from './routes/google-drive-import.routes';
import clientUploadRoutes from './routes/client-upload.routes';
import fileAccessRoutes from './routes/file-access.routes';
import srikandiRoutes from './routes/srikandi.routes';
import recordAccessGrantRoutes from './routes/record-access-grant.routes';
import regulatoryRuleSetRoutes from './routes/regulatory-rule-set.routes';
import retentionGovernanceRoutes from './routes/retention-governance.routes';
import firebaseAuthRoutes from './routes/firebase-auth.routes.js';
import gcsUploadRoutes from './routes/gcs-upload.routes.js';
import { getReadiness } from './services/readiness.service.js';

// Vercel imports app.ts directly and never executes index.ts. Validate the
// production environment during module cold-start as well, while unit tests
// and local development retain their existing lightweight import behavior.
const deployedRuntime = env.NODE_ENV === 'production'
    || Boolean(process.env.K_SERVICE)
    || Boolean(process.env.VERCEL);
if (deployedRuntime) {
    validateEnv();
}

const app = express();
const publicAppMetadata = getPublicAppMetadata(env.APP_PROFILE, srikandiConfig.enabled);

// Trust first proxy (Vercel's load balancer) for X-Forwarded-For headers
// Required for express-rate-limit to correctly identify users behind a proxy
app.set('trust proxy', 1);

// CORS - must be before everything
app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);

        if (isTrustedOrigin(origin)) {
            return callback(null, true);
        }

        return callback(new ForbiddenError('Origin tidak diizinkan oleh kebijakan CORS.'));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'Accept',
        'X-CSRF-Token',
        'X-Firebase-AppCheck',
    ],
    exposedHeaders: ['Retry-After'],
    credentials: true,
}));

// Security Headers with Helmet.js
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"], // Allow inline styles for React
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:", "blob:"],
            connectSrc: ["'self'", env.FRONTEND_URL],
            fontSrc: ["'self'", "data:"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
            formAction: ["'self'"],       // Prevent form submissions to external origins
            baseUri: ["'self'"],          // Prevent base tag hijacking
            upgradeInsecureRequests: [],   // Force HTTPS for all resources
            ...frontendSecurityDirectives(),
        },
    },
    hsts: {
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        preload: true
    },
    frameguard: {
        action: 'deny' // Prevent clickjacking
    },
    // Firebase popup sign-in needs to communicate with its opener. Scope the
    // compatible COOP policy to the hosted Firebase frontend only.
    ...(process.env.SIMSA_FRONTEND_DIST && cloudPlatformConfig.authProvider === 'firebase'
        ? { crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' } }
        : {}),
    noSniff: true, // Prevent MIME type sniffing
    xssFilter: true, // Enable XSS filter
    referrerPolicy: {
        policy: 'strict-origin-when-cross-origin'
    }
}));

// Workaround for Express 5's read-only req.query
// Some libraries (like Better Auth) try to modify req.query which is read-only in Express 5
// This middleware makes req.query writable by redefining the property
app.use((req: Request, res: Response, next: NextFunction) => {
    const originalQuery = { ...req.query };
    Object.defineProperty(req, 'query', {
        value: originalQuery,
        writable: true,
        configurable: true,
        enumerable: true,
    });
    next();
});

// Cookie parser — needed EARLY for CSRF double-submit cookie pattern
app.use(cookieParser());

// CSRF cookie setter — set token cookie on all /api responses (must be before route handlers)
app.use('/api', csrfCookieSetter);

// Liveness deliberately answers only whether this process can serve HTTP. It
// must not be coupled to a dependency outage or the orchestrator would restart
// a healthy API in a loop. Readiness below performs live dependency probes.
app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
        status: 'alive',
        timestamp: new Date().toISOString(),
        application: publicAppMetadata,
    });
});

async function readinessHandler(_req: Request, res: Response) {
    const readiness = await getReadiness();
    res.status(readiness.status === 'not_ready' ? 503 : 200).json({
        ...readiness,
        application: publicAppMetadata,
        version: process.env.npm_package_version || '1.0.0',
        uptime: Math.floor(process.uptime()),
    });
}

app.get('/ready', readinessHandler);
app.get('/api/health', readinessHandler);

// Bounded public feature contract. No identifiers, credentials or dependency
// diagnostics are exposed, and stale responses cannot enable a demo feature.
app.get('/api/capabilities', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(getPublicCapabilities());
});

// Apply rate limiting to auth endpoints BEFORE Better Auth handler
// This protects against brute force login attempts
app.use('/api/auth', authLimiter);

// Explicit OPTIONS preflight handler for auth routes
// Better Auth's toNodeHandler may bypass Express cors() middleware on preflight requests
// This ensures CORS headers are always returned for OPTIONS requests to /api/auth/*
app.options('/api/auth/*splat', (req: Request, res: Response) => {
    const origin = req.headers.origin;
    if (isTrustedOrigin(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin!);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Requested-With, Accept, X-CSRF-Token, X-Firebase-AppCheck',
    );
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.status(204).end();
});

// Better Auth handler - Express v5 uses /*splat pattern
// MUST be before express.json()
// Documentation: https://www.better-auth.com/docs/integrations/express
// Handle both patterns for compatibility
let betterAuthHandlerPromise: Promise<(req: Request, res: Response) => Promise<void>> | null = null;
async function getBetterAuthHandler() {
    if (!betterAuthHandlerPromise) {
        betterAuthHandlerPromise = Promise.all([
            import('better-auth/node'),
            import('./config/auth.js'),
        ]).then(([betterAuthNode, authConfig]) => betterAuthNode.toNodeHandler(authConfig.auth));
    }
    return betterAuthHandlerPromise;
}
const wrappedAuthHandler = async (req: Request, res: Response, next: NextFunction) => {
    // Ensure CORS headers are set for auth responses since toNodeHandler may bypass Express cors()
    const origin = req.headers.origin;
    const defaultOrigin = env.FRONTEND_URL.replace(/\/$/, '');
    if (!origin || isTrustedOrigin(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin || defaultOrigin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    try {
        const authHandler = await getBetterAuthHandler();
        await authHandler(req, res);
    } catch (error: any) {
        console.error(`Auth handler error on ${req.method} ${req.path}:`, error.message, error.stack);
        res.status(500).json({
            error: 'Authentication Error',
            message: deployedRuntime
                ? 'Terjadi kesalahan pada proses autentikasi.'
                : `Auth error: ${error.message}`,
        });
    }
};

if (cloudPlatformConfig.authProvider === 'firebase') {
    app.use('/api/auth', firebaseAuthRoutes);
} else {
    app.all('/api/auth/*splat', wrappedAuthHandler);
    app.all('/api/auth/:path', wrappedAuthHandler);
    app.all('/api/auth/:path/:subpath', wrappedAuthHandler);
}

// Body parsing - AFTER Better Auth handler
app.use(express.json({ limit: '10mb' }));  // Limit body size to prevent DoS
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Input sanitization — strip HTML tags and encode dangerous characters
app.use(sanitizeInput);

// CSRF Protection — validate token on state-changing requests
// Applies to /api routes only (excludes auth routes which have their own CSRF)
// Note: cookieParser and csrfCookieSetter are applied earlier (before health check)
app.use('/api', csrfProtection);

// In Firebase mode, reject forged/non-app clients before they reach domain
// handlers. This is an anti-abuse signal, never an authorization substitute.
app.use('/api', firebaseAppCheckMiddleware);

// Defense in depth: hiding file controls in the demo UI is not authorization.
// Reject unsupported operations before any domain router or upload parser runs.
app.use('/api', createDemoAccessMiddleware(isMetadataDemo()));

// Response compression - compress all responses
app.use(compression({
    filter: (req: Request, res: Response) => {
        if (req.headers['x-no-compression']) {
            return false;
        }
        return compression.filter(req, res);
    },
    level: 6 // Compression level (0-9, 6 is default balance)
}));

// The legacy endpoint used to redirect callers to a public object URL, bypassing
// record-level authorization and download auditing. It is intentionally retired;
// clients must use the unit-scoped /api/files routes below.
app.get('/api/drive-file/:fileId', authMiddleware as any, (_req: Request, res: Response) => {
    res.status(410).json({
        error: 'Legacy file proxy retired',
        message: 'Gunakan endpoint akses berkas terkendali.',
    });
});

// Blob storage diagnostic — test connectivity
import { blobStorageService } from './services/blob-storage.service';
app.get('/api/blob-test', authMiddleware as any, roleMiddleware(['super_admin']) as any, async (req: Request, res: Response) => {
    try {
        await blobStorageService.probeConnectivity();
        res.json({
            success: true,
            message: 'Private object storage is reachable',
            provider: cloudPlatformConfig.storageProvider,
        });
    } catch (error: any) {
        logger.error({ err: error }, 'Blob storage test failed');
        res.status(503).json({
            success: false,
            error: 'Private object storage is unavailable',
            provider: cloudPlatformConfig.storageProvider,
        });
    }
});

// Apply general rate limiting to all API routes
app.use('/api', generalLimiter);

// API Routes
app.use('/api/surat-masuk', suratMasukRoutes);
app.use('/api/surat-keluar', suratKeluarRoutes);
app.use('/api/arsip', arsipRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/unit-kerja', unitKerjaRoutes);

app.use('/api/migration', migrationRoutes);
app.use('/api/approval', approvalRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/users', userManagementRoutes);
app.use('/api/audit-log', auditLogRoutes);
app.use('/api/klasifikasi', klasifikasiRoutes);
app.use('/api/jra', jraRoutes);
app.use('/api/regulatory-rule-sets', regulatoryRuleSetRoutes);
app.use('/api/retention-governance', retentionGovernanceRoutes);
app.use('/api/arsip-picker', arsipPickerRoutes);
app.use('/api/storage-locations', storageLocationRoutes);
app.use('/api/archive-lending', archiveLendingRoutes);
app.use('/api/dosir', dosirRoutes);
app.use('/api/retention', retentionRoutes);
app.use('/api/bulk-upload', bulkUploadRoutes);
app.use('/api/distributions', distributionRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/penyusutan', penyusutanRoutes);
app.use('/api/arsip-vital', arsipVitalRoutes);
app.use('/api/arsip-terjaga', arsipTerjagaRoutes);
app.use('/api/arsip-elektronik', arsipElektronikRoutes);
app.use('/api/tunjuk-silang', tunjukSilangRoutes);
app.use('/api/autentikasi', autentikasiRoutes);
app.use('/api/layanan-arsip', layananArsipRoutes);
app.use('/api/supervision', supervisionRoutes);
app.use('/api/mapping', mappingRoutes);
app.use('/api/security', securityRoutes); // Security utilities (password check, etc.)
app.use('/api/import', googleDriveImportRoutes); // Public Google Sheets metadata import
if (cloudPlatformConfig.storageProvider === 'gcs') {
    app.use('/api/object-uploads', gcsUploadRoutes);
} else {
    app.use('/api/client-upload', clientUploadRoutes); // Compatibility path during Vercel Blob migration
}
app.use('/api/files', fileAccessRoutes); // Authenticated, unit-scoped private file streaming
app.use('/api/integrations/srikandi', srikandiRoutes);
app.use('/api/record-access-grants', recordAccessGrantRoutes); // Purpose-bound, time-limited need-to-know workflow

// Setup Swagger API documentation - available at /api/docs
setupSwagger(app);

installFrontendHosting(app);

// 404 handler
app.use((req: Request, res: Response) => {
    res.status(404).json({ success: false, error: 'Not Found', path: req.path });
});

// Global error handler — handles custom AppError instances and unexpected errors
export function globalErrorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
    void next;
    // Custom application errors carry their own status code
    if (err instanceof AppError) {
        res.status(err.statusCode).json({
            success: false,
            error: err.name,
            message: err.message,
            ...(env.NODE_ENV === 'development' && { stack: err.stack }),
        });
        return;
    }

    // Unexpected errors
    logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
    res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: env.NODE_ENV === 'development' ? err.message : 'Terjadi kesalahan pada server.',
    });
}

app.use(globalErrorHandler);

export default app;
