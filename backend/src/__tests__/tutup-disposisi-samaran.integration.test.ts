import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { DISPOSISI, PENGGUNA, RAHASIA, SURAT, bootRangkaianDatabase, seedRangkaianFixture } from './helpers/rangkaian-pglite';

// Versi PGlite (tanpa TEST_POSTGRES_URL) untuk A-I2 dan M-7 (CTRL-1):
// - respons Tutup Disposisi tersamar bila pengawas tidak dapat membaca surat induk;
// - super_admin (unit NULL maupun unit pengawas) tidak pernah dapat Tutup.

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));

let database: PGlite;
let distributionService: typeof import('../services/distribution.service').distributionService;

const audit = (u: { id: string }) => ({ userId: u.id, userEmail: 'uji@example.test' });

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    distributionService = (await import('../services/distribution.service')).distributionService;
}, 60_000);

afterAll(async () => {
    await database?.close();
});

beforeEach(async () => {
    await seedRangkaianFixture(database);
});

async function barisDisposisi(id: string) {
    return (await database.query<{ status: string; ditutup_pengawas: boolean }>(
        'SELECT status, ditutup_pengawas FROM surat_distributions WHERE id = $1', [id])).rows[0];
}

describe('Tutup Disposisi: samaran respons (A-I2)', () => {
    it('pengawas yang tidak dapat membaca SM Terbatas menerima baris tersamar', async () => {
        const hasil = await distributionService.tutupOlehPengawas(DISPOSISI.rs2Ptep, PENGGUNA.tu, 'Target tidak dapat memproses surat ini', audit(PENGGUNA.tu));
        expect(hasil).toMatchObject({
            id: DISPOSISI.rs2Ptep, status: 'processed', ditutupPengawas: true, masked: true,
            suratMasukId: null, instruction: null, catatanPenyelesaian: null, rejectionReason: null, penyelesaianSuratKeluarId: null,
        });
        const teks = JSON.stringify(hasil);
        for (const bocor of [SURAT.smTerbatas, RAHASIA.instruksiRs2, RAHASIA.perihalSmTerbatas, RAHASIA.nomorSmTerbatas]) {
            expect(teks).not.toContain(bocor);
        }
        expect(await barisDisposisi(DISPOSISI.rs2Ptep)).toEqual({ status: 'processed', ditutup_pengawas: true });
    });

    it('pengawas yang dapat membaca SM menerima baris utuh', async () => {
        const hasil = await distributionService.tutupOlehPengawas(DISPOSISI.rs1Bppt, PENGGUNA.tu, 'Target tidak dapat memproses surat ini', audit(PENGGUNA.tu));
        expect(hasil).toMatchObject({ id: DISPOSISI.rs1Bppt, suratMasukId: SURAT.smBiasa, instruction: 'Mohon ditindaklanjuti', ditutupPengawas: true });
        expect((hasil as { masked?: boolean }).masked).toBeUndefined();
    });
});

describe('Tutup Disposisi: CTRL-1 super_admin (M-7)', () => {
    it.each([
        ['tanpa unit', PENGGUNA.superAdmin],
        ['dengan unit pengawas', { ...PENGGUNA.superAdmin, unitKerjaId: 'sesditjen' }],
    ])('super_admin %s ditolak 403 dan baris tidak berubah', async (_label, aktor) => {
        await expect(distributionService.tutupOlehPengawas(DISPOSISI.rs1Bppt, aktor as never, 'Percobaan super admin menutup', audit(aktor)))
            .rejects.toMatchObject({ statusCode: 403 });
        expect(await barisDisposisi(DISPOSISI.rs1Bppt)).toEqual({ status: 'received', ditutup_pengawas: false });
    });
});
