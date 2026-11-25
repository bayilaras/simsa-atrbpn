// backend/src/__tests__/tandai-surat-impor.test.ts
// Skrip operator backend/scripts/tandai-surat-impor.mjs di atas PGlite (rantai migrasi penuh):
// deteksi gelombang impor, dry-run tanpa tulis, --apply bergerbang SHA-256, audit per surat,
// dan surat anggota rangkaian tidak pernah disentuh.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { siapkanSesi } from '../../scripts/backfill-rangkaian-lama.mjs';
import { ACTOR, BAWAAN, applyPlan, buildPlan, cetakRencana, parseArgs, parameterRencana } from '../../scripts/tandai-surat-impor.mjs';
import { createRangkaianP5Database, P5_IDS, seedRangkaianBase } from './helpers/rangkaian-p5-pglite.js';

let database: PGlite;

const K = (n: number) => `00000000-0000-4000-8000-0000000071${String(n).padStart(2, '0')}`;
const M = (n: number) => `00000000-0000-4000-8000-0000000072${String(n).padStart(2, '0')}`;
const RANGKAIAN = '00000000-0000-4000-8000-000000007301';

/** Waktu pembuatan: `menit` setelah 2026-10-20 03:00 UTC, ditambah `detik`. */
const waktu = (menit: number, detik = 0) => new Date(Date.UTC(2026, 9, 20, 3, menit, detik)).toISOString().replace('T', ' ').replace('Z', '');

async function suratKeluar(n: number, unit: string, pembuat: string | null, dibuat: string, extra = '') {
    await database.query(
        `INSERT INTO surat_keluar (id, unit_kerja_id, no_urut, tahun, naskah_dinas, nomor_surat, tanggal_surat, perihal, kepada, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, 2024, 'Nota Dinas', $4, '2024-03-01', $5, 'Kantah A', $6, $7::timestamp, $7::timestamp)`,
        [K(n), unit, n, `ND-${n}/2024`, `Register keluar ${n}`, pembuat, dibuat]);
    if (extra) await database.exec(`UPDATE surat_keluar SET ${extra} WHERE id = '${K(n)}'`);
}
async function suratMasuk(n: number, unit: string, pembuat: string | null, dibuat: string) {
    await database.query(
        `INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, nomor_surat, tanggal_surat, perihal, dari, sifat_surat, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, 2024, $4, '2024-03-02', $5, 'Kantah B', 'Biasa', $6, $7::timestamp, $7::timestamp)`,
        [M(n), unit, n, `SM-${n}/2024`, `Register masuk ${n}`, pembuat, dibuat]);
}
const ditandai = async (tabel: 'surat_masuk' | 'surat_keluar') => (await database.query<{ id: string }>(
    `SELECT id::text AS id FROM ${tabel} WHERE diimpor_at IS NOT NULL ORDER BY id`)).rows.map(row => row.id);
const jumlahAudit = async () => (await database.query<{ n: number }>('SELECT count(*)::int AS n FROM audit_log')).rows[0].n;

beforeAll(async () => {
    database = await createRangkaianP5Database();
    await seedRangkaianBase(database);
    expect(await siapkanSesi(database)).toBe('UTC');
}, 180_000);
afterAll(async () => { await database?.close(); });

beforeEach(async () => {
    await database.exec(`TRUNCATE rangkaian_relasi, rangkaian_anggota, rangkaian_peserta, surat_distributions, rangkaian_surat,
        surat_keluar, surat_masuk CASCADE; TRUNCATE audit_log`);
    // Gelombang A: 6 surat keluar Sesditjen oleh admin TU, berjarak 3 detik.
    for (let i = 0; i < 6; i += 1) await suratKeluar(1 + i, 'sesditjen', P5_IDS.tu, waktu(0, i * 3));
    //   K3 sudah menjadi anggota rangkaian (ditandai inisiatif) → tidak pernah disentuh.
    await database.exec(`
        INSERT INTO rangkaian_surat (id, kode, asal, status, unit_pencatat_id, unit_pengolah_id, judul, tahun)
        VALUES ('${RANGKAIAN}', 'RS-2026-007301', 'inisiatif', 'aktif', 'sesditjen', 'sesditjen', 'Register keluar 3', 2024);
        INSERT INTO rangkaian_anggota (rangkaian_id, surat_keluar_id, unit_kerja_id, peran) VALUES ('${RANGKAIAN}', '${K(3)}', 'sesditjen', 'induk');
    `);
    //   K5 sudah bertanda (impor setelah 0055), K6 terhapus.
    await database.exec(`UPDATE surat_keluar SET diimpor_at = created_at::timestamptz WHERE id = '${K(5)}';
        UPDATE surat_keluar SET is_deleted = true WHERE id = '${K(6)}';`);
    // Pencatatan formulir admin TU: berjarak 10 menit → bukan gelombang.
    for (let i = 0; i < 3; i += 1) await suratKeluar(11 + i, 'sesditjen', P5_IDS.tu, waktu(30 + i * 10));
    // Gelombang kecil BPPT: 3 surat keluar berjarak 2 detik (di bawah ambang bawaan 5).
    for (let i = 0; i < 3; i += 1) await suratKeluar(21 + i, 'dir_bppt', P5_IDS.bppt, waktu(90, i * 2));
    // Gelombang B: 5 surat masuk BPPT berjarak 1 detik.
    for (let i = 0; i < 5; i += 1) await suratMasuk(1 + i, 'dir_bppt', P5_IDS.bppt, waktu(120, i));
    // Tanpa pembuat: tidak dapat dikelompokkan, diabaikan.
    for (let i = 0; i < 6; i += 1) await suratKeluar(31 + i, 'dir_bppt', null, waktu(150, i));
});

