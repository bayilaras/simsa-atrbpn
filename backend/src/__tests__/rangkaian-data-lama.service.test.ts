// backend/src/__tests__/rangkaian-data-lama.service.test.ts
import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRangkaianP5Database, P5_IDS, seedRangkaianBase } from './helpers/rangkaian-p5-pglite.js';

const holder = vi.hoisted(() => ({ db: null as any, audit: vi.fn() }));
vi.mock('../config/database.js', () => ({
    db: {
        select: (...args: any[]) => holder.db.select(...args),
        execute: (query: any) => holder.db.execute(query),
        transaction: (run: any) => holder.db.transaction(run),
    },
}));
vi.mock('../services/audit-log.service.js', () => ({ default: { logActionOrThrow: holder.audit } }));

const superA = { id: P5_IDS.superA, email: 'super-a@example.test', role: 'super_admin', unitKerjaId: null };
const tu = { id: P5_IDS.tu, email: 'tu@example.test', role: 'admin_unit', unitKerjaId: 'sesditjen' };
const bppt = { id: P5_IDS.bppt, email: 'bppt@example.test', role: 'admin_unit', unitKerjaId: 'dir_bppt' };
const id = (n: number) => `00000000-0000-4000-8000-0000000009${String(n).padStart(2, '0')}`;

let database: PGlite;
let klasA: number;
let klasB: number;
let service: typeof import('../services/rangkaian-data-lama.service.js').default;

const rs = (n: number, tahun: number, asal: string, status: string, pengolah: string | null, klasSm: number | null) => `
    INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, nomor_surat, perihal, klasifikasi_item_id)
    VALUES ('${id(n)}', 'ditjen', ${n}, ${tahun}, 'L-${n}', 'Lama ${n}', ${klasSm ?? 'NULL'});
    INSERT INTO rangkaian_surat (id, kode, asal, status, unit_pencatat_id, unit_pengolah_id, judul, tahun, selesai_at)
    VALUES ('${id(50 + n)}', 'RS-${tahun}-7000${n}', '${asal}', '${status}', 'ditjen', ${pengolah ? `'${pengolah}'` : 'NULL'}, 'Lama ${n}', ${tahun},
            ${status === 'selesai' ? 'now()' : 'NULL'});
    INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, unit_kerja_id, peran, sumber)
    VALUES ('${id(50 + n)}', '${id(n)}', 'ditjen', 'induk', 'data_lama');`;

// P5-T1-8: satu basis data per suite; fixture rangkaian dipulihkan per test.
beforeAll(async () => {
    database = await createRangkaianP5Database();
    ({ klasA, klasB } = await seedRangkaianBase(database));
    holder.db = drizzle(database);
    service = (await import('../services/rangkaian-data-lama.service.js')).default;
}, 180_000);
afterAll(async () => {
    delete process.env.RANGKAIAN_TUTUP_MASSAL_DATA_LAMA;
    await database?.close();
});
beforeEach(async () => {
    holder.audit.mockReset();
    process.env.RANGKAIAN_TUTUP_MASSAL_DATA_LAMA = 'true';
    await database.exec(`
        DELETE FROM rangkaian_peserta;
        ALTER TABLE rangkaian_surat DISABLE TRIGGER USER;
        ALTER TABLE rangkaian_anggota DISABLE TRIGGER USER;
        ALTER TABLE surat_masuk DISABLE TRIGGER USER;
        ALTER TABLE surat_distributions DISABLE TRIGGER USER;
        DELETE FROM surat_distributions;
        DELETE FROM rangkaian_anggota;
        DELETE FROM rangkaian_surat;
        DELETE FROM surat_masuk;
        ALTER TABLE rangkaian_surat ENABLE TRIGGER USER;
        ALTER TABLE rangkaian_anggota ENABLE TRIGGER USER;
        ALTER TABLE surat_masuk ENABLE TRIGGER USER;
        ALTER TABLE surat_distributions ENABLE TRIGGER USER;
    `);
    await database.exec([
        rs(1, 2022, 'data_lama', 'selesai', 'dir_bppt', klasA),
        rs(2, 2022, 'data_lama', 'selesai', null, null),
        rs(3, 2023, 'data_lama', 'selesai', null, klasA),
        rs(4, 2023, 'data_lama', 'aktif', null, klasA),
        rs(5, 2023, 'surat_masuk', 'selesai', null, klasA),
    ].join('\n'));
});

const status = async () => (await database.query<any>(`
    SELECT kode, status, unit_pengolah_id, klasifikasi_item_id FROM rangkaian_surat ORDER BY kode`)).rows;

