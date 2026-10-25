import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import {
    ANGGOTA, DISPOSISI, GRANT, PENGGUNA, RANGKAIAN, SURAT, USER_ID,
    bootRangkaianDatabase, seedRangkaianFixture,
} from './helpers/rangkaian-pglite';

// Versi PGlite dari matriks integration/ajukan-akses.postgres.test.ts agar SQL
// Task 6 (isGrantEligible, requestViaRangkaian, disposisiGrantService) benar-
// benar dieksekusi tanpa TEST_POSTGRES_URL. Suite Postgres tetap acuan CI.

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ get db() { return holder.db; } }));

let database: PGlite;
let grants: typeof import('../services/record-access-grant.service');
let eligibility: typeof import('../services/rangkaian/grant-eligibility');
let disposisi: typeof import('../services/rangkaian/disposisi-grant.service');
let access: typeof import('../services/record-access.service');

const audit = (userId: string) => ({ userId, userEmail: 'uji@example.test' });
const purpose = { purpose: 'Menindaklanjuti disposisi TU atas surat ini', accessMode: 'view' as const };
const besok = () => new Date(Date.now() + 24 * 3600_000);

async function cabutGrantFixture(id: string) {
    await database.exec(`UPDATE record_access_grants SET status = 'revoked', revoked_by = '${USER_ID.approver}', revoked_at = now(),
        revocation_reason = 'Dicabut untuk skenario uji' WHERE id = '${id}'`);
}

beforeAll(async () => {
    database = await bootRangkaianDatabase();
    holder.db = drizzle(database, { schema });
    grants = await import('../services/record-access-grant.service');
    eligibility = await import('../services/rangkaian/grant-eligibility');
    disposisi = await import('../services/rangkaian/disposisi-grant.service');
    access = await import('../services/record-access.service');
}, 60_000);
afterAll(async () => { await database?.close(); });
beforeEach(async () => { await seedRangkaianFixture(database); });
afterEach(() => { delete process.env.RANGKAIAN_DISPOSISI_LAMA_READ; });

describe('isGrantEligible', () => {
    it('paritas dengan jalurJangkauan checkRead untuk seluruh matriks fixture (T6-3, C-2)', async () => {
        const refs = (await database.query<{ type: 'surat_masuk' | 'surat_keluar'; id: string; unit: string }>(`
            SELECT 'surat_masuk' AS type, id::text, unit_kerja_id AS unit FROM surat_masuk WHERE is_deleted IS NOT TRUE
            UNION ALL SELECT 'surat_keluar', id::text, unit_kerja_id FROM surat_keluar WHERE is_deleted IS NOT TRUE`)).rows;
        expect(refs.length).toBe(Object.keys(SURAT).length);
        let lintasUnitLayak = 0;
        for (const user of Object.values(PENGGUNA)) for (const r of refs) {
            const ref = { type: r.type, id: r.id, unitKerjaId: r.unit };
            const eligible = await eligibility.isGrantEligible(holder.db, user, ref);
            if (access.isAllowedForRecordUnit(user, ref.unitKerjaId)) { expect(eligible).toBe(true); continue; }
            const { via } = await access.recordAccessService.checkRead(user, ref.type, ref.id, holder.db);
            expect({ user: user.id, ref: ref.id, eligible }).toEqual({ user: user.id, ref: ref.id, eligible: via === 'pengawas' || via === 'peserta' });
            if (eligible) lintasUnitLayak += 1;
        }
        // Matriks harus benar-benar memuat jalur lintas unit, bukan hanya pemilik.
        expect(lintasUnitLayak).toBeGreaterThan(0);
    });
});

