import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LABEL_ISIAN, namaIsian } from '../validators/pesan-zod.js';
import { validateBody, validateQuery } from '../middlewares/validate.middleware.js';
import { badanGalatValidasi, PESAN_VALIDASI_UMUM } from '../utils/galat-validasi.js';
import * as skemaUmum from '../validators/schemas.js';
import * as skemaPencarianArsip from '../validators/arsip-search.schemas.js';
import * as skemaBuktiPenyusutan from '../validators/penyusutan-evidence.schemas.js';
import * as skemaPreservasi from '../validators/preservation-activity.schemas.js';
import * as skemaRangkaianBerkas from '../validators/rangkaian-berkas.schemas.js';
import * as skemaHakAkses from '../validators/record-access-grant.schemas.js';
import * as skemaRegulasi from '../validators/regulatory-rule-set.schemas.js';
import * as skemaRetensi from '../validators/retention-governance.schemas.js';
import * as skemaSrikandi from '../validators/srikandi.schemas.js';
import * as skemaTerjaga from '../validators/terjaga-report.schemas.js';
import * as skemaPengguna from '../validations/user-management.validation.js';

const TEKS_INGGRIS = /\b(Invalid|expected|received|Too (big|small)|Unrecognized|Required|must|option)\b/;

function pesan(schema: z.ZodType, data: unknown) {
    const hasil = schema.safeParse(data);
    if (hasil.success) throw new Error('data seharusnya ditolak');
    return hasil.error.issues.map(isu => isu.message);
}

describe('peta pesan Zod berbahasa Indonesia', () => {
    it('isian wajib, panjang teks, angka, pilihan, dan format menyebut nama isiannya', () => {
        const schema = z.object({
            perihal: z.string(),
            judul: z.string().min(1).max(5),
            jumlah: z.coerce.number().int().min(1).max(10),
            capacity: z.number().positive(),
            status: z.enum(['aktif', 'selesai']),
            email: z.string().email(),
            linkDokumen: z.string().url(),
            arsipId: z.string().uuid(),
            arsipIds: z.array(z.string()).min(1).max(2),
            tanggalSurat: z.string().regex(/^\d{4}$/),
        });
        expect(pesan(schema, {
            judul: 'panjang sekali', jumlah: 'abc', capacity: 0, status: 'lain', email: 'bukan',
            linkDokumen: 'contoh', arsipId: '12', arsipIds: [], tanggalSurat: 'x',
        })).toEqual([
            'Perihal wajib diisi',
            'Judul maksimal 5 karakter',
            'Jumlah harus berupa angka',
            'Kapasitas harus lebih dari 0',
            'Status tidak sesuai pilihan yang tersedia',
            'Email harus berupa alamat email yang benar',
            'Link dokumen harus berupa alamat lengkap, misalnya https://contoh.go.id',
            'Arsip tidak valid',
            'Daftar arsip wajib dipilih',
            'Tanggal surat tidak sesuai format',
        ]);
        expect(pesan(schema.pick({ judul: true, jumlah: true, arsipIds: true }), { judul: '', jumlah: 11, arsipIds: ['a', 'b', 'c'] }))
            .toEqual(['Judul wajib diisi', 'Jumlah maksimal 10', 'Daftar arsip maksimal 2']);
    });

    it('isian di dalam daftar menyebut urutan barisnya; isian tanpa label tidak menampilkan nama kode', () => {
        const schema = z.object({ items: z.array(z.object({ nomor: z.string(), kolomBaru: z.string() })) });
        expect(pesan(schema, { items: [{ nomor: 'A', kolomBaru: 'x' }, {}] }))
            .toEqual(['Nomor pada Daftar item ke-2 wajib diisi', 'Isian pada Daftar item ke-2 wajib diisi']);
        expect(namaIsian(['arsipIds', 2])).toBe('Daftar arsip ke-3');
        expect(namaIsian([])).toBe('Data');
    });

    it('isian yang tidak dikenali skema .strict() dijelaskan tanpa nama kode yang tidak berlabel', () => {
        expect(pesan(skemaUmum.alasanSchema, { alasan: 'alasan yang cukup panjang', rahasiaKode: 1 }))
            .toEqual(['Ada isian yang tidak dikenali. Muat ulang halaman, lalu coba lagi.']);
        expect(pesan(skemaUmum.daftarRangkaianQuerySchema, { unitKerjaId: 'dir_a' }))
            .toEqual(['Isian Unit kerja tidak dikenali di sini. Muat ulang halaman, lalu coba lagi.']);
    });

    it('filter persetujuan surat keluar dengan nilai lain ditolak dalam bahasa Indonesia', () => {
        expect(pesan(skemaUmum.querySuratKeluarSchema, { persetujuan: 'semua' }))
            .toEqual(['Filter persetujuan tidak sesuai pilihan yang tersedia']);
    });

    it('disposisi melebihi batas menyebut batas unit tujuan dan label yang sebenarnya', () => {
        const dasar = { unitKerjaId: 'dir_a', tanggalSurat: '2026-01-05', perihal: 'Perihal', dari: 'Pengirim' };
        const target = (i: number) => ({ unitKerjaId: `unit_${i}` });
        expect(pesan(skemaUmum.createSuratMasukSchema, { ...dasar, disposisi: { targets: Array.from({ length: 11 }, (_, i) => target(i)) } }))
            .toEqual(['Unit tujuan disposisi maksimal 10']);
        expect(pesan(skemaUmum.createSuratMasukSchema, {
            ...dasar, disposisi: { targets: [target(1)], labelTambahan: Array.from({ length: 11 }, (_, i) => `Label ${i}`) },
        })).toEqual(['Label disposisi maksimal 10']);
        // Bentuk yang tidak cocok dengan cabang mana pun tetap memakai pesan umum disposisi.
        expect(pesan(skemaUmum.createSuratMasukSchema, { ...dasar, disposisi: 5 }))
            .toEqual(['Disposisi tidak valid. Periksa unit tujuan dan batas waktunya.']);
    });

    it('union lain memakai pesan cabang yang cocok bentuknya', () => {
        const schema = z.object({ nilai: z.union([z.string().max(3), z.number()]) });
        expect(pesan(schema, { nilai: 'panjang' })).toEqual(['Isian maksimal 3 karakter']);
        expect(pesan(schema, { nilai: true })).toEqual(['Isian tidak valid']);
    });

    it('setiap isian skema permintaan punya label Indonesia', () => {
        const kunci = new Set<string>();
        const dilihat = new Set<unknown>();
        const jelajahi = (skema: any) => {
            if (!skema || typeof skema !== 'object' || dilihat.has(skema)) return;
            dilihat.add(skema);
            const def = skema._zod?.def;
            if (!def) return;
            if (def.shape) for (const [nama, anak] of Object.entries(def.shape)) { kunci.add(nama); jelajahi(anak); }
            for (const bagian of ['innerType', 'in', 'out', 'element', 'schema', 'valueType', 'left', 'right']) jelajahi(def[bagian]);
            if (Array.isArray(def.options)) def.options.forEach(jelajahi);
        };
        for (const modul of [skemaUmum, skemaPencarianArsip, skemaBuktiPenyusutan, skemaPreservasi, skemaRangkaianBerkas,
            skemaHakAkses, skemaRegulasi, skemaRetensi, skemaSrikandi, skemaTerjaga, skemaPengguna]) {
            Object.values(modul).forEach(jelajahi);
        }
        expect(kunci.size).toBeGreaterThan(100);
        expect([...kunci].filter(nama => !Object.hasOwn(LABEL_ISIAN, nama))).toEqual([]);
    });
});

