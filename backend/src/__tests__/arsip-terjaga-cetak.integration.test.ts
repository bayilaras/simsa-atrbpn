import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import express from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { bootRangkaianDatabase } from './helpers/rangkaian-pglite';

// Cetak Daftar Arsip Terjaga: nama unit (bukan kodenya), label kategori, dan
// tanggal cetak menurut WIB.
const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));
vi.mock('../middlewares/auth.middleware', () => ({ authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'admin-bppt', email: 'admin@example.test', role: 'admin_unit', unitKerjaId: 'dir_bppt' }; next();
} }));

const ARSIP = '78000000-0000-4000-8000-000000000001';
const zonaAsal = process.env.TZ;

let database: PGlite;
let app: express.Express;
let PDFDocument: any;

beforeAll(async () => {
    process.env.TZ = 'UTC';
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    const { default: arsipTerjagaRoutes } = await import('../routes/arsip-terjaga.routes');
    app = express().use('/api/arsip-terjaga', arsipTerjagaRoutes);
    PDFDocument = await (await import('../utils/lazy-libraries')).loadPdfKit();
    await database.exec(`
        INSERT INTO unit_kerja (id, name) VALUES ('dir_bppt','Direktorat BPPT') ON CONFLICT (id) DO UPDATE SET name = excluded.name;
        INSERT INTO arsip (id, unit_kerja_id, jenis_arsip, tahun, klasifikasi_keamanan, nomor_berkas, uraian_berkas, kurun_waktu) VALUES
            ('${ARSIP}','dir_bppt','keluar',2026,'biasa','TERJAGA-1','Peta batas pulau terluar','2026');
        INSERT INTO arsip_terjaga (arsip_id, unit_kerja_id, kategori_terjaga) VALUES ('${ARSIP}','dir_bppt','perjanjian_internasional');
    `);
}, 120_000);
afterAll(async () => {
    await database?.close();
    if (zonaAsal === undefined) delete process.env.TZ;
    else process.env.TZ = zonaAsal;
});
beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // Pukul 01.30 WIB tanggal 14, masih tanggal 13 menurut UTC.
    vi.setSystemTime(new Date('2026-11-13T18:30:00Z'));
});
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('cetak Daftar Arsip Terjaga', () => {
    it('memakai nama unit, label kategori, dan tanggal cetak WIB', async () => {
        const asli = PDFDocument.prototype.text;
        const teks: string[] = [];
        vi.spyOn(PDFDocument.prototype, 'text').mockImplementation(function (this: any, ...args: any[]) {
            teks.push(String(args[0]));
            return asli.apply(this, args);
        });
        const response = await request(app).get('/api/arsip-terjaga/print/daftar').responseType('blob').expect(200);
        expect((response.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');

        expect(teks).toContain('Unit Kerja: Direktorat BPPT');
        expect(teks).toContain('Tanggal Cetak: 14/11/2026');
        expect(teks).toContain('Arsip Perjanjian Internasional');
        expect(teks).not.toContain('perjanjian_internasional');
        expect(teks.join('\n')).not.toContain('dir_bppt');
    });
});