describe('requestViaRangkaian', () => {
    it('peserta lintas unit mengajukan grant pending terikat unit rekaman dan diaudit via rangkaian', async () => {
        await cabutGrantFixture(GRANT.ptepSmTerbatas);
        const grant = await grants.recordAccessGrantService.requestViaRangkaian(PENGGUNA.ptep, ANGGOTA.rs2Sm, purpose, audit(USER_ID.ptep));
        expect(grant).toMatchObject({
            status: 'pending', entityType: 'surat_masuk', entityId: SURAT.smTerbatas, unitKerjaId: 'sesditjen',
            requiredClassification: 'terbatas', targetUserId: USER_ID.ptep, requesterId: USER_ID.ptep, accessMode: 'view',
        });
        const log = (await database.query<{ via: string; anggota: string }>(
            `SELECT changes->>'via' AS via, changes->>'anggotaId' AS anggota FROM audit_log
              WHERE action = 'request_access' AND entity_id = '${grant.id}'`)).rows;
        expect(log).toEqual([{ via: 'rangkaian', anggota: ANGGOTA.rs2Sm }]);
        await expect(grants.recordAccessGrantService.requestViaRangkaian(PENGGUNA.ptep, ANGGOTA.rs2Sm, purpose, audit(USER_ID.ptep)))
            .rejects.toMatchObject({ statusCode: 409 });

        const disetujui = await grants.recordAccessGrantService.approve(grant.id, USER_ID.approver, 'Disetujui untuk tindak lanjut', besok(), audit(USER_ID.approver));
        expect(disetujui.status).toBe('approved');
        expect(await access.recordAccessService.checkRead(PENGGUNA.ptep, 'surat_masuk', SURAT.smTerbatas)).toMatchObject({ allowed: true, mutable: false, via: 'peserta' });
    });

    it('404 untuk non-peserta (walau memegang grant), anggota tak dikenal, dan surat terhapus', async () => {
        await expect(grants.recordAccessGrantService.requestViaRangkaian(PENGGUNA.bppt, ANGGOTA.rs2Sm, purpose, audit(USER_ID.bppt)))
            .rejects.toMatchObject({ statusCode: 404 });
        await expect(grants.recordAccessGrantService.requestViaRangkaian(PENGGUNA.tu, '51000000-0000-4000-8000-0000000000ff', purpose, audit(USER_ID.tu)))
            .rejects.toMatchObject({ statusCode: 404 });
        await database.exec(`UPDATE surat_masuk SET is_deleted = true WHERE id = '${SURAT.smTerbatas}'`);
        await expect(grants.recordAccessGrantService.requestViaRangkaian(PENGGUNA.tu, ANGGOTA.rs2Sm, purpose, audit(USER_ID.tu)))
            .rejects.toMatchObject({ statusCode: 404 });
    });

    it('node kelas biasa ditolak 409', async () => {
        await expect(grants.recordAccessGrantService.requestViaRangkaian(PENGGUNA.tu, ANGGOTA.rs2SkPtep, purpose, audit(USER_ID.tu)))
            .rejects.toMatchObject({ statusCode: 409 });
    });

    it('persetujuan ditolak 409 setelah disposisi ke unit pemohon ditolak (re-check isGrantEligible)', async () => {
        // PLP hanya terjangkau lewat disposisi ini (PTEP tetap terjangkau karena menulis anggota rs2).
        const disposisiPlp = '52000000-0000-4000-8000-0000000000aa';
        await database.exec(`INSERT INTO surat_distributions (id, surat_masuk_id, source_unit_id, target_unit_id, status, rangkaian_id)
            VALUES ('${disposisiPlp}', '${SURAT.smTerbatas}', 'sesditjen', 'dir_uji', 'sent', '${RANGKAIAN.rs2}')`);
        const grant = await grants.recordAccessGrantService.requestViaRangkaian(PENGGUNA.plp, ANGGOTA.rs2Sm, purpose, audit(USER_ID.plp));
        await database.exec(`UPDATE surat_distributions SET status = 'rejected', rejection_reason = 'Bukan tugas unit ini' WHERE id = '${disposisiPlp}'`);
        await expect(grants.recordAccessGrantService.approve(grant.id, USER_ID.approver, 'Disetujui untuk tindak lanjut', besok(), audit(USER_ID.approver)))
            .rejects.toMatchObject({ statusCode: 409 });
        await expect(grants.recordAccessGrantService.requestViaRangkaian(PENGGUNA.plp, ANGGOTA.rs2Sm, purpose, audit(USER_ID.plp)))
            .rejects.toMatchObject({ statusCode: 404 });
    });
});

