import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { enterTestMigratorRole } from './helpers/database-role-fixture';
import { isFileReleased } from '../services/file-release-policy';

const holder = vi.hoisted(() => ({ db: null as any }));
const storage = vi.hoisted(() => ({ downloadFile: vi.fn() }));
vi.mock('../config/database', () => ({ db: holder.db }));
vi.mock('../services/blob-storage.service', () => ({ blobStorageService: storage }));

let database: PGlite;
let migratedLegacy: any;
let service: typeof import('../services/terjaga-report.service').terjagaReportService;
let designations: typeof import('../services/arsip-terjaga.service').arsipTerjagaService;
const actor = (n: number) => ({ id: `10000000-0000-4000-8000-00000000000${n}`, email: `user${n}@example.test`, role: 'super_admin' });
const archiveId = '20000000-0000-4000-8000-000000000001';
const designationId = '30000000-0000-4000-8000-000000000001';
const attachmentId = (n: number) => `40000000-0000-4000-8000-00000000000${n}`;
const bytes = Buffer.from('controlled reporting evidence');
const digest = createHash('sha256').update(bytes).digest('hex');
const draft = () => service.createDraft(designationId, { nomorLaporan: 'LAP/2026/001', tanggalPelaporan: '2026-09-01' }, actor(1));
const advance = (reportId: string, action: 'send' | 'receive', user = actor(1), n = action === 'send' ? 1 : 2) => service.transition(designationId, reportId, {
    action, attachmentId: attachmentId(n), occurredOn: '2026-09-02', notes: 'Bukti pelaporan telah dicatat sesuai dokumen.',
}, user);
const createManageGrant = () => database.exec(`UPDATE arsip SET klasifikasi_keamanan='rahasia';
    INSERT INTO record_access_grants(requester_id,target_user_id,entity_type,entity_id,unit_kerja_id,required_classification,
        purpose,access_mode,status,decided_by,decided_at,decision_reason,expires_at)
    VALUES ('${actor(1).id}','${actor(1).id}','arsip','${archiveId}','ditjen','rahasia','Pemeriksaan bukti pelaporan terkendali','manage','approved',
        '${actor(2).id}','2026-09-10T00:00:00Z','Akses untuk pelaporan terjaga','2026-09-11T01:00:00Z');`);

beforeAll(async () => {
    database = new PGlite({ extensions: { pgcrypto } });
    await database.waitReady;
    await enterTestMigratorRole(database);
    const dir = fileURLToPath(new URL('../db/migrations/', import.meta.url));
    for (const file of readdirSync(dir).filter(file => /^\d{4}.*\.sql$/.test(file) && (Number(file.slice(0, 4)) <= 33 || file.startsWith('0036_'))).sort()) {
        if (file.startsWith('0036_')) {
            await database.exec(`INSERT INTO unit_kerja(id,name) VALUES ('legacy-unit','Legacy');
                INSERT INTO arsip(id,unit_kerja_id,jenis_arsip,tahun) VALUES ('${archiveId}','legacy-unit','masuk',2020);
                INSERT INTO arsip_terjaga(id,arsip_id,unit_kerja_id,kategori_terjaga,status_pelaporan,status_kepatuhan,nomor_laporan_anri,tanggal_pelaporan)
                VALUES ('${designationId}','${archiveId}','legacy-unit','pertanahan','terverifikasi','patuh','LAP-OLD','2020-01-01');`);
        }
        for (const sql of readFileSync(`${dir}/${file}`, 'utf8').split('--> statement-breakpoint').filter(sql => sql.trim())) await database.exec(sql);
    }
    migratedLegacy = (await database.query('SELECT status_pelaporan,status_kepatuhan,legacy_reporting FROM arsip_terjaga')).rows[0];
    holder.db = drizzle(database, { schema });
    ({ terjagaReportService: service } = await import('../services/terjaga-report.service'));
    ({ arsipTerjagaService: designations } = await import('../services/arsip-terjaga.service'));
}, 45_000);
afterAll(async () => { await database?.close(); });
beforeEach(async () => {
    await database.exec(`TRUNCATE arsip, users, unit_kerja CASCADE;
        INSERT INTO unit_kerja(id,name) VALUES ('ditjen','Ditjen');
        INSERT INTO users(id,email,role) VALUES
          ('${actor(1).id}','${actor(1).email}','super_admin'),
          ('${actor(2).id}','${actor(2).email}','super_admin'),
          ('${actor(3).id}','${actor(3).email}','super_admin');
        INSERT INTO arsip(id,unit_kerja_id,jenis_arsip,tahun,klasifikasi_keamanan) VALUES ('${archiveId}','ditjen','masuk',2026,'biasa');
        INSERT INTO arsip_terjaga(id,arsip_id,unit_kerja_id,kategori_terjaga,created_by) VALUES ('${designationId}','${archiveId}','ditjen','pertanahan','${actor(1).id}');
        INSERT INTO file_attachments(id,entity_type,entity_id,file_name,file_url,sha256,storage_access,integrity_status,malware_scan_status,uploaded_by) VALUES
        ('${attachmentId(1)}','arsip','${archiveId}','pengiriman.pdf','https://test.private.blob.vercel-storage.com/send.pdf','${digest}','private','verified','clean','${actor(1).id}'),
        ('${attachmentId(2)}','arsip','${archiveId}','penerimaan.pdf','https://test.private.blob.vercel-storage.com/receive.pdf','${digest}','private','verified','clean','${actor(1).id}');
        UPDATE file_attachments SET size_bytes=${bytes.length};`);
    vi.clearAllMocks();
    storage.downloadFile.mockImplementation(async () => ({ stream: Readable.from([bytes]) }));
});

