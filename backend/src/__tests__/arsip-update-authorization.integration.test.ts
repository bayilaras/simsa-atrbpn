import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import { enterTestMigratorRole } from './helpers/database-role-fixture';

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ db: holder.db }));
let database: PGlite;
let service: typeof import('../services/arsip.service').arsipService;
let access: typeof import('../services/record-access.service').recordAccessService;
let audit: typeof import('../services/audit-log.service').default;
const userId = '10000000-0000-4000-8000-000000000001';
const archiveId = '20000000-0000-4000-8000-000000000001';
const actor = { id: userId, role: 'admin_dirjen', unitKerjaId: 'ditjen' };
const submit = (patch = { keterangan: 'Deskripsi baru' }) => service.update(archiveId, patch, { userId, userEmail: 'stale@example.test' });

beforeAll(async () => {
    database = new PGlite({ extensions: { pgcrypto } });
    await database.waitReady;
    await enterTestMigratorRole(database);
    const dir = fileURLToPath(new URL('../db/migrations/', import.meta.url));
    for (const file of readdirSync(dir).filter(file => /^\d{4}.*\.sql$/.test(file) && Number(file.slice(0, 4)) <= 37).sort()) {
        for (const statement of readFileSync(`${dir}/${file}`, 'utf8').split('--> statement-breakpoint').filter(value => value.trim())) {
            await database.exec(statement);
        }
    }
    holder.db = drizzle(database, { schema });
    ({ arsipService: service } = await import('../services/arsip.service'));
    ({ recordAccessService: access } = await import('../services/record-access.service'));
    ({ default: audit } = await import('../services/audit-log.service'));
}, 45_000);
afterAll(async () => { await database?.close(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-11T00:00:00Z'));
    await database.exec(`TRUNCATE arsip, users, unit_kerja CASCADE;
        INSERT INTO unit_kerja(id,name) VALUES ('ditjen','Ditjen'),('sesditjen','Sesditjen');
        INSERT INTO users(id,email,role,unit_kerja_id) VALUES ('${userId}','current@example.test','admin_dirjen','ditjen');
        INSERT INTO arsip(id,unit_kerja_id,jenis_arsip,tahun,klasifikasi_keamanan,keterangan)
        VALUES ('${archiveId}','ditjen','masuk',2026,'biasa','Deskripsi lama');`);
});
async function grant() {
    await database.exec(`UPDATE arsip SET klasifikasi_keamanan='terbatas';
        INSERT INTO record_access_grants(requester_id,target_user_id,entity_type,entity_id,unit_kerja_id,required_classification,purpose,access_mode,status,decided_by,decided_at,decision_reason,expires_at)
        VALUES ('${userId}','${userId}','arsip','${archiveId}','ditjen','terbatas','Koreksi metadata arsip untuk pekerjaan resmi','manage','approved','${userId}','2026-09-10T00:00:00Z','Kebutuhan pekerjaan terverifikasi','2026-09-11T01:00:00Z');`);
}
async function unchanged() {
    expect((await database.query<any>('SELECT keterangan FROM arsip')).rows[0].keterangan).toBe('Deskripsi lama');
    expect((await database.query('SELECT id FROM audit_log')).rows).toHaveLength(0);
}

describe('archive update reauthorizes after route preflight using the database transaction', () => {
    // PGlite is single-connection: commit the competing change after preflight,
    // then exercise real SQL in update. Multi-connection lock timing is separate.
    it.each(['inactive', 'downgraded', 'other-unit'])('rejects an actor made %s after preflight', async state => {
        expect((await access.check(actor, 'arsip', archiveId)).mutable).toBe(true);
        await database.exec(state === 'inactive' ? 'UPDATE users SET is_active=false'
            : state === 'downgraded' ? "UPDATE users SET role='staff'"
                : "UPDATE users SET role='admin_sesditjen',unit_kerja_id='sesditjen'");
        await expect(submit()).rejects.toThrow(/izin|akses|aktif/i);
        await unchanged();
    });
    it.each(['unit', 'classification', 'hold', 'proposed'])('rejects a record changed to %s after preflight', async state => {
        expect((await access.check(actor, 'arsip', archiveId)).mutable).toBe(true);
        await database.exec(state === 'unit' ? "UPDATE arsip SET unit_kerja_id='sesditjen'"
            : state === 'classification' ? "UPDATE arsip SET klasifikasi_keamanan='terbatas'"
                : state === 'hold' ? "UPDATE arsip SET legal_hold=true,legal_hold_reason='Penahanan untuk pemeriksaan resmi',legal_hold_placed_at=now()"
                    : "UPDATE arsip SET disposal_status='proposed'");
        await expect(submit()).rejects.toThrow(/izin|akses|ditahan|penyusutan/i);
        await unchanged();
    });
    it.each(['revoked', 'view', 'expired'])('rejects a manage grant made %s after preflight', async state => {
        await grant();
        expect((await access.check(actor, 'arsip', archiveId)).mutable).toBe(true);
        if (state === 'expired') vi.setSystemTime(new Date('2026-09-11T02:00:00Z'));
        else await database.exec(state === 'view' ? "UPDATE record_access_grants SET access_mode='view'"
            : `UPDATE record_access_grants SET status='revoked',revoked_by='${userId}',revoked_at=now(),revocation_reason='Izin kelola telah dicabut'`);
        await expect(submit()).rejects.toThrow(/izin|akses/i);
        await unchanged();
    });
    it('rejects an unauthorized new classification within the transaction', async () => {
        await expect(service.update(archiveId, { klasifikasiKeamanan: 'sangat_rahasia' }, { userId })).rejects.toThrow(/klasifikasi|kewenangan/i);
        expect((await database.query<any>('SELECT klasifikasi_keamanan FROM arsip')).rows[0].klasifikasi_keamanan).toBe('biasa');
        await unchanged();
    });
    it.each(['biasa', 'terbatas'])('commits a current %s mandate and records the fresh actor identity', async classification => {
        if (classification === 'terbatas') await grant();
        expect((await submit())?.keterangan).toBe('Deskripsi baru');
        expect((await database.query<any>('SELECT user_email FROM audit_log')).rows).toEqual([{ user_email: 'current@example.test' }]);
    });
    it('rolls back metadata and success audit when a grant expires before commit', async () => {
        await grant();
        const original = audit.logActionOrThrow.bind(audit);
        vi.spyOn(audit, 'logActionOrThrow').mockImplementation(async (...args) => {
            await original(...args);
            vi.setSystemTime(new Date('2026-09-11T02:00:00Z'));
        });
        await expect(submit()).rejects.toThrow(/izin|akses/i);
        await unchanged();
    });
    it('rolls back metadata if the success audit cannot be recorded', async () => {
        vi.spyOn(audit, 'logActionOrThrow').mockRejectedValueOnce(new Error('audit unavailable'));
        await expect(submit()).rejects.toThrow('audit unavailable');
        await unchanged();
    });
    it('rejects an audited mutation without a server actor id', async () => {
        await expect(service.update(archiveId, { keterangan: 'Deskripsi baru' }, {})).rejects.toThrow(/aktor|pelaku|akun/i);
        await unchanged();
    });
});
