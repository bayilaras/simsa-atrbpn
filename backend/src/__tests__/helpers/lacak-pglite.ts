// backend/src/__tests__/helpers/lacak-pglite.ts
import type { PGlite } from '@electric-sql/pglite';

// Boot rantai migrasi 0000–0047 memakai helper bersama P2 (satu sumber urutan migrasi uji).
export { bootRangkaianDatabase as createMigratedPglite } from './rangkaian-pglite.js';

export const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export type PenggunaUji = { id: string; email: string; name: string; role: string; unitKerjaId: string | null };
export type AnggotaUji = { jenis: 'surat_masuk' | 'surat_keluar'; id: string; peran?: 'induk' | 'anggota'; unit: string };

export async function resetRangkaianFixture(database: PGlite): Promise<void> {
    await database.exec(`TRUNCATE rangkaian_relasi, rangkaian_anggota, rangkaian_peserta, rangkaian_koreksi_berkas,
        surat_distributions, rangkaian_surat, record_access_grants, surat_keluar, surat_masuk, users CASCADE`);
}

export async function seedUnits(database: PGlite, units: Array<{ id: string; name: string; pengawas?: boolean }>): Promise<void> {
    for (const unit of units) {
        await database.query(
            `INSERT INTO unit_kerja (id, name, is_unit_pengawas) VALUES ($1, $2, $3)
             ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_unit_pengawas = EXCLUDED.is_unit_pengawas`,
            [unit.id, unit.name, unit.pengawas ?? false],
        );
    }
}

/** Baris DB memenuhi users_role_unit_mandate_check (0027); objek di memori tetap apa adanya (unit null menguji jalur mandat). */
const UNIT_MANDAT: Record<string, string> = { admin_sesditjen: 'sesditjen', admin_dirjen: 'ditjen' };

export async function insertUser(database: PGlite, user: PenggunaUji): Promise<PenggunaUji> {
    await database.query('INSERT INTO users (id, email, name, role, unit_kerja_id) VALUES ($1, $2, $3, $4, $5)',
        [user.id, user.email, user.name, user.role, UNIT_MANDAT[user.role] ?? user.unitKerjaId]);
    return user;
}

export async function insertSuratMasuk(database: PGlite, s: {
    n: number; unit?: string; nomor: string | null; tanggal: string; perihal?: string; dari?: string | null; sifat?: string;
}): Promise<string> {
    const id = uid(s.n);
    await database.query(
        `INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, nomor_surat, tanggal_surat, perihal, dari, sifat_surat)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, s.unit ?? 'dir_bppt', s.n, Number(s.tanggal.slice(0, 4)), s.nomor, s.tanggal,
            s.perihal ?? 'Undangan rapat', s.dari ?? null, s.sifat ?? 'Biasa'],
    );
    return id;
}

export async function insertSuratKeluar(database: PGlite, s: {
    n: number; unit?: string; nomor: string | null; tanggal: string; perihal?: string; kepada?: string | null;
    naskah?: string; klasifikasi?: string;
}): Promise<string> {
    const id = uid(s.n);
    await database.query(
        `INSERT INTO surat_keluar (id, unit_kerja_id, no_urut, tahun, naskah_dinas, nomor_surat, tanggal_surat, perihal,
             kepada, klasifikasi_keamanan, approval_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'approved')`,
        [id, s.unit ?? 'dir_bppt', s.n, Number(s.tanggal.slice(0, 4)), s.naskah ?? 'Nota Dinas', s.nomor, s.tanggal,
            s.perihal ?? 'Undangan rapat', s.kepada ?? null, s.klasifikasi ?? 'biasa'],
    );
    return id;
}

export async function insertRangkaian(database: PGlite, r: {
    n: number; kode: string; tahun: number; pencatat: string; judul: string; asal?: string; status?: string;
    pengolah?: string | null; digabungKe?: string | null; anggota: AnggotaUji[];
}): Promise<{ id: string; anggota: string[] }> {
    const id = uid(500_000 + r.n);
    const status = r.status ?? 'aktif';
    await database.query(
        `INSERT INTO rangkaian_surat (id, kode, asal, status, unit_pencatat_id, unit_pengolah_id, judul, tahun, digabung_ke_id, selesai_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [id, r.kode, r.asal ?? 'surat_masuk', status, r.pencatat, r.pengolah ?? null, r.judul, r.tahun,
            r.digabungKe ?? null, status === 'selesai' ? new Date().toISOString() : null],
    );
    const anggota: string[] = [];
    for (const [index, item] of r.anggota.entries()) {
        const anggotaId = uid(600_000 + r.n * 100 + index);
        await database.query(
            `INSERT INTO rangkaian_anggota (id, rangkaian_id, surat_masuk_id, surat_keluar_id, unit_kerja_id, peran)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [anggotaId, id, item.jenis === 'surat_masuk' ? item.id : null, item.jenis === 'surat_keluar' ? item.id : null,
                item.unit, item.peran ?? 'anggota'],
        );
        anggota.push(anggotaId);
    }
    return { id, anggota };
}

export async function insertRelasi(database: PGlite, r: { rangkaianId: string; dari: string; ke: string; jenis: string }): Promise<void> {
    await database.query(
        'INSERT INTO rangkaian_relasi (rangkaian_id, dari_anggota_id, ke_anggota_id, jenis_relasi) VALUES ($1, $2, $3, $4)',
        [r.rangkaianId, r.dari, r.ke, r.jenis],
    );
}

export async function insertDisposisi(database: PGlite, d: {
    suratMasukId: string; sumber: string; target: string; status: 'sent' | 'received' | 'rejected'; rangkaianId: string;
}): Promise<void> {
    await database.query(
        `INSERT INTO surat_distributions (surat_masuk_id, source_unit_id, target_unit_id, status, rangkaian_id, rejection_reason)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [d.suratMasukId, d.sumber, d.target, d.status, d.rangkaianId, d.status === 'rejected' ? 'Salah alamat disposisi' : null],
    );
}
