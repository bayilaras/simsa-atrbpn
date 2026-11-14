// backend/integration/penomoran-bersamaan.postgres.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { dbState } from './helpers/db-proxy.js';
import { createRangkaianTestDatabase, type RangkaianTestDatabase, type TestUser } from './helpers/rangkaian-db.js';

vi.mock('../src/config/database', () => import('./helpers/db-proxy.js'));
vi.mock('../src/config/database.js', () => import('./helpers/db-proxy.js'));
vi.mock('../src/services/srikandi-producer.service.js', () => ({ srikandiBusinessProducer: {
    suratMasukCreated: async () => {}, suratKeluarCreated: async () => {},
} }));

const { suratMasukService } = await import('../src/services/surat-masuk.service.js');
const { settingsService } = await import('../src/services/settings.service.js');

// Tanpa TEST_POSTGRES_URL suite ini dilewati bersih (tidak ada Postgres lokal);
// CI menjalankannya pada PG16/17/18. Versi fungsional berkoneksi tunggal:
// src/__tests__/penomoran-surat.integration.test.ts.
const adaPostgres = Boolean(process.env.TEST_POSTGRES_URL);
const UNIT = 'sesditjen';

let h: RangkaianTestDatabase;
let tu: TestUser;
const audit = () => ({ userId: tu.id, userEmail: tu.email });
const catat = (extra: Record<string, unknown>) => suratMasukService.create({
    unitKerjaId: UNIT, jenisSurat: 'Nota Dinas', sifatSurat: 'biasa', tanggalSurat: '2026-09-21',
    perihal: 'Pendaftaran bersamaan', dari: 'Pemda Sintetis', createdBy: tu.id, actor: tu, ...extra,
} as any, audit());
const nomorTerpakai = async (tahun: number) => (await h.query<{ no_urut: number }>(
    'SELECT no_urut FROM surat_masuk WHERE unit_kerja_id = $1 AND tahun = $2 ORDER BY no_urut', [UNIT, tahun])).map(row => row.no_urut);

/**
 * Koneksi lain memegang kunci baris templat unit (mutex penomoran) sampai
 * `lepas`. Transaksi yang dimulai selama itu harus mengantre di kunci yang
 * sama; urutan sesudah dilepas ditentukan PostgreSQL, bukan oleh uji ini.
 */
async function tahanKunciTemplat() {
    await h.db.transaction((tx: any) => settingsService.lockSuratTemplates(tx, UNIT));
    const pemegang = await h.pool.connect();
    await pemegang.query('BEGIN');
    await pemegang.query('SELECT unit_kerja_id FROM surat_templates WHERE unit_kerja_id = $1 FOR UPDATE', [UNIT]);
    return {
        async tungguAntrean(jumlah: number) {
            const batas = Date.now() + 10_000;
            for (;;) {
                const [{ menunggu }] = await h.query<{ menunggu: number }>(`SELECT count(*)::int AS menunggu FROM pg_stat_activity
                    WHERE datname = current_database() AND wait_event_type = 'Lock'`);
                if (menunggu >= jumlah) return;
                if (Date.now() > batas) throw new Error(`hanya ${menunggu} dari ${jumlah} transaksi mengantre di kunci templat unit`);
                await new Promise(resolve => setTimeout(resolve, 25));
            }
        },
        async lepas() {
            try { await pemegang.query('COMMIT'); } finally { pemegang.release(); }
        },
    };
}

async function bersamaan<T>(...kerja: Array<() => Promise<T>>) {
    const kunci = await tahanKunciTemplat();
    let hasil: Promise<PromiseSettledResult<T>[]> | undefined;
    try {
        hasil = Promise.allSettled(kerja.map(run => run()));
        await kunci.tungguAntrean(kerja.length);
    } finally {
        await kunci.lepas();
    }
    return hasil;
}

describe.skipIf(!adaPostgres)('penomoran surat masuk bersamaan di PostgreSQL (READ COMMITTED, koneksi terpisah)', () => {
    beforeAll(async () => {
        h = await createRangkaianTestDatabase('penomoran');
        dbState.db = h.db;
        await h.seedUnits();
        tu = await h.seedUser('admin_unit', UNIT);
    }, 120_000);
    afterAll(async () => { await h?.close(); });

    it('dua pendaftaran dengan No. Agenda yang sama: satu tersimpan, yang lain 409 yang menyebut nomornya', async () => {
        const [a, b] = await bersamaan(() => catat({ noUrut: 500, nomorSurat: 'EXT-500A/2026' }), () => catat({ noUrut: 500, nomorSurat: 'EXT-500B/2026' }));
        const berhasil = [a, b].filter(hasil => hasil.status === 'fulfilled');
        const ditolak = [a, b].filter((hasil): hasil is PromiseRejectedResult => hasil.status === 'rejected');
        expect(berhasil).toHaveLength(1);
        // 409 dari pemeriksaan di bawah kunci, bukan pelanggaran indeks unik yang menjadi galat server.
        expect(ditolak[0].reason).toMatchObject({ statusCode: 409, message: expect.stringMatching(/^No\. Agenda 500 tahun 2026 sudah dipakai/) });
        expect(await nomorTerpakai(2026)).toEqual([500]);
    });

    it('No. Agenda yang diketik dan nomor otomatis yang berjalan bersamaan tidak pernah sama', async () => {
        const [manual, otomatis] = await bersamaan(() => catat({ noUrut: 501, nomorSurat: 'EXT-501/2026' }), () => catat({ nomorSurat: 'EXT-OTO/2026' }));
        expect(otomatis.status).toBe('fulfilled');
        if (manual.status === 'fulfilled') {
            // Manual lebih dulu: otomatis melanjutkan sesudahnya.
            expect([manual.value.noUrut, (otomatis as PromiseFulfilledResult<any>).value.noUrut]).toEqual([501, 502]);
        } else {
            // Otomatis lebih dulu mengambil 501: manual ditolak dengan 409, bukan nomor ganda.
            expect((otomatis as PromiseFulfilledResult<any>).value.noUrut).toBe(501);
            expect(manual.reason).toMatchObject({ statusCode: 409 });
        }
        const nomor = await nomorTerpakai(2026);
        expect(new Set(nomor).size).toBe(nomor.length);
    });

    it('surat yang pindah tahun dan pendaftaran di tahun tujuan mengantre di kunci yang sama dan mendapat nomor berbeda', async () => {
        await catat({ tanggalSurat: '2025-11-20', noUrut: 40, nomorSurat: 'EXT-40/2025' });
        const pindah = await catat({ nomorSurat: 'EXT-PINDAH/2026' });
        const [diubah, baru] = await bersamaan<any>(
            () => suratMasukService.update(pindah.id, { tanggalSurat: '2025-12-30' }, UNIT, undefined, audit()),
            () => catat({ tanggalSurat: '2025-12-29', nomorSurat: 'EXT-BARU/2025' }),
        );
        expect(diubah.status).toBe('fulfilled');
        expect(baru.status).toBe('fulfilled');
        const nomorPindah = (diubah as PromiseFulfilledResult<any>).value.noUrut;
        const nomorBaru = (baru as PromiseFulfilledResult<any>).value.noUrut;
        expect([nomorPindah, nomorBaru].sort()).toEqual([41, 42]);
        expect(await nomorTerpakai(2025)).toEqual([40, 41, 42]);
    });
});
