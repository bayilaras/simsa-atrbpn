import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import express from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { bootRangkaianDatabase } from './helpers/rangkaian-pglite';

// Cetak Daftar Arsip Vital: nama unit (bukan kodenya), media sesuai data
// arsip, dan filter yang sama dengan tabel di layar.
const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));
vi.mock('../middlewares/auth.middleware', () => ({ authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'admin-bppt', email: 'admin@example.test', role: 'admin_unit', unitKerjaId: 'dir_bppt' }; next();
} }));

const ARSIP = ['77000000-0000-4000-8000-000000000001', '77000000-0000-4000-8000-000000000002', '77000000-0000-4000-8000-000000000003'];
const zonaAsal = process.env.TZ;

let database: PGlite;
let app: express.Express;
let PDFDocument: any;

beforeAll(async () => {
    // Server produksi berjalan dalam UTC.
    process.env.TZ = 'UTC';
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    const { default: arsipVitalRoutes } = await import('../routes/arsip-vital.routes');
    app = express().use('/api/arsip-vital', arsipVitalRoutes);
    PDFDocument = await (await import('../utils/lazy-libraries')).loadPdfKit();
    await database.exec(`
        INSERT INTO unit_kerja (id, name) VALUES ('dir_bppt','Direktorat BPPT') ON CONFLICT (id) DO UPDATE SET name = excluded.name;
        INSERT INTO arsip (id, unit_kerja_id, jenis_arsip, tahun, klasifikasi_keamanan, nomor_berkas, uraian_berkas, media_type, kurun_waktu) VALUES
            ('${ARSIP[0]}','dir_bppt','keluar',2026,'biasa','VITAL-HUKUM-1','Perjanjian sewa gedung','elektronik','2026'),
            ('${ARSIP[1]}','dir_bppt','keluar',2026,'biasa','VITAL-ASET-1','Sertipikat tanah kantor','kertas','2025'),
            ('${ARSIP[2]}','dir_bppt','keluar',2026,'biasa','VITAL-HUKUM-2','Putusan pengadilan','foto','2024');
        INSERT INTO arsip_vital (arsip_id, unit_kerja_id, kategori_vital, tingkat_kekritisan, alasan_penetapan, lokasi_backup, status_proteksi) VALUES
            ('${ARSIP[0]}','dir_bppt','hukum','kritis','Dokumen perjanjian','Lemari Besi 1','terlindungi'),
            ('${ARSIP[1]}','dir_bppt','aset','sangat_kritis','Bukti kepemilikan','Brankas','belum_diproteksi'),
            ('${ARSIP[2]}','dir_bppt','hukum','penting','Arsip perkara','Lemari Besi 2','belum_diproteksi');
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

const rekaman = { panggilan: [] as any[][], lanjutOtomatis: 0 };
async function cetak(query: Record<string, string> = {}) {
    const asli = PDFDocument.prototype.text;
    const asliLanjut = PDFDocument.prototype.continueOnNewPage;
    const teks: string[] = [];
    rekaman.panggilan = [];
    rekaman.lanjutOtomatis = 0;
    vi.spyOn(PDFDocument.prototype, 'text').mockImplementation(function (this: any, ...args: any[]) {
        teks.push(String(args[0]));
        rekaman.panggilan.push(args);
        return asli.apply(this, args);
    });
    // pdfkit menyambung teks ke halaman baru sendiri bila sel melewati batas bawah.
    vi.spyOn(PDFDocument.prototype, 'continueOnNewPage').mockImplementation(function (this: any, ...args: any[]) {
        rekaman.lanjutOtomatis += 1;
        return asliLanjut.apply(this, args);
    });
    const response = await request(app).get('/api/arsip-vital/print/daftar').query(query).responseType('blob').expect(200);
    expect((response.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    return teks;
}

const nomorBerkas = (teks: string[]) => teks.filter(nilai => nilai.startsWith('VITAL-')).sort();

describe('Cetak Daftar Arsip Vital', () => {
    it('menulis nama unit, media dan kategori sesuai data, serta tanggal WIB', async () => {
        const teks = await cetak();
        expect(teks).toContain('Unit Kerja: Direktorat BPPT');
        expect(teks.join('\n')).not.toContain('dir_bppt');
        expect(nomorBerkas(teks)).toEqual(['VITAL-ASET-1', 'VITAL-HUKUM-1', 'VITAL-HUKUM-2']);
        expect(teks).toEqual(expect.arrayContaining(['Elektronik', 'Kertas', 'Foto']));
        expect(teks.filter(nilai => nilai === 'Kertas')).toHaveLength(1);
        expect(teks).toEqual(expect.arrayContaining(['Hukum (Perjanjian, Hak Paten, Perkara)', 'Aset Negara (Sertipikat, BPKB, Gedung)']));
        expect(teks).not.toContain('hukum');
        expect(teks.some(nilai => nilai.startsWith('Filter:'))).toBe(false);
        expect(teks).toContain('Tanggal Cetak: 14/11/2026');
        // Isi kolom adalah lokasi cadangan dan kategori penetapan arsip vital.
        expect(teks).toEqual(expect.arrayContaining(['Lokasi Cadangan', 'Kategori']));
        expect(teks).not.toContain('Lokasi Simpan');
        expect(teks).not.toContain('Ket.');
        expect(teks.some(nilai => nilai.startsWith('Teks yang terlalu panjang'))).toBe(false);
        expect(teks).toContain('Jakarta, 14/11/2026');
    });

    it.each([
        [{ kategoriVital: 'hukum' }, ['VITAL-HUKUM-1', 'VITAL-HUKUM-2'], 'Filter: Kategori Hukum (Perjanjian, Hak Paten, Perkara)'],
        [{ statusProteksi: 'belum_diproteksi' }, ['VITAL-ASET-1', 'VITAL-HUKUM-2'], 'Filter: Status Proteksi Belum Diproteksi'],
        [{ statusProteksi: 'belum_diproteksi', search: 'perkara' }, ['VITAL-HUKUM-2'], 'Filter: Status Proteksi Belum Diproteksi; Pencarian "perkara"'],
    ])('memakai filter tabel %j', async (filter, harapan, keterangan) => {
        const teks = await cetak(filter);
        expect(nomorBerkas(teks)).toEqual(harapan);
        expect(teks).toContain(keterangan);

        // Baris yang tercetak sama dengan tabel di layar untuk filter yang sama.
        const tabel = await request(app).get('/api/arsip-vital').query({ ...filter, limit: 100 }).expect(200);
        expect(tabel.body.data.map((row: any) => row.nomorBerkas).sort()).toEqual(harapan);
    });
    it('uraian 4.000 karakter dipotong di barisnya sendiri dengan catatan', async () => {
        const uraianPanjang = 'Uraian arsip vital yang sangat panjang '.repeat(110).slice(0, 4000);
        const id = '77000000-0000-4000-8000-000000000004';
        await database.query(
            `INSERT INTO arsip (id, unit_kerja_id, jenis_arsip, tahun, klasifikasi_keamanan, nomor_berkas, uraian_berkas, media_type)
                VALUES ($1, 'dir_bppt', 'keluar', 2026, 'biasa', 'VITAL-PANJANG', $2, 'kertas')`, [id, uraianPanjang]);
        await database.query(
            `INSERT INTO arsip_vital (arsip_id, unit_kerja_id, kategori_vital, tingkat_kekritisan, status_proteksi)
                VALUES ($1, 'dir_bppt', 'kebijakan', 'penting', 'terlindungi')`, [id]);

        const teks = await cetak({ kategoriVital: 'kebijakan' });
        expect(nomorBerkas(teks)).toEqual(['VITAL-PANJANG']);
        expect(rekaman.lanjutOtomatis).toBe(0);
        const [, , y, opsi] = rekaman.panggilan.find(([nilai]) => nilai === uraianPanjang)!;
        expect(opsi.ellipsis).toBe(true);
        // A4 lanskap dengan margin 50 pt.
        expect(y + opsi.height).toBeLessThanOrEqual(595.28 - 50);
        expect(teks).toContain('Teks yang terlalu panjang dipotong; isi lengkap ada pada detail arsip di aplikasi.');
    });
});
