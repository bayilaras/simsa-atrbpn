import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { enterTestMigratorRole } from './helpers/database-role-fixture';
import { hashEvidenceSnapshot } from '../utils/evidence-hash';

const holder = vi.hoisted(() => ({ db: null as any }));
const storage = vi.hoisted(() => ({ downloadFile: vi.fn() }));
vi.mock('../config/database', () => ({ db: holder.db }));
vi.mock('../services/blob-storage.service', () => ({ blobStorageService: storage }));
let database: PGlite;
let record: typeof import('../services/preservation-activity.service').recordPreservationActivity;
const userId = '10000000-0000-4000-8000-000000000001';
const archiveId = '20000000-0000-4000-8000-000000000001';
const electronicId = '30000000-0000-4000-8000-000000000001';
const attachmentId = (n: number) => `40000000-0000-4000-8000-00000000000${n}`;
const bytes = Buffer.from('preservation evidence bytes');
const digest = createHash('sha256').update(bytes).digest('hex');
const input = { arsipElektronikId: electronicId, performedBy: userId, action: 'conversion',
    outputAttachmentId: attachmentId(2), evidenceAttachmentId: attachmentId(3),
    toolName: 'External archival tool', toolVersion: '1', activityAt: '2026-09-01T00:00:00Z' };
const submit = () => record(input, { userId });

beforeAll(async () => {
    database = new PGlite({ extensions: { pgcrypto } });
    await database.waitReady;
    await enterTestMigratorRole(database);
    const dir = fileURLToPath(new URL('../db/migrations/', import.meta.url));
    for (const file of readdirSync(dir).filter(file => /^\d{4}.*\.sql$/.test(file)
        && (Number(file.slice(0, 4)) <= 33 || /^003[57]_/.test(file))).sort()) {
        for (const sql of readFileSync(`${dir}/${file}`, 'utf8').split('--> statement-breakpoint').filter(sql => sql.trim())) await database.exec(sql);
    }
    holder.db = drizzle(database, { schema });
    ({ recordPreservationActivity: record } = await import('../services/preservation-activity.service'));
}, 45_000);
afterAll(async () => { await database?.close(); });
afterEach(() => vi.useRealTimers());
beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-11T00:00:00Z'));
    await database.exec(`TRUNCATE arsip, users, unit_kerja CASCADE;
        INSERT INTO unit_kerja(id,name) VALUES ('ditjen','Ditjen'),('sesditjen','Sesditjen');
        INSERT INTO users(id,email,role,unit_kerja_id) VALUES ('${userId}','preservation@example.test','admin_dirjen','ditjen');
        INSERT INTO arsip(id,unit_kerja_id,jenis_arsip,tahun,klasifikasi_keamanan) VALUES ('${archiveId}','ditjen','masuk',2026,'biasa');
        INSERT INTO file_attachments(id,entity_type,entity_id,file_name,file_url,sha256,size_bytes,storage_access,integrity_status,malware_scan_status,uploaded_by)
        SELECT id::uuid,'arsip','${archiveId}','evidence.pdf','https://test.private.blob.vercel-storage.com/' || id || '.pdf',
            '${digest}',${bytes.length},'private','verified','clean','${userId}'
        FROM unnest(ARRAY['${attachmentId(1)}','${attachmentId(2)}','${attachmentId(3)}']) AS id;
        INSERT INTO arsip_elektronik(id,arsip_id,file_attachment_id,format_file) VALUES ('${electronicId}','${archiveId}','${attachmentId(1)}','PDF');`);
    storage.downloadFile.mockReset();
    storage.downloadFile.mockImplementation(async () => ({ stream: Readable.from([bytes]) }));
});
async function grant() {
    await database.exec(`UPDATE arsip SET klasifikasi_keamanan='terbatas';
        INSERT INTO record_access_grants(requester_id,target_user_id,entity_type,entity_id,unit_kerja_id,required_classification,
          purpose,access_mode,status,decided_by,decided_at,decision_reason,expires_at)
        VALUES ('${userId}','${userId}','arsip','${archiveId}','ditjen','terbatas','Preservasi dengan bukti terkendali','manage','approved',
          '${userId}','2026-09-10T00:00:00Z','Disetujui untuk preservasi','2026-09-11T01:00:00Z');`);
}
async function expectNoRecord() {
    expect((await database.query('SELECT id FROM preservasi_track')).rows).toHaveLength(0);
    expect((await database.query("SELECT id FROM audit_log WHERE entity_type='arsip_elektronik'")).rows).toHaveLength(0);
}
describe('preservation transaction authorization and evidence', () => {
    it.each(['inactive', 'downgraded', 'other-unit'] as const)('rejects a stale caller after %s actor change before reading bytes', async state => {
        if (state === 'inactive') await database.exec('UPDATE users SET is_active=false');
        if (state === 'downgraded') await database.exec("UPDATE users SET role='staff'");
        if (state === 'other-unit') await database.exec("UPDATE users SET role='admin_sesditjen',unit_kerja_id='sesditjen'");
        await expect(submit()).rejects.toThrow(/aktif|izin|akses/i);
        expect(storage.downloadFile).not.toHaveBeenCalled();
        await expectNoRecord();
    });
    it.each(['revoked', 'view'] as const)('requires a current manage grant rather than a %s grant', async state => {
        await grant();
        await database.exec(state === 'revoked'
            ? `UPDATE record_access_grants SET status='revoked',revoked_by='${userId}',revoked_at=now(),revocation_reason='Akses dicabut oleh penanggung jawab'`
            : "UPDATE record_access_grants SET access_mode='view'");
        await expect(submit()).rejects.toThrow(/izin|akses/i);
        expect(storage.downloadFile).not.toHaveBeenCalled();
        await expectNoRecord();
    });
    it('refuses to commit when a locked grant expires while reading actual evidence bytes', async () => {
        await grant();
        storage.downloadFile.mockImplementation(async () => {
            vi.setSystemTime(new Date('2026-09-11T02:00:00Z'));
            return { stream: Readable.from([bytes]) };
        });
        await expect(submit()).rejects.toThrow(/izin|akses/i);
        expect(storage.downloadFile).toHaveBeenCalledTimes(3);
        await expectNoRecord();
    });
    it.each(['biasa', 'terbatas'])('records verified bytes for the current %s scope with a seal reproducible from stored JSONB', async classification => {
        if (classification === 'terbatas') await grant();
        const created = await submit();
        expect(created?.recordingMode).toBe('external_activity_recorded');
        expect(storage.downloadFile).toHaveBeenCalledTimes(3);
        const { rows: [stored] } = await database.query<any>('SELECT evidence_snapshot,evidence_snapshot_sha256 FROM preservasi_track');
        expect(stored.evidence_snapshot_sha256).toBe(hashEvidenceSnapshot(stored.evidence_snapshot));
        expect(stored.evidence_snapshot.checks.every((check: any) => check.actualHash === digest)).toBe(true);
        expect((await database.query("SELECT id FROM audit_log WHERE entity_type='arsip_elektronik'")).rows).toHaveLength(1);
    });
});