describe('parseArgs', () => {
    it('bawaan dry-run dengan ambang eksplisit', () => {
        expect(parseArgs([])).toEqual({
            apply: false, approvedSha256: null, jenis: ['masuk', 'keluar'], unit: null, pengguna: null, sejak: null, sampai: null,
            jedaDetik: BAWAAN.jedaDetik, minimalBaris: BAWAAN.minimalBaris, contoh: BAWAAN.contoh,
        });
        expect(parseArgs(['--jenis=keluar', '--unit=sesditjen', `--pengguna=${P5_IDS.tu.toUpperCase()}`, '--sejak=2026-10-20T10:00:00+07:00',
            '--sampai=2026-10-21T00:00:00+07:00', '--jeda-detik=10', '--minimal-baris=3', '--contoh=0'])).toMatchObject({
            jenis: ['keluar'], unit: 'sesditjen', pengguna: P5_IDS.tu, sejak: '2026-10-20T03:00:00.000Z', sampai: '2026-10-20T17:00:00.000Z',
            jedaDetik: 10, minimalBaris: 3, contoh: 0,
        });
        expect(parseArgs(['--jenis=semua']).jenis).toEqual(['masuk', 'keluar']);
    });

    it('menolak argumen yang salah dan --apply tanpa SHA-256 dry-run', () => {
        for (const [argumen, pola] of [
            [['--force'], /Argumen tidak dikenal/], [['--jenis=arsip'], /--jenis/], [['--unit='], /--unit/], [['--pengguna=tu'], /UUID/],
            [['--sejak=2026-10-20'], /zona waktu/], [['--jeda-detik=0'], /antara/], [['--jeda-detik=1.5'], /bilangan bulat/],
            [['--minimal-baris=1'], /antara/], [['--contoh=51'], /antara/],
            [['--sejak=2026-10-21T00:00:00Z', '--sampai=2026-10-20T00:00:00Z'], /sebelum/],
            [['--apply'], /--approved-sha256/], [['--apply', '--approved-sha256=abc'], /--approved-sha256/],
            [[`--approved-sha256=${'a'.repeat(64)}`], /hanya bersama --apply/],
        ] as Array<[string[], RegExp]>) expect(() => parseArgs(argumen), argumen.join(' ')).toThrow(pola);
        expect(parseArgs(['--apply', `--approved-sha256=${'A'.repeat(64)}`])).toMatchObject({ apply: true, approvedSha256: 'a'.repeat(64) });
    });
});

