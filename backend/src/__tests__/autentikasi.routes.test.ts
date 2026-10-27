import { Readable } from 'node:stream';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
    service: {
        findAll: vi.fn(),
        findById: vi.fn(),
        create: vi.fn(),
        getPdfStream: vi.fn(),
        findParentArsipIds: vi.fn(),
    },
    verifyUploadedBuffer: vi.fn(),
    check: vi.fn(),
}));

vi.mock('../middlewares/auth.middleware.js', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = {
            id: '10000000-0000-4000-8000-000000000001',
            email: 'super@example.test',
            role: 'super_admin',
            unitKerjaId: null,
        };
        next();
    },
}));
vi.mock('../services/autentikasi.service.js', () => ({ autentikasiService: state.service }));
vi.mock('../services/hash-verification.service.js', () => ({
    HashVerificationService: { verifyUploadedBuffer: state.verifyUploadedBuffer },
}));
vi.mock('../services/record-access.service.js', () => ({
    recordAccessService: { check: state.check },
    requiresExplicitAccessGrant: (value?: string | null) =>
        ['terbatas', 'rahasia', 'sangat_rahasia'].includes(String(value ?? 'biasa').toLowerCase()),
}));

const { default: autentikasiRouter } = await import('../routes/autentikasi.routes.js');
const app = express();
app.use(express.json());
app.use('/autentikasi', autentikasiRouter);

function binaryParser(res: any, callback: (error: Error | null, body?: Buffer) => void) {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    res.on('end', () => callback(null, Buffer.concat(chunks)));
}

describe('autentikasi PDF route', () => {
    beforeEach(() => vi.clearAllMocks());

    it('streams the private PDF through the authenticated no-store endpoint', async () => {
        const bytes = Buffer.from('%PDF-private-autentikasi');
        state.service.getPdfStream.mockResolvedValue({
            stream: Readable.from([bytes]),
            mimeType: 'application/pdf',
            fileName: 'BA_Autentikasi_001.pdf',
        });

        const response = await request(app)
            .get('/autentikasi/20000000-0000-4000-8000-000000000001/pdf')
            .buffer(true)
            .parse(binaryParser)
            .expect(200)
            .expect('Content-Type', /application\/pdf/)
            .expect('Cache-Control', /private, no-store/)
            .expect('X-Content-Type-Options', 'nosniff');

        expect(response.body).toEqual(bytes);
        expect(state.service.getPdfStream).toHaveBeenCalledWith(
            '20000000-0000-4000-8000-000000000001',
            expect.objectContaining({
                userId: '10000000-0000-4000-8000-000000000001',
                userEmail: 'super@example.test',
            }),
        );
    });

    it('does not expose a missing or unreadable object locator', async () => {
        state.service.getPdfStream.mockResolvedValue(null);

        await request(app)
            .get('/autentikasi/20000000-0000-4000-8000-000000000001/pdf')
            .expect(404, { error: 'PDF not found' });
    });

    it('hashes a PDF verification upload from memory without exposing a local path', async () => {
        const bytes = Buffer.from('%PDF-1.7 verification');
        state.verifyUploadedBuffer.mockResolvedValueOnce({ status: 'AUTHENTIC' });

        await request(app)
            .post('/autentikasi/verify')
            .attach('file', bytes, { filename: 'verification.pdf', contentType: 'application/pdf' })
            .expect(200, { status: 'AUTHENTIC' });

        expect(state.verifyUploadedBuffer).toHaveBeenCalledWith(bytes);
    });

    it('rejects spoofed PDF content before hashing', async () => {
        await request(app)
            .post('/autentikasi/verify')
            .attach('file', Buffer.from('not a pdf'), {
                filename: 'spoofed.pdf',
                contentType: 'application/pdf',
            })
            .expect(400, { message: 'Signature PDF tidak valid' });

        expect(state.verifyUploadedBuffer).not.toHaveBeenCalled();
    });

    it('rejects a PDF marker hidden behind prepended bytes', async () => {
        await request(app)
            .post('/autentikasi/verify')
            .attach('file', Buffer.from('junk%PDF-1.7'), {
                filename: 'prepended.pdf',
                contentType: 'application/pdf',
            })
            .expect(400, { message: 'Signature PDF tidak valid' });

        expect(state.verifyUploadedBuffer).not.toHaveBeenCalled();
    });

    it('requires a manage grant on each controlled parent archive before authenticating', async () => {
        const body = {
            nomorBeritaAcara: 'BA-AUT/001',
            tanggalAutentikasi: '2026-10-27',
            kegiatan: 'Autentikasi alih media',
            itemArsipIds: ['30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002'],
        };
        state.service.findParentArsipIds.mockResolvedValue(['arsip-biasa', 'arsip-terbatas']);
        state.service.create.mockResolvedValue({ id: 'aut-1' });
        const access = (classification: string, grantAccessMode: string | null) => ({
            exists: true, allowed: true, mutable: false, classification, grantAccessMode,
        });

        state.check.mockImplementation(async (_user: unknown, _type: string, id: string) =>
            id === 'arsip-biasa' ? access('biasa', null) : access('terbatas', 'view'));
        await request(app).post('/autentikasi').send(body)
            .expect(404, { error: 'Sebagian item arsip tidak ditemukan atau tidak dapat diakses' });
        expect(state.service.findParentArsipIds).toHaveBeenCalledWith(body.itemArsipIds);
        expect(state.service.create).not.toHaveBeenCalled();

        state.check.mockImplementation(async (_user: unknown, _type: string, id: string) =>
            id === 'arsip-biasa' ? access('biasa', null) : access('terbatas', 'manage'));
        await request(app).post('/autentikasi').send(body).expect(201);
        expect(state.service.create).toHaveBeenCalledTimes(1);
    });

    it('does not leak verification errors', async () => {
        state.verifyUploadedBuffer.mockRejectedValueOnce(new Error('database secret'));

        const response = await request(app)
            .post('/autentikasi/verify')
            .attach('file', Buffer.from('%PDF-1.7 verification'), {
                filename: 'verification.pdf',
                contentType: 'application/pdf',
            })
            .expect(500);

        expect(response.body).toEqual({ message: 'Gagal memverifikasi arsip' });
        expect(JSON.stringify(response.body)).not.toContain('database secret');
    });
});
