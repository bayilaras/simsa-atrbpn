import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { Express } from 'express';
import { env } from './env';
import { createLogger } from '../utils/logger';

const log = createLogger('Swagger');

const options: swaggerJsdoc.Options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'SIMSA ATR/BPN API Documentation',
            version: '1.0.0',
            description: `
# Sistem Informasi Manajemen Surat dan Arsip (SIMSA)
API untuk pengelolaan surat masuk, surat keluar, dan arsip di lingkungan ATR/BPN.

## Authentication
API ini menggunakan cookie-based session authentication melalui Better Auth.

## Rate Limiting
- General API: 100 requests per 15 minutes
- Auth endpoints: 5 requests per 15 minutes
            `,
            contact: {
                name: 'ATR/BPN IT Support',
            },
        },
        servers: [
            {
                url: env.BETTER_AUTH_URL || 'http://localhost:3001',
                description: env.NODE_ENV === 'production' ? 'Production server' : 'Development server',
            },
        ],
        components: {
            securitySchemes: {
                cookieAuth: {
                    type: 'apiKey',
                    in: 'cookie',
                    name: 'better-auth.session_token',
                    description: 'Session token cookie set after successful login',
                },
            },
            schemas: {
                Error: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean', example: false },
                        error: { type: 'string', example: 'Validation failed' },
                        details: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    field: { type: 'string' },
                                    message: { type: 'string' },
                                },
                            },
                        },
                    },
                },
                Pagination: {
                    type: 'object',
                    properties: {
                        page: { type: 'integer', example: 1 },
                        limit: { type: 'integer', example: 20 },
                        total: { type: 'integer', example: 100 },
                        totalPages: { type: 'integer', example: 5 },
                    },
                },
                SuratMasuk: {
                    type: 'object',
                    properties: {
                        id: { type: 'string', format: 'uuid' },
                        unitKerjaId: { type: 'string', format: 'uuid' },
                        nomorAgenda: { type: 'string' },
                        tanggalTerima: { type: 'string', format: 'date' },
                        nomorSurat: { type: 'string' },
                        tanggalSurat: { type: 'string', format: 'date' },
                        dari: { type: 'string' },
                        perihal: { type: 'string' },
                        sifatSurat: { type: 'string', enum: ['biasa', 'segera', 'sangat_segera', 'rahasia', 'undangan', 'penting'] },
                        status: { type: 'string', enum: ['belum_dibalas', 'sudah_dibalas'] },
                        isArchived: { type: 'boolean' },
                        createdAt: { type: 'string', format: 'date-time' },
                        updatedAt: { type: 'string', format: 'date-time' },
                    },
                },
                SuratKeluar: {
                    type: 'object',
                    properties: {
                        id: { type: 'string', format: 'uuid' },
                        unitKerjaId: { type: 'string', format: 'uuid' },
                        nomorSurat: { type: 'string' },
                        tanggalSurat: { type: 'string', format: 'date' },
                        tujuan: { type: 'string' },
                        perihal: { type: 'string' },
                        sifatSurat: { type: 'string', enum: ['biasa', 'segera', 'sangat_segera', 'rahasia', 'undangan', 'penting'] },
                        status: { type: 'string', enum: ['draft', 'dikirim', 'arsip'] },
                        createdAt: { type: 'string', format: 'date-time' },
                        updatedAt: { type: 'string', format: 'date-time' },
                    },
                },
                Arsip: {
                    type: 'object',
                    properties: {
                        id: { type: 'string', format: 'uuid' },
                        unitKerjaId: { type: 'string', format: 'uuid' },
                        kodeSurat: { type: 'string' },
                        deskripsi: { type: 'string' },
                        jenisArsip: { type: 'string', enum: ['masuk', 'keluar'] },
                        klasifikasiId: { type: 'string', format: 'uuid' },
                        retentionPeriod: { type: 'integer' },
                        lokasiPenyimpanan: { type: 'string' },
                        createdAt: { type: 'string', format: 'date-time' },
                    },
                },
            },
        },
        security: [{ cookieAuth: [] }],
        tags: [
            { name: 'Auth', description: 'Authentication endpoints' },
            { name: 'Surat Masuk', description: 'Incoming mail management' },
            { name: 'Surat Keluar', description: 'Outgoing mail management' },
            { name: 'Arsip', description: 'Archive management' },
            { name: 'Dashboard', description: 'Dashboard statistics' },
            { name: 'Users', description: 'User management' },
            { name: 'Settings', description: 'Application settings' },
        ],
    },
    apis: ['./src/routes/*.ts'], // Path to the API routes
};

const swaggerSpec = swaggerJsdoc(options);

export function setupSwagger(app: Express) {
    // Swagger JSON endpoint
    app.get('/api/docs/json', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.send(swaggerSpec);
    });

    // Swagger UI
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
        customCss: '.swagger-ui .topbar { display: none }',
        customSiteTitle: 'SIMSA API Documentation',
    }));

    log.info('Swagger UI available at /api/docs');
}

export { swaggerSpec };