describe('buildPlan (dry-run)', () => {
    it('mengenali gelombang, melewati anggota rangkaian dan baris bertanda, dan tidak menulis apa pun', async () => {
        const rencana = await buildPlan(database, parseArgs([]));
        expect(rencana.parameter).toEqual({ jenis: ['keluar', 'masuk'], unit: null, pengguna: null, sejak: null, sampai: null, jedaDetik: 30, minimalBaris: 5 });
        expect(rencana.perUnit).toEqual([
            { jenis: 'keluar', unit: 'sesditjen', gelombang: 1, baris: 6, sudahDitandai: 1, anggotaRangkaian: 1, akanDitandai: 4 },
            { jenis: 'masuk', unit: 'dir_bppt', gelombang: 1, baris: 5, sudahDitandai: 0, anggotaRangkaian: 0, akanDitandai: 5 },
        ]);
        expect(rencana.total).toEqual({ gelombang: 2, baris: 11, sudahDitandai: 1, anggotaRangkaian: 1, akanDitandai: 9 });
        // Surat terhapus ikut ditandai (bila dipulihkan tidak membanjiri daftar kerja); K3 dan K5 tidak.
        expect(rencana.kandidat).toEqual({ keluar: [K(1), K(2), K(4), K(6)], masuk: [M(1), M(2), M(3), M(4), M(5)] });
        const keluar = rencana.gelombang.find((g: any) => g.jenis === 'keluar');
        expect(keluar).toMatchObject({
            unit: 'sesditjen', pembuat: P5_IDS.tu, pembuatEmail: 'tu@example.test', mulai: '2026-10-20T03:00:00Z', selesai: '2026-10-20T03:00:15Z', terhapus: 1,
        });
        expect(keluar.contoh).toHaveLength(4);
        expect(keluar.contoh[0]).toMatchObject({ id: K(1), nomorSurat: 'ND-1/2024', perihal: 'Register keluar 1', pihak: 'Kantah A', tanggalSurat: '2024-03-01' });
        expect(rencana.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect((await buildPlan(database, parseArgs([]))).sha256).toBe(rencana.sha256);
        // --contoh hanya tampilan: tidak mengubah SHA-256.
        const tanpaContoh = await buildPlan(database, parseArgs(['--contoh=0']));
        expect(tanpaContoh.sha256).toBe(rencana.sha256);
        expect(tanpaContoh.gelombang.every((g: any) => g.contoh.length === 0)).toBe(true);

        expect(await ditandai('surat_keluar')).toEqual([K(5)]);
        expect(await ditandai('surat_masuk')).toEqual([]);
        expect(await jumlahAudit()).toBe(0);

        const baris: string[] = [];
        cetakRencana(rencana, (teks: string) => baris.push(teks));
        const keluaran = baris.join('\n');
        expect(keluaran).toContain('surat keluar sesditjen: gelombang 1, baris 6, akan ditandai 4, sudah bertanda 1, anggota rangkaian dilewati 1');
        expect(keluaran).toContain('contoh: dibuat 2026-10-20T03:00:00.000000Z | tgl surat 2024-03-01 | ND-1/2024 | Register keluar 1 | Kantah A');
        expect(keluaran).toContain(`SHA-256 rencana: ${rencana.sha256}`);
    });

    it('ambang adalah argumen: gelombang kecil hanya masuk bila --minimal-baris diturunkan; --jeda-detik memecah gelombang', async () => {
        const longgar = await buildPlan(database, parseArgs(['--jenis=keluar', '--minimal-baris=3']));
        expect(longgar.perUnit.map((u: any) => [u.unit, u.akanDitandai])).toEqual([['dir_bppt', 3], ['sesditjen', 4]]);
        expect(longgar.kandidat.keluar).toEqual([K(1), K(2), K(4), K(6), K(21), K(22), K(23)]);
        // Jarak 3 detik > 2 detik: gelombang A terpecah menjadi baris tunggal; gelombang 2 detik bertahan.
        const ketat = await buildPlan(database, parseArgs(['--jenis=keluar', '--minimal-baris=3', '--jeda-detik=2']));
        expect(ketat.kandidat.keluar).toEqual([K(21), K(22), K(23)]);
        // Pencatatan formulir berjarak 10 menit tidak pernah menjadi gelombang pada ambang wajar.
        const lebar = await buildPlan(database, parseArgs(['--jenis=keluar', '--minimal-baris=2', '--jeda-detik=300']));
        expect(lebar.kandidat.keluar).not.toEqual(expect.arrayContaining([K(11), K(12), K(13)]));
        expect(longgar.sha256).not.toBe(ketat.sha256);
    });

    it('saringan unit, pengguna, jenis, dan rentang waktu mempersempit rencana', async () => {
        expect((await buildPlan(database, parseArgs(['--unit=dir_bppt']))).kandidat).toEqual({ keluar: [], masuk: [M(1), M(2), M(3), M(4), M(5)] });
        expect((await buildPlan(database, parseArgs([`--pengguna=${P5_IDS.tu}`]))).kandidat).toEqual({ keluar: [K(1), K(2), K(4), K(6)], masuk: [] });
        expect((await buildPlan(database, parseArgs(['--jenis=masuk']))).kandidat).toEqual({ keluar: [], masuk: [M(1), M(2), M(3), M(4), M(5)] });
        // Rentang hanya memuat gelombang surat masuk (05:00 UTC).
        const rentang = await buildPlan(database, parseArgs(['--sejak=2026-10-20T04:55:00Z', '--sampai=2026-10-20T05:05:00Z']));
        expect(rentang.total).toMatchObject({ gelombang: 1, akanDitandai: 5 });
        // Rentang yang memotong gelombang A menyisakan 3 baris: di bawah ambang.
        const terpotong = await buildPlan(database, parseArgs(['--jenis=keluar', '--sampai=2026-10-20T03:00:07Z']));
        expect(terpotong.total.akanDitandai).toBe(0);
    });
});

describe('applyPlan', () => {
    it('menolak SHA-256 yang tidak cocok tanpa menulis apa pun', async () => {
        await expect(applyPlan(database, { ...parseArgs([]), approvedSha256: 'f'.repeat(64) })).rejects.toThrow(/Rencana berubah sejak dry-run/);
        await expect(applyPlan(database, parseArgs([]))).rejects.toThrow(/approvedSha256/);
        expect(await ditandai('surat_keluar')).toEqual([K(5)]);
        expect(await jumlahAudit()).toBe(0);
    });

    it('menandai kandidat dengan waktu pembuatannya, mengaudit tiap surat, dan tidak menyentuh anggota rangkaian', async () => {
        const opsi = parseArgs([]);
        const rencana = await buildPlan(database, opsi);
        const sebelum = (await database.query<{ id: string; updated_at: string }>(
            'SELECT id::text AS id, updated_at::text AS updated_at FROM surat_keluar ORDER BY id')).rows;

        expect(await applyPlan(database, { ...opsi, approvedSha256: rencana.sha256 }))
            .toEqual({ ditandai: { masuk: 5, keluar: 4 }, dilewati: { masuk: 0, keluar: 0 } });
        expect(await ditandai('surat_keluar')).toEqual([K(1), K(2), K(4), K(5), K(6)]);
        expect(await ditandai('surat_masuk')).toEqual([M(1), M(2), M(3), M(4), M(5)]);
        const beda = (await database.query<{ n: number }>(`SELECT count(*)::int AS n FROM surat_keluar
            WHERE diimpor_at IS NOT NULL AND diimpor_at <> created_at::timestamptz`)).rows[0].n;
        expect(beda).toBe(0);
        // updated_at tidak disentuh (formulir sunting yang terbuka tidak dibatalkan).
        expect((await database.query('SELECT id::text AS id, updated_at::text AS updated_at FROM surat_keluar ORDER BY id')).rows).toEqual(sebelum);

        const jejak = (await database.query<{ user_email: string; action: string; entity_type: string; entity_id: string; changes: any }>(
            'SELECT user_email, action, entity_type, entity_id::text AS entity_id, changes FROM audit_log ORDER BY entity_type, entity_id')).rows;
        expect(jejak).toHaveLength(9);
        expect(jejak.every(row => row.user_email === ACTOR && row.action === 'update')).toBe(true);
        expect(jejak.filter(row => row.entity_type === 'surat_keluar').map(row => row.entity_id)).toEqual([K(1), K(2), K(4), K(6)]);
        expect(jejak[0].changes).toMatchObject({
            sumber: 'tandai_surat_impor', before: { diimporAt: null },
            rencana: { sha256: rencana.sha256, parameter: parameterRencana(opsi) },
        });
        expect(Date.parse(jejak[0].changes.after.diimporAt)).toBe(Date.UTC(2026, 9, 20, 3, 0, 0));

        // Idempoten: rencana berikutnya kosong; SHA lama tidak lagi berlaku.
        const ulang = await buildPlan(database, opsi);
        expect(ulang.total).toMatchObject({ akanDitandai: 0, sudahDitandai: 10, anggotaRangkaian: 1 });
        await expect(applyPlan(database, { ...opsi, approvedSha256: rencana.sha256 })).rejects.toThrow(/Rencana berubah/);
        expect(await jumlahAudit()).toBe(9);
    });

    it('surat yang menjadi anggota rangkaian di antara rencana dan tulis dilewati', async () => {
        const opsi = parseArgs(['--jenis=keluar']);
        const rencana = await buildPlan(database, opsi);
        let disisipkan = false;
        const klien = {
            query: async (teks: string, parameter?: unknown[]) => {
                // Transaksi tulis pertama (BEGIN polos) dimulai setelah snapshot rencana selesai.
                if (teks === 'BEGIN' && !disisipkan) {
                    disisipkan = true;
                    await database.exec(`INSERT INTO rangkaian_anggota (rangkaian_id, surat_keluar_id, unit_kerja_id, peran)
                        VALUES ('${RANGKAIAN}', '${K(2)}', 'sesditjen', 'anggota')`);
                }
                return database.query(teks, parameter as any[]);
            },
        };
        expect(await applyPlan(klien, { ...opsi, approvedSha256: rencana.sha256 }))
            .toEqual({ ditandai: { masuk: 0, keluar: 3 }, dilewati: { masuk: 0, keluar: 1 } });
        expect(disisipkan).toBe(true);
        expect(await ditandai('surat_keluar')).toEqual([K(1), K(4), K(5), K(6)]);
        expect(await jumlahAudit()).toBe(3);
    });
});