describe('respons validasi', () => {
    const app = express();
    app.use(express.json());
    app.post('/uji', validateBody(skemaUmum.createDosirSchema), (_req, res) => { res.json({ ok: true }); });
    app.get('/uji', validateQuery(skemaUmum.querySuratKeluarSchema), (_req, res) => { res.json({ ok: true }); });

    it('400 berteks Indonesia dengan rincian per isian', async () => {
        const res = await request(app).post('/uji').send({ judul: 'J'.repeat(501), deskripsi: 7 }).expect(400);
        expect(res.body).toEqual({
            success: false,
            error: PESAN_VALIDASI_UMUM,
            message: 'Data yang dikirim belum valid. Periksa isian berikut.',
            code: 'VALIDATION_ERROR',
            details: [
                { field: 'judul', message: 'Judul maksimal 500 karakter' },
                { field: 'deskripsi', message: 'Deskripsi harus berupa teks' },
            ],
        });
        expect(JSON.stringify(res.body)).not.toMatch(TEKS_INGGRIS);
        expect(JSON.stringify(res.body)).not.toContain('Validation failed');
    });

    it('kueri yang tidak sesuai juga dijawab dalam bahasa Indonesia', async () => {
        const res = await request(app).get('/uji').query({ persetujuan: 'semua', page: 'x' }).expect(400);
        expect(res.body.details).toEqual([
            { field: 'page', message: 'Halaman harus berupa angka' },
            { field: 'persetujuan', message: 'Filter persetujuan tidak sesuai pilihan yang tersedia' },
        ]);
    });

    it('jalur isian bertingkat digabung dengan titik', () => {
        expect(badanGalatValidasi([{ path: ['items', 0, 'nomor'], message: 'Nomor wajib diisi' }]).details)
            .toEqual([{ field: 'items.0.nomor', message: 'Nomor wajib diisi' }]);
    });
});
