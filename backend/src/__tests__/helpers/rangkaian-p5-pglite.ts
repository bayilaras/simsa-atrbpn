// Helper PGlite P5: rantai migrasi journal penuh (termasuk 0048+) dan seed
// unit/pengguna/klasifikasi/berkas untuk test P5. Berbeda dari helper P2
// `rangkaian-pglite.ts`, yang memakai primitif journal di berkas ini.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { enterTestMigratorRole } from './database-role-fixture.js';

type JournalEntry = { idx: number; when: number; tag: string };

const migrationsDir = fileURLToPath(new URL('../../db/migrations/', import.meta.url));

export const journalEntries = (JSON.parse(
    readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
) as { entries: JournalEntry[] }).entries;

export async function applyMigrationTag(database: PGlite, tag: string): Promise<void> {
    const statements = readFileSync(join(migrationsDir, `${tag}.sql`), 'utf8')
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter(Boolean);
    for (const statement of statements) await database.exec(statement);
}

/** Minor 12: `stopBefore` yang salah ketik tidak boleh diam-diam menjalankan rantai penuh (sama dengan harness Postgres). */
export function assertStopBeforeDikenal(stopBefore: string | undefined): void {
    if (stopBefore !== undefined && !journalEntries.some((entry) => entry.tag === stopBefore)) {
        throw new Error(`stopBefore tidak dikenal di journal migrasi: ${stopBefore}`);
    }
}

/** Rantai migrasi lengkap (atau berhenti sebelum `stopBefore`) di PGlite terisolasi. */
export async function createRangkaianP5Database(options: { stopBefore?: string } = {}): Promise<PGlite> {
    assertStopBeforeDikenal(options.stopBefore);
    const database = new PGlite({ extensions: { pgcrypto } });
    await database.waitReady;
    await database.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await enterTestMigratorRole(database);
    for (const entry of journalEntries) {
        if (entry.tag === options.stopBefore) break;
        await applyMigrationTag(database, entry.tag);
    }
    return database;
}

export const P5_IDS = {
    superA: '00000000-0000-4000-8000-0000000005a1',
    superB: '00000000-0000-4000-8000-0000000005b2',
    tu: '00000000-0000-4000-8000-0000000005c3',
    bppt: '00000000-0000-4000-8000-0000000005d4',
    ruleSet: '00000000-0000-4000-8000-0000000005e5',
    berkas: '00000000-0000-4000-8000-000000000701',
    suratBerkas: '00000000-0000-4000-8000-000000000601',
} as const;

