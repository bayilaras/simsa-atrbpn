import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

export const letterId = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const distributionId = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export interface InboxFixtureLetter {
    n: number;
    sifatSurat: string | null;
    /** undefined → false; null meniru baris lama dengan is_deleted NULL. */
    isDeleted?: boolean | null;
    distributionStatus?: 'sent' | 'received' | 'processed' | 'rejected';
}

// Kolom persis seperti schema Drizzle yang dibaca findInbox/findOutbox dan
// notification.service (surat-distribution.ts, surat-masuk.ts, unit-kerja.ts).
const SCHEMA_SQL = `
CREATE TABLE unit_kerja (id varchar(50) PRIMARY KEY, name varchar(255) NOT NULL);
CREATE TABLE surat_masuk (
    id uuid PRIMARY KEY, unit_kerja_id varchar(50) NOT NULL, nomor_surat varchar(255), perihal text, dari text,
    tanggal_surat date, sifat_surat varchar(50), status varchar(50) DEFAULT 'belum_dibalas',
    is_archived boolean DEFAULT false, is_deleted boolean DEFAULT false,
    created_at timestamp NOT NULL DEFAULT now());
CREATE TABLE surat_distributions (
    id uuid PRIMARY KEY, surat_masuk_id uuid NOT NULL REFERENCES surat_masuk(id),
    source_unit_id varchar(50) NOT NULL, target_unit_id varchar(50) NOT NULL, cc_units text, instruction text,
    status varchar(20) NOT NULL DEFAULT 'sent', rejection_reason text,
    sent_at timestamp NOT NULL DEFAULT now(), received_at timestamp, processed_at timestamp,
    sent_by uuid, received_by uuid,
    created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now(),
    rangkaian_id uuid,
    batas_waktu date,
    penanggung_jawab boolean NOT NULL DEFAULT false,
    processed_by uuid,
    penyelesaian_surat_keluar_id uuid,
    catatan_penyelesaian text,
    ditutup_pengawas boolean NOT NULL DEFAULT false);
`;

export async function createInboxDatabase(letters: InboxFixtureLetter[]) {
    const client = new PGlite();
    await client.exec(SCHEMA_SQL);
    await client.exec(`INSERT INTO unit_kerja (id, name) VALUES ('ditjen', 'Direktorat Jenderal'), ('dir_bppt', 'Direktorat BPPT')`);
    for (const letter of letters) {
        await client.query(
            `INSERT INTO surat_masuk (id, unit_kerja_id, nomor_surat, perihal, dari, tanggal_surat, sifat_surat, is_deleted)
             VALUES ($1, 'ditjen', $2, $3, 'Instansi Uji', '2026-09-01', $4, $5)`,
            [
                letterId(letter.n),
                `SM-${letter.n}/2026`,
                `Perihal uji ${letter.n}`,
                letter.sifatSurat,
                letter.isDeleted === undefined ? false : letter.isDeleted,
            ],
        );
        await client.query(
            `INSERT INTO surat_distributions (id, surat_masuk_id, source_unit_id, target_unit_id, status)
             VALUES ($1, $2, 'ditjen', 'dir_bppt', $3)`,
            [distributionId(letter.n), letterId(letter.n), letter.distributionStatus ?? 'sent'],
        );
    }
    return { client, db: drizzle(client) };
}
