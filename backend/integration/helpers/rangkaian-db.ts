// Harness Postgres nyata (bukan `src/__tests__/helpers/rangkaian-pglite.ts`)
// karena suite P3 butuh FOR UPDATE lintas koneksi, `statement_timeout`, dan
// PG >= 16 — hal-hal yang PGlite (single-process, tanpa MVCC lintas koneksi
// nyata) tidak dapat mensimulasikan. [T2-4]
import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { loadMigrations, migrateDatabase } from '../../scripts/migrate-database.mjs';

export interface TestUser { id: string; email: string; name: string; role: string; unitKerjaId: string | null }

/**
 * Fail closed: hanya loopback ke database `simsa_test` yang boleh dipakai
 * sebagai target basis setiap database uji sekali pakai, sehingga kesalahan
 * konfigurasi tidak pernah bisa membuat/menghapus database di server lain.
 */
export function assertIsolatedTestTarget(raw = process.env.TEST_POSTGRES_URL): URL {
    const url = new URL(raw || 'http://invalid');
    const port = Number(url.port || '5432');
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)
        || url.pathname.slice(1) !== 'simsa_test'
        || !(port === 5432 || (port >= 40000 && port < 60000 && port !== 55432))) {
        throw new Error('Tes rangkaian memerlukan TEST_POSTGRES_URL loopback ke database simsa_test yang terisolasi.');
    }
    return url;
}