/** Unit ditjen/sesditjen/dir_*, empat pengguna, dan dua butir klasifikasi draf. */
export async function seedRangkaianBase(database: PGlite): Promise<{ klasA: number; klasB: number }> {
    const hash = 'a'.repeat(64);
    await database.exec(`
        INSERT INTO unit_kerja (id, name) VALUES
          ('ditjen', 'Direktorat Jenderal'), ('sesditjen', 'Sekretariat Direktorat Jenderal')
        ON CONFLICT (id) DO NOTHING;
        INSERT INTO unit_kerja (id, name, parent_id, unit_type, can_receive_distribution) VALUES
          ('dir_bppt', 'Dit. BPPT', 'ditjen', 'direktorat', true),
          ('dir_ptep', 'Dit. PTEP', 'ditjen', 'direktorat', true),
          ('dir_ktpp', 'Dit. KTPP', 'ditjen', 'direktorat', true),
          ('dir_plp', 'Dit. PLP', 'ditjen', 'direktorat', true)
        ON CONFLICT (id) DO NOTHING;
        UPDATE unit_kerja SET is_unit_pengawas = true WHERE id IN ('ditjen', 'sesditjen');
        INSERT INTO users (id, email, role, unit_kerja_id) VALUES
          ('${P5_IDS.superA}', 'super-a@example.test', 'super_admin', NULL),
          ('${P5_IDS.superB}', 'super-b@example.test', 'super_admin', NULL),
          ('${P5_IDS.tu}', 'tu@example.test', 'admin_unit', 'sesditjen'),
          ('${P5_IDS.bppt}', 'bppt@example.test', 'admin_unit', 'dir_bppt');
        INSERT INTO regulatory_rule_sets (
          id, instrument_type, version, name, legal_basis, regulation_number,
          status, effective_from, created_by, source_document_sha256,
          source_document_blob_url, source_document_mime_type,
          source_document_size_bytes, source_document_page_count,
          source_document_verified_at, source_document_verified_by,
          completeness_manifest_sha256, completeness_verified_at,
          impact_report_sha256, impact_report_generated_at, metadata
        ) VALUES (
          '${P5_IDS.ruleSet}', 'klasifikasi', 'p5-test', 'Edisi uji P5',
          'Regulasi uji', 'TEST/P5', 'draft', '2026-01-01', '${P5_IDS.superA}', '${hash}',
          'https://store.private.blob.vercel-storage.com/regulatory-sources/${P5_IDS.ruleSet}/source.pdf',
          'application/pdf', 1000, 1, now(), '${P5_IDS.superA}', '${hash}', now(),
          '${hash}', now(), '{"contentHash":"${hash}","contentItemCount":2}'::jsonb
        );
        INSERT INTO klasifikasi_arsip (rule_set_id, kode, source_record_key, jenis, tipe, content_hash) VALUES
          ('${P5_IDS.ruleSet}', 'KU.01', 'p5:kementerian:0001', 'Keuangan', 'fasilitatif', '${hash}'),
          ('${P5_IDS.ruleSet}', 'KU.02', 'p5:kementerian:0002', 'Keuangan', 'fasilitatif', '${hash}');
    `);
    const klas = (await database.query<{ id: number }>(
        `SELECT id FROM klasifikasi_arsip WHERE rule_set_id = '${P5_IDS.ruleSet}' ORDER BY kode`,
    )).rows;
    return { klasA: klas[0].id, klasB: klas[1].id };
}

/** Rangkaian TU → BPPT (+PTEP) yang sudah diberkaskan di dir_bppt dengan klasifikasi klasA. */
export async function seedBerkasDiberkaskan(
    database: PGlite,
    klasA: number,
): Promise<{ rangkaianId: string; suratMasukId: string }> {
    await database.exec(`
        INSERT INTO surat_masuk (id, unit_kerja_id, no_urut, tahun, nomor_surat, perihal, sifat_surat, klasifikasi_item_id)
        VALUES ('${P5_IDS.suratBerkas}', 'sesditjen', 9001, 2026, 'SM-P5/1/2026', 'Berkas uji koreksi', 'Biasa', ${klasA});
        INSERT INTO rangkaian_surat (id, kode, asal, status, unit_pencatat_id, unit_pengolah_id, judul, tahun, klasifikasi_item_id, selesai_at)
        VALUES ('${P5_IDS.berkas}', 'RS-2026-900001', 'surat_masuk', 'selesai', 'sesditjen', 'dir_bppt',
                'Berkas uji koreksi', 2026, ${klasA}, now());
        INSERT INTO rangkaian_anggota (rangkaian_id, surat_masuk_id, unit_kerja_id, peran)
        VALUES ('${P5_IDS.berkas}', '${P5_IDS.suratBerkas}', 'sesditjen', 'induk');
        INSERT INTO surat_distributions (surat_masuk_id, source_unit_id, target_unit_id, status, rangkaian_id, penanggung_jawab)
        VALUES ('${P5_IDS.suratBerkas}', 'sesditjen', 'dir_bppt', 'processed', '${P5_IDS.berkas}', true),
               ('${P5_IDS.suratBerkas}', 'sesditjen', 'dir_ptep', 'processed', '${P5_IDS.berkas}', false);
        UPDATE rangkaian_surat SET status = 'diberkaskan', diberkaskan_at = now(), diberkaskan_by = '${P5_IDS.superA}'
         WHERE id = '${P5_IDS.berkas}';
    `);
    return { rangkaianId: P5_IDS.berkas, suratMasukId: P5_IDS.suratBerkas };
}
