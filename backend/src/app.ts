import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { toNodeHandler } from 'better-auth/node';
import { env } from './config/env';
import { auth } from './config/auth';
import { generalLimiter, authLimiter } from './middlewares/rate-limiter.middleware';
import { authMiddleware } from './middlewares/auth.middleware';
import { csrfCookieSetter, csrfProtection } from './middlewares/csrf.middleware';
import { sanitizeInput } from './middlewares/sanitize.middleware';
import { setupSwagger } from './config/swagger';
import { AppError } from './utils/errors';
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
import devAuthRoutes from './routes/dev-auth.routes';
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


const app = express();

// CORS - must be before everything
app.use(cors({
    origin: env.FRONTEND_URL,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'X-CSRF-Token'],
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

// Health check (no body parsing needed) — for uptime monitoring & load balancers
app.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
app.get('/api/health', (req: Request, res: Response) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
        uptime: Math.floor(process.uptime()),
    });
});

// Apply rate limiting to auth endpoints BEFORE Better Auth handler
// This protects against brute force login attempts
app.use('/api/auth', authLimiter);

// Better Auth handler - Express v5 uses /*splat pattern
// MUST be before express.json()
// Documentation: https://www.better-auth.com/docs/integrations/express
// Handle both patterns for compatibility
const authHandler = toNodeHandler(auth);
const wrappedAuthHandler = async (req: Request, res: Response, next: NextFunction) => {
    try {
        await authHandler(req, res);
    } catch (error: any) {
        console.error('Auth handler error:', error.message);
        res.status(500).json({
            error: 'Authentication Error',
            message: 'Terjadi kesalahan pada proses autentikasi.',
        });
    }
};

app.all('/api/auth/*splat', wrappedAuthHandler);
app.all('/api/auth/:path', wrappedAuthHandler);
app.all('/api/auth/:path/:subpath', wrappedAuthHandler);

// Body parsing - AFTER Better Auth handler
app.use(express.json({ limit: '10mb' }));  // Limit body size to prevent DoS
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Input sanitization — strip HTML tags and encode dangerous characters
app.use(sanitizeInput);

// CSRF Protection — validate token on state-changing requests
// Applies to /api routes only (excludes auth routes which have their own CSRF)
// Note: cookieParser and csrfCookieSetter are applied earlier (before health check)
app.use('/api', csrfProtection);

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

// Static file serving for uploads — PROTECTED with authentication
// Files in backend/uploads require a valid session to access
const uploadsPath = path.join(process.cwd(), 'uploads');
app.use('/uploads', authMiddleware as any, express.static(uploadsPath));

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
app.use('/api/import', googleDriveImportRoutes); // Google Drive import

// Dev auth routes - ONLY available in development mode
if (env.NODE_ENV === 'development') {
    app.use('/api/dev', devAuthRoutes);
}

// Setup Swagger API documentation - available at /api/docs
setupSwagger(app);

// 404 handler
app.use((req: Request, res: Response) => {
    res.status(404).json({ success: false, error: 'Not Found', path: req.path });
});

// Global error handler — handles custom AppError instances and unexpected errors
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
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
});

export default app;