export async function createRangkaianTestDatabase(label: string, options: { stopBefore?: string } = {}) {
    if (!/^[a-z]{3,20}$/.test(label)) throw new Error('label harus 3-20 huruf kecil');
    const url = assertIsolatedTestTarget();
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const databaseName = `simsa_rs_${label}_${suffix}`;
    const target = new URL(url);
    target.pathname = `/${databaseName}`;
    const administrator = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000 });
    await administrator.connect();
    await administrator.query(`CREATE DATABASE ${databaseName} TEMPLATE template0`);
    const pool = new Pool({ connectionString: target.toString(), max: 6, connectionTimeoutMillis: 5000, statement_timeout: 15000 });
    const connection = await pool.connect();
    try {
        await connection.query(`DO $$ DECLARE role_name text; BEGIN
            FOREACH role_name IN ARRAY ARRAY['simsa_api_runtime','simsa_event_runtime','simsa_worker_runtime',
              'simsa_final_cleanup','simsa_maintenance','simsa_migrator','simsa_backup_reader'] LOOP
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
                    EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT', role_name);
                END IF;
            END LOOP;
        END $$;
        CREATE EXTENSION pgcrypto;
        CREATE EXTENSION pg_trgm;
        ALTER SCHEMA public OWNER TO simsa_migrator;
        CREATE SCHEMA drizzle AUTHORIZATION simsa_migrator;
        SET ROLE simsa_migrator;`);
        const semua = loadMigrations();
        const batas = options.stopBefore ? semua.findIndex((migration: { tag: string }) => migration.tag === options.stopBefore) : -1;
        if (options.stopBefore && batas < 0) throw new Error(`Migrasi ${options.stopBefore} tidak ada di journal`);
        await migrateDatabase(connection, batas >= 0 ? semua.slice(0, batas) : semua);
        await connection.query('RESET ROLE');
    } finally {
        connection.release();
    }
    const db = drizzle(pool);

    async function query<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
        return (await pool.query(text, params)).rows as T[];
    }

    async function seedUnits() {
        // Label 'Dit. ...' sengaja menimpa nama resmi yang diisi migrasi 0047
        // (`0047_unit_kerja_direktorat.sql:12-18`, mis. 'Direktorat BPPT') lewat
        // ON CONFLICT DO UPDATE di bawah ini; asersi label di Task 7/9 (kotak
        // disposisi, penyelesaian) bergantung pada label singkat ini. [T2-6]
        await query(`INSERT INTO unit_kerja (id, name, unit_type, can_receive_distribution, is_unit_pengawas) VALUES
            ('ditjen', 'Direktorat Jenderal PTPP', 'ditjen', true, true),
            ('sesditjen', 'Sekretariat Direktorat Jenderal', 'sesditjen', true, true)
            ON CONFLICT (id) DO UPDATE SET is_unit_pengawas = true`);
        await query(`INSERT INTO unit_kerja (id, name, parent_id, unit_type, can_receive_distribution) VALUES
            ('dir_bppt', 'Dit. BPPT', 'ditjen', 'direktorat', true),
            ('dir_ptep', 'Dit. PTEP', 'ditjen', 'direktorat', true),
            ('dir_ktpp', 'Dit. KTPP', 'ditjen', 'direktorat', true),
            ('dir_plp', 'Dit. PLP', 'ditjen', 'direktorat', true),
            ('bagian_umum', 'Bagian Umum', 'sesditjen', 'bagian', true)
            ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, unit_type = EXCLUDED.unit_type,
                can_receive_distribution = EXCLUDED.can_receive_distribution`);
    }

    async function seedUser(role: string, unitKerjaId: string | null): Promise<TestUser> {
        const id = randomUUID();
        const user = { id, email: `${role}-${id.slice(0, 8)}@example.test`, name: `Uji ${role}`, role, unitKerjaId };
        await query('INSERT INTO users (id, email, name, role, unit_kerja_id, is_active) VALUES ($1,$2,$3,$4,$5,true)',
            [user.id, user.email, user.name, role, unitKerjaId]);
        return user;
    }

    async function insertSuratMasuk(input: { unitKerjaId: string; nomorSurat: string; perihal?: string | null; sifatSurat?: string; tahun?: number; dari?: string; createdBy?: string | null }) {
        const tahun = input.tahun ?? 2026;
        // $1::varchar di kedua pemakaian: VALUES menyimpulkan varchar(50)
        // (unit_kerja_id), sedangkan `unit_kerja_id = $1` tanpa cast
        // menyimpulkan text lewat operator text=text — Postgres menolak
        // parameter yang sama dengan dua tipe berbeda (42P08). [F2]
        const [row] = await query<{ id: string }>(`INSERT INTO surat_masuk (unit_kerja_id, no_urut, tahun, nomor_surat, perihal, dari, sifat_surat, tanggal_surat, created_by)
            VALUES ($1::varchar, (SELECT coalesce(max(no_urut), 0) + 1 FROM surat_masuk WHERE unit_kerja_id = $1::varchar AND tahun = $2), $2, $3, $4, $5, $6, make_date($2, 9, 12), $7)
            RETURNING id`, [input.unitKerjaId, tahun, input.nomorSurat, input.perihal === undefined ? 'Perihal uji' : input.perihal,
            input.dari ?? 'Kantah Sintetis', input.sifatSurat ?? 'biasa', input.createdBy ?? null]);
        return row.id;
    }

    async function insertSuratKeluar(input: { unitKerjaId: string; nomorSurat: string; perihal?: string; naskahDinas?: string; approvalStatus?: string; klasifikasiKeamanan?: string; tahun?: number; asalNaskah?: string | null; kepada?: string }) {
        const tahun = input.tahun ?? 2026;
        // $1::varchar di kedua pemakaian: lihat catatan pada insertSuratMasuk
        // di atas — 42P08 yang sama terjadi di surat_keluar.unit_kerja_id
        // (juga varchar(50)). [F2]
        const [row] = await query<{ id: string }>(`INSERT INTO surat_keluar (unit_kerja_id, no_urut, tahun, nomor_surat, perihal, kepada, naskah_dinas, approval_status, klasifikasi_keamanan, tanggal_surat, asal_naskah)
            VALUES ($1::varchar, (SELECT coalesce(max(no_urut), 0) + 1 FROM surat_keluar WHERE unit_kerja_id = $1::varchar AND tahun = $2), $2, $3, $4, $5, $6, $7, $8, make_date($2, 9, 12), $9)
            RETURNING id`, [input.unitKerjaId, tahun, input.nomorSurat, input.perihal ?? 'Perihal keluar uji', input.kepada ?? 'Pihak Sintetis',
            input.naskahDinas ?? 'Nota Dinas', input.approvalStatus ?? 'draft', input.klasifikasiKeamanan ?? 'biasa', input.asalNaskah ?? null]);
        return row.id;
    }

    async function insertDistribusi(input: { suratMasukId: string; sourceUnitId: string; targetUnitId: string; status?: string; rangkaianId?: string | null; batasWaktu?: string | null }) {
        // Sejak 0048 rangkaian_id NOT NULL: gagal keras di sini, bukan 23502 di tengah test.
        // Hanya skenario data lama (database dibuat dengan stopBefore) boleh menyisipkan NULL. [P5-C-4]
        if (input.rangkaianId == null && !options.stopBefore) {
            throw new Error('rangkaianId wajib setelah 0048; buat database dengan stopBefore untuk skenario lama');
        }
        const [row] = await query<{ id: string }>(`INSERT INTO surat_distributions (surat_masuk_id, source_unit_id, target_unit_id, status, rangkaian_id, batas_waktu)
            VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [input.suratMasukId, input.sourceUnitId, input.targetUnitId,
            input.status ?? 'sent', input.rangkaianId ?? null, input.batasWaktu ?? null]);
        return row.id;
    }

    async function ensureKlasifikasi(): Promise<number> {
        const [existing] = await query<{ id: number }>('SELECT id FROM klasifikasi_arsip WHERE is_active ORDER BY id LIMIT 1');
        if (existing) return existing.id;
        const [created] = await query<{ id: number }>(`INSERT INTO klasifikasi_arsip (kode, source_record_key, jenis, tipe)
            VALUES ('PT.01', 'uji-rangkaian-pt01', 'Uji pemberkasan rangkaian', 'substantif') RETURNING id`);
        return created.id;
    }

    async function close() {
        await pool.end();
        if (/^simsa_rs_[a-z]{3,20}_[a-f0-9]{12}$/.test(databaseName)) {
            await administrator.query(`DROP DATABASE ${databaseName}`);
        }
        await administrator.end();
    }

    return { pool, db, databaseName, query, seedUnits, seedUser, insertSuratMasuk, insertSuratKeluar, insertDistribusi, ensureKlasifikasi, close };
}

export type RangkaianTestDatabase = Awaited<ReturnType<typeof createRangkaianTestDatabase>>;
