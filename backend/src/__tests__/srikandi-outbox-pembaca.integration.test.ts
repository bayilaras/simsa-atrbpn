import type { PGlite } from '@electric-sql/pglite';
import express from 'express';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { PENGGUNA, SURAT, USER_ID, bootRangkaianDatabase, seedRangkaianFixture } from './helpers/rangkaian-pglite';

// Payload dan respons SRIKANDI memuat nomor, perihal, dan pihak surat. Isi itu
// hanya untuk pengguna yang boleh melihat surat sumbernya di daftar surat;
// baris lain tetap bisa dioperasikan tanpa isi tersebut.

const uji = vi.hoisted(() => ({
    db: null as any,
    smRahasia: '67000000-0000-4000-8000-000000000001',
    outbox: {
        rahasia: '68000000-0000-4000-8000-000000000001',
        biasa: '68000000-0000-4000-8000-000000000002',
        terbatas: '68000000-0000-4000-8000-000000000003',
    },
    nomor: 'SM-77/RHS/2026',
    perihal: 'Perihal surat rahasia untuk uji antrean',
    pihak: 'Pihak rahasia uji',
}));

vi.mock('../config/database', () => ({
    get db() { return uji.db; },
    pool: { query: async () => { throw new Error('pool tidak dipakai dalam uji ini'); } },
}));
vi.mock('../middlewares/auth.middleware', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        const raw = req.headers['x-uji-pengguna'];
        req.user = raw ? { email: 'uji@example.test', ...JSON.parse(String(raw)) } : undefined;
        next();
    },
}));
vi.mock('../middlewares/rate-limiter.middleware', () => ({
    sensitiveLimiter: (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../config/srikandi', async (importOriginal) => {
    const asli = await importOriginal<typeof import('../config/srikandi')>();
    return { ...asli, srikandiConfig: { ...asli.srikandiConfig, enabled: true, ready: true, contractVersion: 'uji-1' } };
});
vi.mock('../services/srikandi-http.adapter', async (importOriginal) => {
    const asli = await importOriginal<typeof import('../services/srikandi-http.adapter')>();
    return {
        ...asli,
        srikandiHttpAdapter: {
            send: vi.fn(async () => {
                throw new asli.SrikandiDeliveryError('SRIKANDI mengembalikan HTTP 503', true, 503, { pesan: uji.perihal });
            }),
        },
    };
});

let database: PGlite;
let app: express.Express;
const sebagai = (user: object) => ({ 'x-uji-pengguna': JSON.stringify(user) });

function payload(suratId: string, nomor: string, perihal: string, pihak: string) {
    return JSON.stringify({
        profile: 'simsa-uji',
        lifecycleState: 'created',
        direction: 'incoming',
        occurredAt: '2026-09-10T00:00:00.000Z',
        record: { id: suratId, unitKerjaId: 'sesditjen', nomorSurat: nomor, tanggalSurat: '2026-09-10', perihal, counterpart: pihak },
    });
}

function outboxRow(id: string, suratId: string, isi: string, respons: object | null) {
    const hash = id.replace(/-/g, '').padEnd(64, '0');
    return `('${id}','sesditjen','simsa:surat_masuk:${suratId}:created','uji-1','${hash}','surat_masuk.created','surat_masuk','${suratId}','${isi}'::jsonb,'dead_letter',now(),'SRIKANDI mengembalikan HTTP 503',${respons ? `'${JSON.stringify(respons)}'::jsonb` : 'NULL'})`;
}

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    uji.db = drizzle(database, { schema });
    const { default: srikandiRouter } = await import('../routes/srikandi.routes');
    app = express();
    app.use(express.json());
    app.use('/api/integrations/srikandi', srikandiRouter);
    app.use((error: any, _req: any, res: any, _next: any) => res.status(error?.statusCode || 500).json({ error: error?.message }));
}, 90_000);
afterAll(async () => { await database?.close(); });
beforeEach(async () => {
    await seedRangkaianFixture(database);
    await database.exec(`
        INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, sifat_surat, nomor_surat, perihal, dari, tanggal_surat) VALUES
            ('${uji.smRahasia}','sesditjen',77,2026,'Rahasia','${uji.nomor}','${uji.perihal}','${uji.pihak}','2026-09-10');
        INSERT INTO srikandi_outbox (id, unit_kerja_id, idempotency_key, contract_version, message_hash, event_type,
            source_entity_type, source_entity_id, payload, status, dead_lettered_at, last_error, response_payload) VALUES
            ${outboxRow(uji.outbox.rahasia, uji.smRahasia, payload(uji.smRahasia, uji.nomor, uji.perihal, uji.pihak), { pesan: uji.perihal })},
            ${outboxRow(uji.outbox.biasa, SURAT.smBiasa, payload(SURAT.smBiasa, 'SM-1/2026', 'Permohonan data pertanahan', 'Kanwil A'), null)},
            ${outboxRow(uji.outbox.terbatas, SURAT.smTerbatas, payload(SURAT.smTerbatas, 'SM-2/RHS/2026', 'Perihal SM rahasia terbatas', 'Kanwil B'), null)};
    `);
});

