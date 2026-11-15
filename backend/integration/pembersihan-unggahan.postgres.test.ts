// backend/integration/pembersihan-unggahan.postgres.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { dbState } from './helpers/db-proxy.js';
import { createRangkaianTestDatabase, type RangkaianTestDatabase, type TestUser } from './helpers/rangkaian-db.js';

// Query pembersihan unggahan langsung dijalankan pada Postgres sungguhan:
// uji unit memakai mock db sehingga tidak menangkap galat tipe parameter.
vi.mock('../src/config/database', () => import('./helpers/db-proxy.js'));
vi.mock('../src/config/database.js', () => import('./helpers/db-proxy.js'));

const hapus = vi.fn<(url: string) => Promise<boolean>>();
vi.mock('../src/services/blob-storage.service.js', () => ({ blobStorageService: { deleteFile: (url: string) => hapus(url) } }));

const { clientBlobUploadService } = await import('../src/services/client-blob-upload.service.js');

const adaPostgres = Boolean(process.env.TEST_POSTGRES_URL);
const JAM = 3_600_000;

let h: RangkaianTestDatabase;
let pengunggah: TestUser;

async function unggahan(nama: string, status: string, kedaluwarsa: Date, tambahan: { lastCleanupError?: string; updatedAt?: Date; cleanupAttempts?: number } = {}) {
    const url = `https://blob.test/${nama}`;
    await h.query(
        `INSERT INTO client_blob_uploads (blob_url, pathname, purpose, uploaded_by, status, expires_at, last_cleanup_error, cleanup_attempts, updated_at)
         VALUES ($1, $2, 'surat_masuk', $3, CASE WHEN $4 = 'claimed' THEN 'pending' ELSE $4 END, $5, $6, $7, $8)`,
        [url, nama, pengunggah.id, status, kedaluwarsa, tambahan.lastCleanupError ?? null, tambahan.cleanupAttempts ?? 0, tambahan.updatedAt ?? new Date()],
    );
    if (status === 'claimed') {
        await h.query("UPDATE client_blob_uploads SET status = 'claimed', claimed_at = now(), claimed_entity_type = 'surat_masuk', claimed_entity_id = gen_random_uuid() WHERE blob_url = $1", [url]);
    }
    return url;
}

const statusDari = async (url: string) =>
    (await h.query<{ status: string; last_cleanup_error: string | null }>('SELECT status, last_cleanup_error FROM client_blob_uploads WHERE blob_url = $1', [url]))[0];

describe.skipIf(!adaPostgres)('pembersihan unggahan langsung yang kedaluwarsa', () => {
    beforeAll(async () => {
        h = await createRangkaianTestDatabase('pembersihan');
        dbState.db = h.db;
        await h.seedUnits();
        pengunggah = await h.seedUser('staff', 'sesditjen');
    }, 120_000);
    afterAll(async () => { await h?.close(); });
    beforeEach(async () => {
        hapus.mockReset();
        await h.query('DELETE FROM client_blob_uploads');
    });

    it('menghapus unggahan kedaluwarsa dan melewati yang masih berlaku atau sudah dipakai', async () => {
        const sekarang = new Date();
        const lalu = new Date(sekarang.getTime() - 72 * JAM);
        const nanti = new Date(sekarang.getTime() + JAM);
        const menunggu = await unggahan('menunggu', 'pending', lalu);
        const diizinkan = await unggahan('diizinkan', 'authorized', lalu);
        const masihBerlaku = await unggahan('berlaku', 'pending', nanti);
        const dipakai = await unggahan('dipakai', 'claimed', lalu);
        hapus.mockResolvedValue(true);

        await expect(clientBlobUploadService.cleanupExpired(100, sekarang)).resolves.toEqual({ examined: 2, deleted: 2, failed: 0 });

        expect(hapus.mock.calls.map(([url]) => url).sort()).toEqual([diizinkan, menunggu].sort());
        expect((await statusDari(menunggu)).status).toBe('deleted');
        expect((await statusDari(diizinkan)).status).toBe('deleted');
        expect((await statusDari(masihBerlaku)).status).toBe('pending');
        expect((await statusDari(dipakai)).status).toBe('claimed');
    });

    it('menunda coba ulang setelah penghapusan gagal, lalu mencobanya lagi setelah masa tunggu', async () => {
        const sekarang = new Date();
        const lalu = new Date(sekarang.getTime() - 72 * JAM);
        const baruGagal = await unggahan('baru-gagal', 'pending', lalu, { lastCleanupError: 'gagal', cleanupAttempts: 1, updatedAt: new Date(sekarang.getTime() - 10_000) });
        const lamaGagal = await unggahan('lama-gagal', 'pending', lalu, { lastCleanupError: 'gagal', cleanupAttempts: 1, updatedAt: new Date(sekarang.getTime() - 2 * JAM) });
        const kini = await unggahan('kini-gagal', 'pending', lalu);
        hapus.mockImplementation(async (url) => url !== kini);

        await expect(clientBlobUploadService.cleanupExpired(100, sekarang)).resolves.toEqual({ examined: 2, deleted: 1, failed: 1 });

        expect((await statusDari(baruGagal)).status).toBe('pending');
        expect((await statusDari(lamaGagal)).status).toBe('deleted');
        expect(await statusDari(kini)).toEqual({ status: 'pending', last_cleanup_error: 'Object storage deletion failed; retry required.' });
    });
});
