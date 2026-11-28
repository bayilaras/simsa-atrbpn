import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
    user: {
        id: 'pencatat-1',
        email: 'pencatat@example.test',
        name: 'Pencatat',
        role: 'admin_unit',
        unitKerjaId: 'ditjen' as string | null,
    } as { id: string; email: string; name: string; role: string; unitKerjaId: string | null } | null,
}));

vi.mock('../middlewares/auth.middleware.js', () => ({
    authMiddleware: (req: any, res: any, next: any) => {
        if (!state.user) { res.status(401).json({ error: 'Unauthorized: No valid session' }); return; }
        req.user = { ...state.user };
        next();
    },
}));

const { default: letterPrefillRouter } = await import('../routes/letter-prefill.routes.js');
const { sanitizeInput } = await import('../middlewares/sanitize.middleware.js');
const { LETTER_FORM_TEXT_MAX_CHARS } = await import('../services/letter-text-fields.js');

const app = express();
app.use(express.json({ limit: '10mb' }));
// The same global sanitizer the API mounts before every router.
app.use(sanitizeInput);
app.use('/letter-prefill', letterPrefillRouter);

const SURAT = [
    'KEMENTERIAN CONTOH REPUBLIK FIKTIF',
    'Kota Fiktif, 12 November 2026',
    'Nomor : B/123/CTH.01/XI/2026',
    'Sifat : Rahasia',
    'Hal : Permintaan Data Contoh',
    '',
    'Yth. Kepala Kantor Wilayah Contoh',
    'di Kota Rekaan',
    '',
    'Sehubungan dengan kegiatan contoh, bersama ini kami sampaikan permintaan data.',
    '',
    'Direktur Jenderal Contoh,',
].join('\n');

beforeEach(() => {
    state.user = { id: 'pencatat-1', email: 'pencatat@example.test', name: 'Pencatat', role: 'admin_unit', unitKerjaId: 'ditjen' };
});

describe('POST /api/letter-prefill', () => {
    it('returns the form fields read from the text, line breaks intact', async () => {
        const response = await request(app).post('/letter-prefill').send({ extractedText: SURAT });
        expect(response.status).toBe(200);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.body).toEqual({
            success: true,
            data: {
                nomorSurat: 'B/123/CTH.01/XI/2026',
                tanggalSurat: '2026-11-12',
                perihal: 'Permintaan Data Contoh',
                pengirim: 'Direktur Jenderal Contoh',
                penerima: 'Kepala Kantor Wilayah Contoh',
                jenisSurat: null,
            },
        });
    });

    it('never returns sifat or a security class', async () => {
        const response = await request(app).post('/letter-prefill').send({ extractedText: `${SURAT}\nKlasifikasi : RAHASIA` });
        expect(Object.keys(response.body.data).sort())
            .toEqual(['jenisSurat', 'nomorSurat', 'penerima', 'pengirim', 'perihal', 'tanggalSurat']);
    });

    it('strips markup from the values it returns', async () => {
        const response = await request(app).post('/letter-prefill')
            .send({ extractedText: 'Nomor : 5/CTH/XI/2026\nHal : Undangan <b>Rapat</b> <script>alert(1)</script>Koordinasi' });
        expect(response.status).toBe(200);
        expect(response.body.data.perihal).not.toMatch(/[<>]/);
        expect(response.body.data.perihal).toContain('Undangan');
    });

    it('answers with empty fields for text that is not a letter', async () => {
        const response = await request(app).post('/letter-prefill').send({ extractedText: 'Daftar hadir peserta rapat.' });
        expect(response.status).toBe(200);
        expect(Object.values(response.body.data).every((value) => value === null)).toBe(true);
    });

    it.each([
        ['no text', {}],
        ['empty text', { extractedText: '' }],
        ['a non-string', { extractedText: ['Nomor: 1'] }],
        ['text over the limit', { extractedText: 'x'.repeat(LETTER_FORM_TEXT_MAX_CHARS + 1) }],
        ['an unknown field', { extractedText: 'Nomor: 1/CTH/XI/2026', unitKerjaId: 'ditjen' }],
    ])('rejects %s', async (_name, body) => {
        const response = await request(app).post('/letter-prefill').send(body);
        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body)).not.toContain('xxxx');
    });

    it('accepts text of exactly the limit', async () => {
        const text = `Nomor: 9/CTH/XI/2026\n${'x'.repeat(LETTER_FORM_TEXT_MAX_CHARS)}`.slice(0, LETTER_FORM_TEXT_MAX_CHARS);
        const response = await request(app).post('/letter-prefill').send({ extractedText: text });
        expect(response.status).toBe(200);
        expect(response.body.data.nomorSurat).toBe('9/CTH/XI/2026');
    });

    it('requires a session', async () => {
        state.user = null;
        expect((await request(app).post('/letter-prefill').send({ extractedText: SURAT })).status).toBe(401);
    });

    it.each(['staff', 'auditor', 'user'])('refuses the read-only role %s', async (role) => {
        state.user = { id: 'pembaca-1', email: 'pembaca@example.test', name: 'Pembaca', role, unitKerjaId: 'ditjen' };
        const response = await request(app).post('/letter-prefill').send({ extractedText: SURAT });
        expect(response.status).toBe(403);
        expect(response.body.data).toBeUndefined();
    });

    it('refuses a unit administrator without a unit', async () => {
        state.user = { id: 'pencatat-2', email: 'tanpa-unit@example.test', name: 'Tanpa Unit', role: 'admin_unit', unitKerjaId: null };
        expect((await request(app).post('/letter-prefill').send({ extractedText: SURAT })).status).toBe(403);
    });
});