describe('disposisiGrantService', () => {
    const input = () => ({
        distribusiId: DISPOSISI.rs2Ptep, suratMasukId: SURAT.smTerbatas, suratUnitKerjaId: 'sesditjen', classification: 'terbatas',
        targetUnitId: 'dir_ptep', requesterId: USER_ID.tu, rangkaianKode: 'RS-2026-000002',
    });

    it('ajukan melewati admin yang sudah memegang grant aktif lalu membuat grant view bertujuan disposisi', async () => {
        expect(await holder.db.transaction((tx: any) => disposisi.disposisiGrantService.ajukan(tx, input(), audit(USER_ID.tu)))).toEqual([]);
        await cabutGrantFixture(GRANT.ptepSmTerbatas);
        const dibuat = await holder.db.transaction((tx: any) => disposisi.disposisiGrantService.ajukan(tx, input(), audit(USER_ID.tu)));
        expect(dibuat).toHaveLength(1);
        const [row] = (await database.query<Record<string, string>>(
            `SELECT target_user_id, requester_id, access_mode, status, purpose FROM record_access_grants WHERE id = '${dibuat[0]}'`)).rows;
        expect(row).toEqual({
            target_user_id: USER_ID.ptep, requester_id: USER_ID.tu, access_mode: 'view', status: 'pending',
            purpose: `[disposisi:${DISPOSISI.rs2Ptep}] Tindak lanjut disposisi surat masuk dalam rangkaian RS-2026-000002`,
        });
    });

    it('cabut mencabut/menolak hanya grant surat masuk disposisi itu (T6-2) dan memvalidasi pelaku serta alasan', async () => {
        await cabutGrantFixture(GRANT.ptepSmTerbatas);
        const [grantId] = await holder.db.transaction((tx: any) => disposisi.disposisiGrantService.ajukan(tx, input(), audit(USER_ID.tu)));
        await grants.recordAccessGrantService.approve(grantId, USER_ID.approver, 'Disetujui untuk disposisi', besok(), audit(USER_ID.approver));
        const palsu = '53000000-0000-4000-8000-0000000000aa';
        await database.exec(`INSERT INTO record_access_grants (id, requester_id, target_user_id, entity_type, entity_id, unit_kerja_id,
            required_classification, purpose, access_mode, status) VALUES ('${palsu}', '${USER_ID.tu}', '${USER_ID.tu}', 'surat_masuk',
            '${SURAT.smTunggal}', 'sesditjen', 'terbatas', '[disposisi:${DISPOSISI.rs2Ptep}] permohonan buatan pengguna sendiri', 'view', 'pending')`);

        const cabut = (actorId: string, alasan: string) => holder.db.transaction((tx: any) => disposisi.disposisiGrantService.cabut(
            tx, { distribusiId: DISPOSISI.rs2Ptep, suratMasukId: SURAT.smTerbatas, actorId, alasan }, audit(USER_ID.tu)));
        await expect(cabut(USER_ID.tu, 'singkat   ')).rejects.toMatchObject({ statusCode: 400 });
        await expect(cabut('', 'Disposisi ditutup oleh pengawas')).rejects.toMatchObject({ statusCode: 400 });
        expect(await cabut(USER_ID.tu, 'Disposisi ditutup oleh pengawas')).toBe(1);

        const status = Object.fromEntries((await database.query<{ id: string; status: string }>(
            `SELECT id, status FROM record_access_grants WHERE id IN ('${grantId}', '${palsu}', '${GRANT.bpptSmTerbatas}')`)).rows.map(r => [r.id, r.status]));
        expect(status).toEqual({ [grantId]: 'revoked', [palsu]: 'pending', [GRANT.bpptSmTerbatas]: 'approved' });
        const log = (await database.query<{ action: string; via: string }>(
            `SELECT action, changes->>'via' AS via FROM audit_log WHERE entity_id = '${grantId}' AND action = 'revoke_access'`)).rows;
        expect(log).toEqual([{ action: 'revoke_access', via: 'disposisi' }]);
    });
});