describe('controlled terjaga reporting', () => {
    it('preserves legacy assertions without grandfathering compliance or external verification', () => {
        expect(migratedLegacy).toMatchObject({ status_pelaporan: 'dicatat', status_kepatuhan: 'belum_dinilai', legacy_reporting: {
            statusPelaporan: 'terverifikasi', statusKepatuhan: 'patuh', nomorLaporanANRI: 'LAP-OLD', tanggalPelaporan: '2020-01-01',
        } });
    });
    it('records number/date only as draft, never as compliance', async () => {
        const report = await draft();
        expect(report.status).toBe('draft');
        const { rows } = await database.query<any>('SELECT status_pelaporan,status_kepatuhan FROM arsip_terjaga');
        expect(rows[0]).toEqual({ status_pelaporan: 'dicatat', status_kepatuhan: 'belum_dinilai' });
    });
    it('accepts the current Jakarta calendar date after local midnight', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-09-11T18:00:00Z'));
        try {
            const report = await draft();
            const sent = await service.transition(designationId, report.id, {
                action: 'send', attachmentId: attachmentId(1), occurredOn: '2026-09-12', notes: 'Pengiriman pada pukul satu WIB.',
            }, actor(1));
            expect(sent.status).toBe('sent');
            expect(sent.sentOn).toBe('2026-09-12');
        } finally { vi.useRealTimers(); }
    });
    it('requires evidence, valid order and independent verification, retaining history between cycles', async () => {
        const report = await draft();
        await expect(service.transition(designationId, report.id, { action: 'verify', notes: 'Pemeriksaan bukti dilakukan.' }, actor(2))).rejects.toThrow(/diterima/i);
        await advance(report.id, 'send');
        await advance(report.id, 'receive');
        await expect(service.transition(designationId, report.id, { action: 'verify', notes: 'Pemeriksaan bukti dilakukan.' }, actor(1))).rejects.toThrow(/independen|sendiri/i);
        const verified = await service.transition(designationId, report.id, { action: 'verify', notes: 'Dua bukti diperiksa dan sesuai.' }, actor(2));
        expect(verified.status).toBe('verified');
        expect(verified.sentEvidence.sha256).toBe(digest);
        expect(verified.verifiedBy).toBe(actor(2).id);
        await expect(service.transition(designationId, report.id, { action: 'cancel', notes: 'Pembatalan setelah verifikasi.' }, actor(1))).rejects.toThrow(/final|terverifikasi/i);
        await draft();
        expect((await service.list(designationId, actor(1))).reports).toHaveLength(2);
        expect((await database.query<any>('SELECT status_kepatuhan FROM arsip_terjaga')).rows[0].status_kepatuhan).toBe('belum_dinilai');
    });
    it.each(['public', 'quarantined', 'foreign', 'missing'])('rejects %s evidence without advancing or writing audit', async condition => {
        const report = await draft();
        if (condition === 'public') await database.exec(`UPDATE file_attachments SET storage_access='public'`);
        if (condition === 'quarantined') await database.exec(`UPDATE file_attachments SET malware_scan_status='pending'`);
        if (condition === 'foreign') await database.exec(`UPDATE file_attachments SET entity_id='20000000-0000-4000-8000-000000000002'`);
        if (condition === 'missing') storage.downloadFile.mockResolvedValue(null);
        await expect(advance(report.id, 'send')).rejects.toThrow();
        const { rows } = await database.query<any>('SELECT status,sent_evidence FROM arsip_terjaga_reports');
        expect(rows[0]).toEqual({ status: 'draft', sent_evidence: null });
        expect((await database.query<any>('SELECT count(*)::int AS n FROM audit_log')).rows[0].n).toBe(1);
    });
    it('rejects revoked actor and cross-record report IDs', async () => {
        const report = await draft();
        await database.exec(`UPDATE users SET is_active=false WHERE id='${actor(1).id}'`);
        await expect(advance(report.id, 'send')).rejects.toThrow(/aktif|akses/i);
        await expect(service.list('30000000-0000-4000-8000-000000000002', actor(2))).rejects.toThrow(/ditemukan/i);
    });
    it('uses live unit authority and requires a manage grant even for a super administrator', async () => {
        await database.exec(`UPDATE arsip SET klasifikasi_keamanan='rahasia'`);
        await expect(draft()).rejects.toThrow(/akses|ditemukan/i);
        await database.exec(`UPDATE arsip SET klasifikasi_keamanan='biasa';
            INSERT INTO unit_kerja(id,name) VALUES ('unit-other','Unit lain');
            UPDATE users SET role='staff',unit_kerja_id='unit-other' WHERE id='${actor(1).id}';`);
        await expect(draft()).rejects.toThrow(/akses|ditemukan/i);
    });
    it('re-reads bytes at final verification and rejects an uploader as verifier', async () => {
        const report = await draft();
        await database.exec(`UPDATE file_attachments SET uploaded_by='${actor(2).id}'`);
        await advance(report.id, 'send');
        await advance(report.id, 'receive');
        // The recorded uploader is a contributor even if another user recorded the report steps.
        // This uploader was recorded before the document became reporting evidence.
        await expect(service.transition(designationId, report.id, { action: 'verify', notes: 'Bukti telah diperiksa lengkap.' }, actor(2))).rejects.toThrow(/independen|sendiri/i);
        storage.downloadFile.mockResolvedValue({ stream: Readable.from([Buffer.from('changed')]) });
        await expect(service.transition(designationId, report.id, { action: 'verify', notes: 'Bukti telah diperiksa lengkap.' }, actor(3))).rejects.toThrow(/integritas|hash|bukti/i);
    });
    it('database preserves evidence and rejects final edits/deletion', async () => {
        const report = await draft();
        await advance(report.id, 'send'); await advance(report.id, 'receive');
        await service.transition(designationId, report.id, { action: 'verify', notes: 'Bukti telah diperiksa lengkap.' }, actor(2));
        await expect(database.exec(`UPDATE arsip_terjaga_reports SET nomor_laporan='changed' WHERE id='${report.id}'`)).rejects.toThrow();
        await expect(database.exec(`DELETE FROM arsip_terjaga_reports WHERE id='${report.id}'`)).rejects.toThrow();
    });
    it('rolls back the report transition and parent state if the critical audit cannot be stored', async () => {
        const report = await draft();
        await database.exec(`CREATE FUNCTION reject_reporting_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$;
            CREATE TRIGGER reject_reporting_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_reporting_audit();`);
        try {
            await expect(advance(report.id, 'send')).rejects.toMatchObject({ cause: expect.objectContaining({ message: 'audit unavailable' }) });
            expect((await database.query<any>('SELECT status FROM arsip_terjaga_reports')).rows[0].status).toBe('draft');
            expect((await database.query<any>('SELECT status_pelaporan FROM arsip_terjaga')).rows[0].status_pelaporan).toBe('dicatat');
        } finally {
            await database.exec('DROP TRIGGER reject_reporting_audit ON audit_log; DROP FUNCTION reject_reporting_audit();');
        }
    });
    it('does not turn a deadline assessment into compliance when a report is verified', async () => {
        await database.exec(`UPDATE arsip_terjaga SET status_kepatuhan='terlambat'`);
        const report = await draft();
        await advance(report.id, 'send'); await advance(report.id, 'receive');
        await service.transition(designationId, report.id, { action: 'verify', notes: 'Bukti telah diperiksa lengkap.' }, actor(2));
        expect((await database.query<any>('SELECT status_kepatuhan FROM arsip_terjaga')).rows[0].status_kepatuhan).toBe('terlambat');
    });
    it.each(['sent_on', 'received_on', 'verification_notes', 'cancellation_notes'])('database rejects incomplete %s evidence even without application validation', async field => {
        const report = await draft();
        const snapshot = JSON.stringify({ attachmentId: attachmentId(1), sha256: digest, uploadedBy: actor(1).id });
        if (field === 'sent_on') {
            await expect(database.query(`UPDATE arsip_terjaga_reports SET status='sent', sent_attachment_id=$1, sent_evidence=$2, sent_by=$3,
                sent_at=now(), sent_notes='Pengiriman tercatat lengkap', sent_on=NULL WHERE id=$4`, [attachmentId(1), snapshot, actor(1).id, report.id])).rejects.toThrow();
        } else if (field === 'received_on') {
            await advance(report.id, 'send');
            await expect(database.query(`UPDATE arsip_terjaga_reports SET status='received', received_attachment_id=$1, received_evidence=$2, received_by=$3,
                received_at=now(), received_notes='Penerimaan tercatat lengkap', received_on=NULL WHERE id=$4`, [attachmentId(1), snapshot, actor(1).id, report.id])).rejects.toThrow();
        } else if (field === 'verification_notes') {
            await advance(report.id, 'send'); await advance(report.id, 'receive');
            await expect(database.query(`UPDATE arsip_terjaga_reports SET status='verified', verified_by=$1, verified_at=now(), verification_notes=NULL WHERE id=$2`, [actor(2).id, report.id])).rejects.toThrow();
        } else {
            await expect(database.query(`UPDATE arsip_terjaga_reports SET status='cancelled', cancelled_by=$1, cancelled_at=now(), cancellation_notes=NULL WHERE id=$2`, [actor(1).id, report.id])).rejects.toThrow();
        }
    });
    it('does not grant API runtime DELETE on reporting evidence', async () => {
        const { rows } = await database.query<any>("SELECT has_table_privilege('simsa_api_runtime','arsip_terjaga_reports','DELETE') AS allowed");
        expect(rows[0].allowed).toBe(false);
    });
    it('keeps referenced attachment identity immutable while allowing integrity quarantine', async () => {
        const report = await draft();
        await advance(report.id, 'send');
        for (const [column, value] of [
            ['file_url', 'https://test.private.blob.vercel-storage.com/replacement.pdf'],
            ['sha256', 'a'.repeat(64)], ['entity_id', actor(3).id], ['file_name', 'replacement.pdf'],
        ]) {
            await expect(database.query(`UPDATE file_attachments SET ${column}=$1 WHERE id=$2`, [value, attachmentId(1)])).rejects.toThrow(/immutable/i);
        }
        await expect(database.query(`UPDATE file_attachments SET integrity_status='mismatch' WHERE id=$1`, [attachmentId(1)])).resolves.toBeDefined();
    });
    it('allows authorized designation CRUD and attributes creation to the current actor', async () => {
        const audit = { userId: actor(1).id, userEmail: actor(1).email };
        const created = await designations.create({ arsipId: archiveId, unitKerjaId: 'ditjen', kategoriTerjaga: 'kepulauan', createdBy: actor(3).id }, audit);
        expect(created.createdBy).toBe(actor(1).id);
        expect(created.statusKepatuhan).toBe('belum_dinilai');
        await expect(designations.update(created.id, { catatan: 'Catatan diperbarui' }, 'ditjen', audit)).resolves.toMatchObject({ catatan: 'Catatan diperbarui' });
        await expect(designations.update(created.id, { catatan: 'Lingkup salah' }, 'other-unit', audit)).rejects.toThrow();
        await expect(designations.delete(created.id, null, audit)).resolves.toMatchObject({ id: created.id });
        expect((await database.query('SELECT id FROM arsip_terjaga WHERE id=$1', [created.id])).rows).toHaveLength(0);
        expect((await database.query("SELECT action FROM audit_log WHERE changes->>'designationId'=$1", [created.id])).rows.map((row: any) => row.action).sort()).toEqual(['create', 'delete', 'update']);
    });
    it.each(['no_grant', 'held', 'proposed', 'revoked'])('denies designation metadata/removal and creation when %s', async restriction => {
        if (restriction === 'no_grant') await database.exec("UPDATE arsip SET klasifikasi_keamanan='rahasia'");
        if (restriction === 'held') await database.exec("UPDATE arsip SET legal_hold=true,legal_hold_reason='Pemeriksaan arsip masih berlangsung',legal_hold_placed_at=now()");
        if (restriction === 'proposed') await database.exec("UPDATE arsip SET disposal_status='proposed_musnah'");
        if (restriction === 'revoked') await database.exec("UPDATE users SET is_active=false");
        const audit = { userId: actor(1).id, userEmail: actor(1).email };
        await expect(designations.update(designationId, { dasarHukum: 'Changed without authority' }, null, audit)).rejects.toThrow();
        await expect(designations.delete(designationId, null, audit)).rejects.toThrow();
        await expect(designations.create({ arsipId: archiveId, unitKerjaId: 'ditjen', kategoriTerjaga: 'kepulauan', createdBy: actor(1).id }, audit)).rejects.toThrow();
        expect((await database.query<any>('SELECT dasar_hukum FROM arsip_terjaga')).rows).toEqual([{ dasar_hukum: null }]);
    });
    it('rechecks same-unit staff downgrade for designation CRUD, report drafting and UI permissions', async () => {
        await database.exec(`UPDATE users SET role='staff',unit_kerja_id='ditjen' WHERE id='${actor(1).id}'`);
        const audit = { userId: actor(1).id, userEmail: actor(1).email };
        await expect(designations.update(designationId, { catatan: 'Stale elevated role' }, null, audit)).rejects.toThrow(/akses|izin/i);
        await expect(designations.delete(designationId, null, audit)).rejects.toThrow(/akses|izin/i);
        await expect(designations.create({ arsipId: archiveId, unitKerjaId: 'ditjen', kategoriTerjaga: 'kepulauan' }, audit)).rejects.toThrow(/akses|izin/i);
        await expect(draft()).rejects.toThrow(/akses|izin/i);
        expect((await service.list(designationId, actor(1))).canManage).toBe(false);
        expect((await database.query('SELECT id FROM audit_log')).rows).toHaveLength(0);
    });
    it('denies report transitions when the current actor becomes read-only in the same unit', async () => {
        const report = await draft();
        await database.exec(`UPDATE users SET role='staff',unit_kerja_id='ditjen' WHERE id='${actor(1).id}'`);
        await expect(advance(report.id, 'send')).rejects.toThrow(/akses|izin/i);
        expect(storage.downloadFile).not.toHaveBeenCalled();
        expect((await database.query<any>('SELECT status FROM arsip_terjaga_reports')).rows[0].status).toBe('draft');
    });
    it.each(['send', 'receive', 'verify'] as const)('retains mismatch quarantine and rejection audit without advancing %s', async action => {
        const report = await draft();
        if (action !== 'send') await advance(report.id, 'send');
        if (action === 'verify') await advance(report.id, 'receive');
        storage.downloadFile.mockImplementation(async () => ({ stream: Readable.from([Buffer.from('changed')]) }));
        const attempt = action === 'verify' ? service.transition(designationId, report.id,
            { action, notes: 'Pemeriksaan independen bitstream.' }, actor(2)) : advance(report.id, action);
        await expect(attempt).rejects.toThrow(/integritas|hash|bukti/i);
        const beforeStatus = action === 'send' ? 'draft' : action === 'receive' ? 'sent' : 'received';
        expect((await database.query<any>('SELECT status FROM arsip_terjaga_reports')).rows[0].status).toBe(beforeStatus);
        const target = action === 'receive' ? attachmentId(2) : attachmentId(1);
        const [attachment] = await holder.db.select().from(schema.fileAttachments).where(eq(schema.fileAttachments.id, target));
        expect(attachment.integrityStatus).toBe('mismatch');
        expect(isFileReleased(attachment)).toBe(false);
        expect((await database.query<any>("SELECT changes FROM audit_log WHERE changes->>'operation'='terjaga_evidence_rejected'")).rows[0].changes)
            .toMatchObject({ reportId: report.id, reportAction: action, attachmentId: target, expectedHash: digest });
    });
    it('rolls back mismatch quarantine when its required rejection audit cannot be stored', async () => {
        const report = await draft();
        storage.downloadFile.mockImplementation(async () => ({ stream: Readable.from([Buffer.from('changed')]) }));
        await database.exec(`CREATE FUNCTION reject_failure_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$;
            CREATE TRIGGER reject_failure_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_failure_audit();`);
        try {
            await expect(advance(report.id, 'send')).rejects.toMatchObject({ cause: expect.objectContaining({ message: 'audit unavailable' }) });
            expect((await database.query<any>('SELECT integrity_status FROM file_attachments WHERE id=$1', [attachmentId(1)])).rows[0].integrity_status).toBe('verified');
            expect((await database.query<any>('SELECT status FROM arsip_terjaga_reports')).rows[0].status).toBe('draft');
        } finally { await database.exec('DROP TRIGGER reject_failure_audit ON audit_log; DROP FUNCTION reject_failure_audit();'); }
    });
    it.each(['matching', 'mismatch'])('does not commit %s bytes after the grant expires during storage I/O', async result => {
        const report = await draft();
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-09-11T00:00:00Z'));
        try {
            await createManageGrant();
            storage.downloadFile.mockImplementation(async () => {
                vi.setSystemTime(new Date('2026-09-11T02:00:00Z'));
                return { stream: Readable.from([result === 'matching' ? bytes : Buffer.from('changed')]) };
            });
            await expect(advance(report.id, 'send')).rejects.toThrow(/akses|izin/i);
            expect((await database.query<any>('SELECT integrity_status FROM file_attachments WHERE id=$1', [attachmentId(1)])).rows[0].integrity_status).toBe('verified');
            expect((await database.query<any>('SELECT status FROM arsip_terjaga_reports')).rows[0].status).toBe('draft');
            expect((await database.query('SELECT id FROM audit_log')).rows).toHaveLength(1);
        } finally { vi.useRealTimers(); }
    });
    it('rejects a revoked grant before reading bytes or persisting a rejection', async () => {
        const report = await draft();
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-09-11T00:00:00Z'));
        try {
            await createManageGrant();
            await database.exec(`UPDATE record_access_grants SET status='revoked',revoked_by='${actor(2).id}',
                revoked_at=now(),revocation_reason='Akses ditarik oleh penanggung jawab'`);
            await expect(advance(report.id, 'send')).rejects.toThrow(/akses|izin/i);
            expect(storage.downloadFile).not.toHaveBeenCalled();
            expect((await database.query('SELECT id FROM audit_log')).rows).toHaveLength(1);
        } finally { vi.useRealTimers(); }
    });
});