function tanpaIsiRahasia(body: unknown) {
    const teks = JSON.stringify(body);
    expect(teks).not.toContain(uji.perihal);
    expect(teks).not.toContain(uji.nomor);
    expect(teks).not.toContain(uji.pihak);
}

function tersamar(item: any) {
    expect(item.masked).toBe(true);
    expect(item.payload.record).toEqual({ id: uji.smRahasia, unitKerjaId: 'sesditjen' });
    expect(item.payload).toMatchObject({ profile: 'simsa-uji', lifecycleState: 'created', direction: 'incoming' });
    expect(item.responsePayload).toBeNull();
}

describe('antrean SRIKANDI mengikuti visibilitas daftar surat', () => {
    it('admin unit melihat isi surat biasa dan terbatas, tetapi isi surat rahasia disamarkan', async () => {
        const response = await request(app).get('/api/integrations/srikandi/outbox')
            .set(sebagai(PENGGUNA.tu)).expect(200);
        const byId = Object.fromEntries(response.body.data.map((item: any) => [item.id, item]));

        expect(Object.keys(byId).sort()).toEqual(Object.values(uji.outbox).sort());
        tersamar(byId[uji.outbox.rahasia]);
        expect(byId[uji.outbox.rahasia].status).toBe('dead_letter');
        expect(byId[uji.outbox.biasa].payload.record.perihal).toBe('Permohonan data pertanahan');
        expect(byId[uji.outbox.terbatas].payload.record.perihal).toBe('Perihal SM rahasia terbatas');
        expect(byId[uji.outbox.biasa].masked).toBeUndefined();
        tanpaIsiRahasia(response.body);
    });

    it('detail, retry, dan dispatch menyamarkan baris yang sama', async () => {
        const detail = await request(app).get(`/api/integrations/srikandi/outbox/${uji.outbox.rahasia}`)
            .set(sebagai(PENGGUNA.tu)).expect(200);
        tersamar(detail.body.data.item);
        tanpaIsiRahasia(detail.body);

        const retry = await request(app).post(`/api/integrations/srikandi/outbox/${uji.outbox.rahasia}/retry`)
            .set(sebagai(PENGGUNA.tu)).send({ reason: 'Uji ulang setelah perbaikan jaringan' }).expect(202);
        tersamar(retry.body.data);
        expect(retry.body.data.status).toBe('pending');
        tanpaIsiRahasia(retry.body);

        const dispatch = await request(app).post(`/api/integrations/srikandi/outbox/${uji.outbox.rahasia}/dispatch`)
            .set(sebagai(PENGGUNA.tu)).expect(202);
        tersamar(dispatch.body.data);
        expect(dispatch.body.outcome).toBe('retry_scheduled');
        tanpaIsiRahasia(dispatch.body);
    });

    it('grant aktif atas surat rahasia membuka isinya, sama seperti daftar surat', async () => {
        await database.exec(`
            INSERT INTO record_access_grants (id, requester_id, target_user_id, entity_type, entity_id, unit_kerja_id,
                required_classification, purpose, access_mode, status, decided_by, decided_at, decision_reason, expires_at) VALUES
                ('69000000-0000-4000-8000-000000000001','${USER_ID.tu}','${USER_ID.tu}','surat_masuk','${uji.smRahasia}','sesditjen',
                 'rahasia','Pemeriksaan antrean integrasi','view','approved','${USER_ID.approver}','2026-09-11T00:00:00Z','Kebutuhan kerja terverifikasi','2099-01-01T00:00:00Z');
        `);
        const detail = await request(app).get(`/api/integrations/srikandi/outbox/${uji.outbox.rahasia}`)
            .set(sebagai(PENGGUNA.tu)).expect(200);
        expect(detail.body.data.item.masked).toBeUndefined();
        expect(detail.body.data.item.payload.record.perihal).toBe(uji.perihal);
    });

    it('super_admin melihat isi semua kelas, sesuai kebijakan daftar surat', async () => {
        const response = await request(app).get('/api/integrations/srikandi/outbox')
            .set(sebagai(PENGGUNA.superAdmin)).expect(200);
        const rahasia = response.body.data.find((item: any) => item.id === uji.outbox.rahasia);
        expect(rahasia.masked).toBeUndefined();
        expect(rahasia.payload.record.perihal).toBe(uji.perihal);
    });

    it('surat sumber yang dihapus atau tipe sumber lain disamarkan', async () => {
        await database.exec(`UPDATE surat_masuk SET is_deleted = true WHERE id = '${SURAT.smBiasa}'`);
        await database.exec(`UPDATE srikandi_outbox SET source_entity_type = 'lain' WHERE id = '${uji.outbox.terbatas}'`);
        const response = await request(app).get('/api/integrations/srikandi/outbox')
            .set(sebagai(PENGGUNA.superAdmin)).expect(200);
        const byId = Object.fromEntries(response.body.data.map((item: any) => [item.id, item]));
        expect(byId[uji.outbox.biasa].masked).toBe(true);
        expect(byId[uji.outbox.terbatas].masked).toBe(true);
        expect(byId[uji.outbox.rahasia].masked).toBeUndefined();
    });
});
