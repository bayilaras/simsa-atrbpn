import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const gateSql = readFileSync(new URL('../db/deployment-regulatory-evidence.sql', import.meta.url), 'utf8');
let database: PGlite;
const classificationId = '11111111-1111-4111-8111-111111111111';
const retentionId = '22222222-2222-4222-8222-222222222222';

beforeAll(async () => {
    database = new PGlite();
    await database.exec(`
        CREATE TABLE regulatory_rule_sets (
            id uuid, instrument_type text, status text, effective_from date,
            source_document_sha256 text, source_document_blob_url text,
            source_document_object_generation text, source_document_mime_type text,
            source_document_size_bytes integer, source_document_page_count integer,
            source_document_verified_by uuid, source_document_verified_at timestamptz,
            completeness_manifest jsonb, completeness_manifest_sha256 text,
            completeness_verified_by uuid, completeness_verified_at timestamptz,
            impact_report jsonb, impact_report_sha256 text,
            impact_report_generated_by uuid, impact_report_generated_at timestamptz,
            created_by uuid, submitted_by uuid, submitted_at timestamptz,
            reviewed_by uuid, reviewed_at timestamptz, approved_by uuid, approved_at timestamptz,
            published_by uuid, published_at timestamptz, metadata jsonb
        );
        CREATE TABLE regulatory_rule_events (rule_set_id uuid, action text, actor_id uuid);
        CREATE TABLE klasifikasi_arsip (rule_set_id uuid, is_active boolean, is_selectable boolean);
        CREATE TABLE jadwal_retensi_arsip (rule_set_id uuid, is_active boolean, is_selectable boolean);
    `);
});
beforeEach(async () => {
    await database.exec('TRUNCATE regulatory_rule_sets, regulatory_rule_events, klasifikasi_arsip, jadwal_retensi_arsip');
    for (const [id, type, table] of [[classificationId, 'klasifikasi', 'klasifikasi_arsip'], [retentionId, 'jra', 'jadwal_retensi_arsip']]) {
        await database.query(`INSERT INTO regulatory_rule_sets VALUES (
            $1::uuid, $2, 'active', '2020-01-01', repeat('a',64),
            'gs://private-evidence/regulatory-sources/' || $1::uuid::text || '/source.pdf', '1234',
            'application/pdf', 1000, 1,
            '00000000-0000-4000-8000-000000000001', now(), '{}', repeat('b',64),
            '00000000-0000-4000-8000-000000000001', now(), jsonb_build_object('candidateContentHash', repeat('d',64)), repeat('c',64),
            '00000000-0000-4000-8000-000000000001', now(),
            '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', now(),
            '00000000-0000-4000-8000-000000000002', now(),
            '00000000-0000-4000-8000-000000000003', now(),
            '00000000-0000-4000-8000-000000000004', now(), jsonb_build_object('contentHash', repeat('d',64))
        )`, [id, type]);
        await database.query(`INSERT INTO ${table} VALUES ($1, true, true)`, [id]);
        await database.query("INSERT INTO regulatory_rule_events VALUES ($1, 'activate', '00000000-0000-4000-8000-000000000004')", [id]);
    }
});
afterAll(async () => { await database.close(); });

describe('deployed regulatory database evidence gate', () => {
    it('converges only missing canonical units without overwriting administrator settings', async () => {
        await database.exec(`CREATE TABLE unit_kerja (id text PRIMARY KEY, name text, description text);
            INSERT INTO unit_kerja VALUES ('ditjen', 'Administrator maintained name', 'custom description')`);
        const unitSql = readFileSync(new URL('../db/deployment-unit-seed.sql', import.meta.url), 'utf8');
        await database.exec(unitSql);
        await database.exec(unitSql);
        expect((await database.query('SELECT id, name FROM unit_kerja ORDER BY id')).rows).toEqual([
            { id: 'ditjen', name: 'Administrator maintained name' },
            { id: 'sesditjen', name: 'Sekretariat Direktorat Jenderal' },
        ]);
    });
    it('accepts governed replacement editions without requiring baseline IDs or optional mappings', async () => {
        await expect(database.exec(gateSql)).resolves.toBeDefined();
        await expect(database.exec(gateSql)).resolves.toBeDefined();
        expect((await database.query('SELECT count(*) AS count FROM regulatory_rule_sets')).rows).toEqual([{ count: 2 }]);
    });

    it.each([
        "status = 'draft'", "source_document_blob_url = NULL", "source_document_verified_by = NULL",
        "source_document_verified_at = NULL", "source_document_size_bytes = 0",
        "source_document_object_generation = NULL", "completeness_verified_by = NULL",
        "impact_report_sha256 = NULL", "submitted_at = NULL", "reviewed_by = submitted_by",
        "approved_by = reviewed_by", "published_by = NULL", "effective_from = '9999-01-01'",
        "source_document_blob_url = 'https://public.example.test/source.pdf'",
        "source_document_blob_url = 'gs://private-evidence/regulatory-sources/11111111-1111-4111-8111-111111111111/source.pdf'",
        "impact_report = '{}'",
    ])('rejects incomplete or ungoverned evidence: %s', async (mutation) => {
        await database.exec(`UPDATE regulatory_rule_sets SET ${mutation} WHERE instrument_type = 'jra'`);
        await expect(database.exec(gateSql)).rejects.toThrow(/GOVERNANCE_REQUIRED/);
    });

    it('rejects actor-less bootstrap audit even if an active row claims approval', async () => {
        await database.exec("UPDATE regulatory_rule_events SET action = 'bootstrap_activate', actor_id = NULL");
        await expect(database.exec(gateSql)).rejects.toThrow(/GOVERNANCE_REQUIRED/);
    });

    it('rejects empty active catalogs and ambiguous active editions', async () => {
        await database.exec('DELETE FROM jadwal_retensi_arsip');
        await expect(database.exec(gateSql)).rejects.toThrow(/GOVERNANCE_REQUIRED/);
        await database.exec(`INSERT INTO jadwal_retensi_arsip VALUES ('${retentionId}', true, true);
            INSERT INTO regulatory_rule_sets SELECT * FROM regulatory_rule_sets WHERE instrument_type = 'jra'`);
        await expect(database.exec(gateSql)).rejects.toThrow(/GOVERNANCE_REQUIRED/);
    });
});