describe('Tutup massal data lama', () => {
    it('ringkasan hanya mengizinkan super_admin dan admin pengawas', async () => {
        expect(await service.ringkasan(superA)).toEqual({ dapatMenutup: true, perTahun: [{ tahun: 2022, jumlah: 2 }, { tahun: 2023, jumlah: 1 }] });
        expect((await service.ringkasan(tu)).dapatMenutup).toBe(true);
        expect(await service.ringkasan(bppt)).toEqual({ dapatMenutup: false, perTahun: [] });
        await expect(service.tutupMassal(bppt, { dryRun: true })).rejects.toMatchObject({ statusCode: 403 });
    });

    it('pratinjau tidak mengubah apa pun dan memisahkan rangkaian tanpa klasifikasi', async () => {
        const before = await status();
        const preview = await service.tutupMassal(superA, { dryRun: true });
        expect(preview).toMatchObject({ jumlah: 2, tanpaKlasifikasi: 1, contoh: ['RS-2022-70001', 'RS-2023-70003'], contohTanpaKlasifikasi: ['RS-2022-70002'], terpotong: false, diterapkan: 0 });
        expect(await status()).toEqual(before);
        expect(holder.audit).not.toHaveBeenCalled();
    });

    it('menerapkan hanya bila expectedCount cocok dengan pratinjau', async () => {
        await expect(service.tutupMassal(superA, { dryRun: false, konfirmasi: true, expectedCount: 5 }))
            .rejects.toMatchObject({ statusCode: 409 });
        const hasil = await service.tutupMassal(tu, { dryRun: false, konfirmasi: true, expectedCount: 2 });
        expect(hasil.diterapkan).toBe(2);
        expect(await status()).toEqual([
            { kode: 'RS-2022-70001', status: 'diberkaskan', unit_pengolah_id: 'dir_bppt', klasifikasi_item_id: klasA },
            { kode: 'RS-2022-70002', status: 'selesai', unit_pengolah_id: null, klasifikasi_item_id: null },
            { kode: 'RS-2023-70003', status: 'diberkaskan', unit_pengolah_id: 'ditjen', klasifikasi_item_id: klasA },
            { kode: 'RS-2023-70004', status: 'aktif', unit_pengolah_id: null, klasifikasi_item_id: null },
            { kode: 'RS-2023-70005', status: 'selesai', unit_pengolah_id: null, klasifikasi_item_id: null },
        ]);
        expect(holder.audit).toHaveBeenCalledTimes(2);
        expect(holder.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'status_change', entityType: 'rangkaian_surat' }), expect.anything());
    });

    it('klasifikasi pengganti dan filter tahun diterapkan pada kandidat yang tepat', async () => {
        const preview = await service.tutupMassal(superA, { dryRun: true, tahun: 2022, klasifikasiItemId: klasB });
        expect(preview).toMatchObject({ jumlah: 2, tanpaKlasifikasi: 0 });
        await service.tutupMassal(superA, { dryRun: false, konfirmasi: true, expectedCount: 2, tahun: 2022, klasifikasiItemId: klasB });
        // Fallback saja: rs1 memakai klasifikasi induk (klasA), rs2 tanpa klasifikasi memakai pengganti (klasB).
        expect((await status()).filter((row) => row.kode.startsWith('RS-2022')).map((row) => row.klasifikasi_item_id)).toEqual([klasA, klasB]);
    });

    it('pengawas hanya menutup rangkaian yang pencatatnya dalam cakupannya', async () => {
        await database.exec(`
            INSERT INTO unit_kerja (id, name, parent_id, unit_type, can_receive_distribution)
            VALUES ('bagian_umum', 'Bagian Umum', 'sesditjen', 'bagian', false) ON CONFLICT (id) DO NOTHING;
            INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, nomor_surat, perihal, klasifikasi_item_id)
            VALUES ('${id(9)}', 'bagian_umum', 9, 2022, 'L-9', 'Lama bagian', ${klasA});
            INSERT INTO rangkaian_surat (id, kode, asal, status, unit_pencatat_id, judul, tahun, selesai_at)
            VALUES ('${id(59)}', 'RS-2022-70009', 'data_lama', 'selesai', 'bagian_umum', 'Lama bagian', 2022, now());
            INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, unit_kerja_id, peran, sumber)
            VALUES ('${id(59)}', '${id(9)}', 'bagian_umum', 'induk', 'data_lama');`);
        expect((await service.ringkasan(tu)).perTahun).toEqual([{ tahun: 2022, jumlah: 2 }, { tahun: 2023, jumlah: 1 }]);
        expect((await service.tutupMassal(tu, { dryRun: true })).contoh).not.toContain('RS-2022-70009');
        expect((await service.ringkasan(superA)).perTahun).toEqual([{ tahun: 2022, jumlah: 3 }, { tahun: 2023, jumlah: 1 }]);
        expect((await service.tutupMassal(superA, { dryRun: true })).contoh).toContain('RS-2022-70009');
    });

    // P5-C-8: kode dan pesan sama dengan berkaskan P3 (berkas.service.ts).
    it('klasifikasi pengganti yang tidak ada ditolak 422', async () => {
        await expect(service.tutupMassal(superA, { dryRun: true, klasifikasiItemId: 99_999_999 }))
            .rejects.toMatchObject({ statusCode: 422, message: 'Klasifikasi berkas tidak ditemukan' });
    });

    it('penghalang P3 (disposisi terbuka) mengecualikan rangkaian dari kandidat', async () => {
        await database.exec(`
            INSERT INTO surat_distributions (surat_masuk_id, source_unit_id, target_unit_id, status, rangkaian_id, penanggung_jawab)
            VALUES ('${id(1)}', 'ditjen', 'dir_bppt', 'sent', '${id(51)}', true);`);
        const preview = await service.tutupMassal(superA, { dryRun: true });
        expect(preview).toMatchObject({ jumlah: 1, contoh: ['RS-2023-70003'] });
    });

    // B-I2 / CTRL-5: gerbang server; hanya nilai persis 'true' yang menyalakan.
    it.each([undefined, 'false', 'TRUE', '1', ' true'])('flag %s: ringkasan dapatMenutup false dan tutup massal 409', async (nilai) => {
        if (nilai === undefined) delete process.env.RANGKAIAN_TUTUP_MASSAL_DATA_LAMA;
        else process.env.RANGKAIAN_TUTUP_MASSAL_DATA_LAMA = nilai;
        const before = await status();
        expect(await service.ringkasan(superA)).toEqual({ dapatMenutup: false, perTahun: [] });
        expect(await service.ringkasan(tu)).toEqual({ dapatMenutup: false, perTahun: [] });
        await expect(service.tutupMassal(superA, { dryRun: true }))
            .rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('belum diaktifkan') });
        await expect(service.tutupMassal(superA, { dryRun: false, konfirmasi: true, expectedCount: 2 }))
            .rejects.toMatchObject({ statusCode: 409 });
        // Bukan pengawas tetap 403 (otorisasi diperiksa lebih dulu).
        await expect(service.tutupMassal(bppt, { dryRun: true })).rejects.toMatchObject({ statusCode: 403 });
        expect(await status()).toEqual(before);
        expect(holder.audit).not.toHaveBeenCalled();
    });

    // B-I2: rangkaian yang calon pengolahnya (tepat satu direktorat disposisi_lama, induk data_lama,
    // pengolah NULL) belum diisi --isi-pengolah tidak ikut pratinjau maupun eksekusi.
    it('rangkaian dengan calon pengolah yang belum diisi dikecualikan dari pratinjau dan eksekusi', async () => {
        await database.exec(`
            INSERT INTO rangkaian_peserta (rangkaian_id, unit_kerja_id, peran, label_asal)
            VALUES ('${id(53)}', 'dir_ptep', 'disposisi_lama', 'PTEP'),
                   ('${id(53)}', 'sesditjen', 'disposisi_lama', 'Sesditjen'),
                   ('${id(52)}', 'dir_ptep', 'disposisi_lama', 'PTEP'),
                   ('${id(52)}', 'dir_ktpp', 'disposisi_lama', 'KTPP'),
                   ('${id(51)}', 'dir_ktpp', 'disposisi_lama', 'KTPP');`);
        // rs3: tepat satu direktorat + pengolah NULL → dikecualikan. rs2: dua direktorat → bukan calon.
        // rs1: satu direktorat tetapi pengolah sudah terisi → tetap kandidat.
        const preview = await service.tutupMassal(superA, { dryRun: true, klasifikasiItemId: klasB });
        expect(preview).toMatchObject({ jumlah: 2, contoh: ['RS-2022-70001', 'RS-2022-70002'] });
        const hasil = await service.tutupMassal(superA, { dryRun: false, konfirmasi: true, expectedCount: 2, klasifikasiItemId: klasB });
        expect(hasil.diterapkan).toBe(2);
        expect((await status()).find((row) => row.kode === 'RS-2023-70003'))
            .toEqual({ kode: 'RS-2023-70003', status: 'selesai', unit_pengolah_id: null, klasifikasi_item_id: null });

        // Setelah --isi-pengolah mengisi pengolah, rangkaian itu kembali menjadi kandidat.
        await database.exec(`UPDATE rangkaian_surat SET unit_pengolah_id = 'dir_ptep' WHERE id = '${id(53)}'`);
        expect(await service.tutupMassal(superA, { dryRun: true })).toMatchObject({ jumlah: 1, contoh: ['RS-2023-70003'] });
    });
});
