// backend/integration/asal-naskah.postgres.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { dbState } from './helpers/db-proxy.js';
import { createRangkaianTestDatabase, type RangkaianTestDatabase, type TestUser } from './helpers/rangkaian-db.js';

// Mock `db` bersama untuk suite Postgres (T2-5).
vi.mock('../src/config/database', () => import('./helpers/db-proxy.js'));
vi.mock('../src/config/database.js', () => import('./helpers/db-proxy.js'));

const { asalNaskahService, PESAN_BUKAN_INISIATIF, PESAN_SUDAH_ANGGOTA } = await import('../src/services/asal-naskah.service.js');
const { rangkaianService, aktor } = await import('../src/services/rangkaian/deps.js');

// Tanpa TEST_POSTGRES_URL suite ini dilewati bersih (tidak ada Postgres lokal);
// CI menjalankannya pada PG16/17/18. Versi PGlite: src/__tests__/asal-naskah.integration.test.ts.
const adaPostgres = Boolean(process.env.TEST_POSTGRES_URL);

let h: RangkaianTestDatabase;
let bppt: TestUser;
const audit = (u: TestUser) => ({ userId: u.id, userEmail: u.email });

describe.skipIf(!adaPostgres)('tandaiInisiatif ∥ tautan P3 (F1, READ COMMITTED)', () => {
    beforeAll(async () => {
        h = await createRangkaianTestDatabase('asalnaskah');
        dbState.db = h.db;
        await h.seedUnits();
        bppt = await h.seedUser('admin_unit', 'dir_bppt');
    }, 120_000);
    afterAll(async () => { await h?.close(); });

    it.each([
        ['relasi aktif', true, PESAN_BUKAN_INISIATIF],
        ['keanggotaan tanpa relasi', false, PESAN_SUDAH_ANGGOTA],
    ] as const)('menunggu tautan yang sedang mengunci surat lalu melihat %s yang di-commit-nya: 409, asal tetap NULL', async (label, denganRelasi, pesan) => {
        const nomor = denganRelasi ? 'R' : 'A';
        const skInduk = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: `KEP-F1${nomor}/2026`, approvalStatus: 'approved', asalNaskah: 'inisiatif' });
        const induk = await h.db.transaction((tx: any) => rangkaianService.ensureForSurat(tx, { jenis: 'surat_keluar', id: skInduk }, aktor(bppt)));
        const sk = await h.insertSuratKeluar({ unitKerjaId: 'dir_bppt', nomorSurat: `ND-F1${nomor}/2026` });

        // Koneksi A meniru tautan P3 (rangkaian-link.service.ts): kunciSurat atas baris surat_keluar,
        // lalu INSERT anggota/relasi TANPA mengubah baris surat_keluar, dan belum commit.
        const penaut = await h.pool.connect();
        let tandai: Promise<unknown> | undefined;
        try {
            await penaut.query('BEGIN');
            const [{ pid }] = (await penaut.query('SELECT pg_backend_pid() AS pid')).rows as { pid: number }[];
            await penaut.query('SELECT id FROM surat_keluar WHERE id = $1 ORDER BY id FOR UPDATE', [sk]);
            const [{ id: anggotaId }] = (await penaut.query(
                `INSERT INTO rangkaian_anggota (rangkaian_id, surat_keluar_id, unit_kerja_id, peran, sumber, ditambahkan_by)
                 VALUES ($1, $2, 'dir_bppt', 'anggota', 'tautan', $3) RETURNING id`,
                [induk.rangkaianId, sk, bppt.id])).rows as { id: string }[];
            if (denganRelasi) {
                await penaut.query(
                    `INSERT INTO rangkaian_relasi (rangkaian_id, dari_anggota_id, ke_anggota_id, jenis_relasi, created_by)
                     VALUES ($1, $2, $3, 'tindak_lanjut', $4)`,
                    [induk.rangkaianId, anggotaId, induk.anggotaId, bppt.id]);
            }

            // Koneksi B: tandaiInisiatif harus menunggu kunci baris surat_keluar milik A.
            tandai = asalNaskahService.tandaiInisiatif(bppt, sk, audit(bppt));
            tandai.catch(() => undefined);   // ditunggu di bawah; cegah unhandled rejection sementara menunggu kunci

            const batas = Date.now() + 10_000;
            for (;;) {
                const [{ menunggu }] = await h.query<{ menunggu: boolean }>(
                    'SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1::int = ANY (pg_blocking_pids(pid))) AS menunggu', [pid]);
                if (menunggu) break;
                if (Date.now() > batas) throw new Error(`tandaiInisiatif tidak pernah menunggu kunci surat_keluar (${label})`);
                await new Promise(r => setTimeout(r, 25));
            }
            await penaut.query('COMMIT');
        } catch (error) {
            await penaut.query('ROLLBACK').catch(() => undefined);
            throw error;
        } finally {
            penaut.release();
        }

        await expect(tandai).rejects.toMatchObject({ statusCode: 409, message: pesan });
        const [akhir] = await h.query<{ asal_naskah: string | null }>('SELECT asal_naskah FROM surat_keluar WHERE id = $1', [sk]);
        expect(akhir.asal_naskah).toBeNull();
        expect(await h.query('SELECT 1 FROM audit_log WHERE entity_type = $1 AND entity_id = $2', ['surat_keluar', sk])).toHaveLength(0);
    });
});
