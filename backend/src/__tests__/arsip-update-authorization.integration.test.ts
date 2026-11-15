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
const submit = (patch: Partial<schema.Arsip> = { keterangan: 'Deskripsi baru' }) => service.update(archiveId, patch, { userId, userEmail: 'stale@example.test' });

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

const ITEM = {
    satu: '22000000-0000-4000-8000-000000000001',
    dua: '22000000-0000-4000-8000-000000000002',
    tiga: '22000000-0000-4000-8000-000000000003',
};
const reviewerId = '10000000-0000-4000-8000-000000000002';
type BarisItem = { id: string; nomor: string; uraian: string; tingkat?: string; tanggal?: string;
    jumlah?: number; media?: string; fc?: string; laci?: string; folder?: string };
// Item 1 adalah salinan ringkasan item pada baris arsip, seperti hasil archive-full.
const salinan = (patch: Partial<BarisItem> = {}): BarisItem => ({ id: ITEM.satu, nomor: '1', uraian: 'Lama', ...patch });
const lampiran = (patch: Partial<BarisItem> = {}): BarisItem => ({
    id: ITEM.dua, nomor: '2', uraian: 'Lampiran', tingkat: 'Salinan', tanggal: '2026-09-02', jumlah: 3, media: 'foto', ...patch,
});

async function seedBerkas(items: BarisItem[]) {
    await database.exec(`UPDATE arsip SET nomor_item='1', uraian_item='Lama', tingkat_perkembangan='Asli', tanggal_arsip='2026-09-01',
        lokasi_fc='FC-01', lokasi_laci='L-01', lokasi_folder='F-001', jumlah=${Math.max(items.length, 1)};`);
    for (const item of items) {
        await database.query(`INSERT INTO arsip_items(id,arsip_id,nomor_item,uraian_item,tingkat_perkembangan,tanggal_item,jumlah,media_type,lokasi_fc,lokasi_laci,lokasi_folder)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [item.id, archiveId, item.nomor, item.uraian, item.tingkat ?? 'Asli',
            item.tanggal ?? '2026-09-01', item.jumlah ?? 1, item.media ?? 'kertas', item.fc ?? 'FC-01', item.laci ?? 'L-01', item.folder ?? 'F-001']);
    }
}
async function itemRows() {
    return (await database.query<any>(`SELECT id, nomor_item, uraian_item, tingkat_perkembangan, tanggal_item::text AS tanggal_item,
        jumlah, media_type, lokasi_fc, lokasi_laci, lokasi_folder FROM arsip_items ORDER BY nomor_item, id`)).rows;
}
const itemRow = async (id: string) => (await itemRows()).find(row => row.id === id);
async function auditChanges() {
    return (await database.query<any>('SELECT changes FROM audit_log')).rows.map(row => row.changes);
}
async function arsipUraianItem() {
    return (await database.query<any>('SELECT uraian_item FROM arsip')).rows[0].uraian_item;
}
async function appraisal(status: 'open' | 'in_review') {
    const terkirim = status === 'open' ? '' : `,submission_snapshot,submission_sha256,submitted_at`;
    const nilaiTerkirim = status === 'open' ? '' : `,'{}'::jsonb,repeat('a',64),now()`;
    const [row] = (await database.query<{ id: string }>(`INSERT INTO jra_appraisal_cases(arsip_id,case_type,status,reason,proposed_outcome,proposed_rationale,assessor_id${terkirim})
        VALUES ('${archiveId}','jra_manual','${status}','Penilaian ulang nilai guna berkas uji coba.','musnah',
            'Berkas tidak memiliki nilai guna sekunder lanjutan.','${userId}'${nilaiTerkirim}) RETURNING id`)).rows;
    return row.id;
}

describe('archive update keeps arsip_items aligned with the item summary', () => {
    it('updates the copied item and the items stored at the same old location in place', async () => {
        await seedBerkas([salinan(), lampiran(), { id: ITEM.tiga, nomor: '3', uraian: 'Arsip lain', fc: 'FC-09' }]);
        const [, , sebelumTiga] = await itemRows();

        await submit({ uraianItem: 'Baru', lokasiFolder: 'F-002' });

        expect(await itemRow(ITEM.satu)).toMatchObject({ nomor_item: '1', uraian_item: 'Baru', lokasi_fc: 'FC-01', lokasi_laci: 'L-01', lokasi_folder: 'F-002' });
        expect(await itemRow(ITEM.dua)).toMatchObject({
            nomor_item: '2', uraian_item: 'Lampiran', tingkat_perkembangan: 'Salinan', tanggal_item: '2026-09-02',
            jumlah: 3, media_type: 'foto', lokasi_fc: 'FC-01', lokasi_laci: 'L-01', lokasi_folder: 'F-002',
        });
        expect(await itemRow(ITEM.tiga)).toEqual(sebelumTiga);
        expect((await itemRows()).map(row => row.id)).toEqual([ITEM.satu, ITEM.dua, ITEM.tiga]);
        const [changes, ...lainnya] = await auditChanges();
        expect(lainnya).toEqual([]);
        expect(changes.itemSync).toBe('disinkronkan');
        expect(changes.items).toEqual([
            { id: ITEM.satu, before: { uraianItem: 'Lama', lokasiFolder: 'F-001' }, after: { uraianItem: 'Baru', lokasiFolder: 'F-002' } },
            { id: ITEM.dua, before: { lokasiFolder: 'F-001' }, after: { lokasiFolder: 'F-002' } },
        ]);
    });

    it.each([
        { keterangan: 'Deskripsi baru' },
        { jumlah: 5 },
        { mediaType: 'elektronik' },
    ])('writes nothing to arsip_items for %o', async patch => {
        await seedBerkas([salinan({ jumlah: 2, media: 'foto' }), lampiran()]);
        const sebelum = await itemRows();
        await submit(patch);
        expect(await itemRows()).toEqual(sebelum);
        expect(await auditChanges()).toEqual([expect.objectContaining({ itemSync: 'tidak_perlu', items: [] })]);
    });

    it('rolls item changes back with the archive when the audit cannot be recorded', async () => {
        await seedBerkas([salinan(), lampiran()]);
        const sebelum = await itemRows();
        vi.spyOn(audit, 'logActionOrThrow').mockRejectedValueOnce(new Error('audit unavailable'));
        await expect(submit({ uraianItem: 'Baru', lokasiFolder: 'F-002' })).rejects.toThrow('audit unavailable');
        expect(await itemRows()).toEqual(sebelum);
        expect(await arsipUraianItem()).toBe('Lama');
        expect(await auditChanges()).toEqual([]);
    });

    it('rolls item changes back with the archive when the grant expires before commit', async () => {
        await seedBerkas([salinan(), lampiran()]);
        await grant();
        const sebelum = await itemRows();
        const original = audit.logActionOrThrow.bind(audit);
        vi.spyOn(audit, 'logActionOrThrow').mockImplementation(async (...args) => {
            await original(...args);
            vi.setSystemTime(new Date('2026-09-11T02:00:00Z'));
        });
        await expect(submit({ uraianItem: 'Baru', lokasiFolder: 'F-002' })).rejects.toThrow(/izin|akses/i);
        expect(await itemRows()).toEqual(sebelum);
        expect(await arsipUraianItem()).toBe('Lama');
        expect(await auditChanges()).toEqual([]);
    });

    it('re-aligns the only item of a berkas even when its nomor already drifted', async () => {
        await seedBerkas([salinan({ nomor: '1A' })]);
        await submit({ uraianItem: 'Baru' });
        expect(await itemRow(ITEM.satu)).toMatchObject({ nomor_item: '1', uraian_item: 'Baru' });
        expect((await auditChanges())[0]).toMatchObject({
            itemSync: 'disinkronkan',
            items: [{ id: ITEM.satu, before: { nomorItem: '1A', uraianItem: 'Lama' }, after: { nomorItem: '1', uraianItem: 'Baru' } }],
        });
    });

    it('gives a drifted only item the full new location when one location part changes', async () => {
        await seedBerkas([salinan({ fc: 'FC-07', laci: 'L-07', folder: 'F-007' })]);
        await submit({ lokasiFc: 'FC-02' });
        expect(await itemRow(ITEM.satu)).toMatchObject({ lokasi_fc: 'FC-02', lokasi_laci: 'L-01', lokasi_folder: 'F-001' });
    });

    it('leaves the items alone when an earlier edit made the copied item unrecognisable', async () => {
        await seedBerkas([salinan(), lampiran()]);
        // Perubahan nomor sebelum sinkronisasi ada: arsip menunjuk nomor 2.
        await database.exec(`UPDATE arsip SET nomor_item='2'`);
        const sebelum = await itemRows();
        const result = await submit({ uraianItem: 'Baru' });
        expect(result?.uraianItem).toBe('Baru');
        expect(await arsipUraianItem()).toBe('Baru');
        expect(await itemRows()).toEqual(sebelum);
        expect(await auditChanges()).toEqual([expect.objectContaining({ itemSync: 'item_utama_ambigu', items: [] })]);
    });

    it('treats two items with the same identity as ambiguous but still moves co-located items', async () => {
        await seedBerkas([salinan(), salinan({ id: ITEM.dua })]);
        await submit({ uraianItem: 'Baru', lokasiFolder: 'F-002' });
        for (const id of [ITEM.satu, ITEM.dua]) {
            expect(await itemRow(id)).toMatchObject({ uraian_item: 'Lama', lokasi_folder: 'F-002' });
        }
        const [changes] = await auditChanges();
        expect(changes.itemSync).toBe('item_utama_ambigu');
        expect(changes.items.map((item: any) => item.id).sort()).toEqual([ITEM.satu, ITEM.dua]);
    });

    it('reports a berkas without item rows', async () => {
        await seedBerkas([]);
        await submit({ uraianItem: 'Baru' });
        expect(await arsipUraianItem()).toBe('Baru');
        expect(await auditChanges()).toEqual([expect.objectContaining({ itemSync: 'tanpa_item', items: [] })]);
    });

    it.each(['open', 'in_review'] as const)('rejects an item summary change while a JRA appraisal is %s', async status => {
        await seedBerkas([salinan(), lampiran()]);
        await appraisal(status);
        const sebelum = await itemRows();
        await expect(submit({ uraianItem: 'Baru', lokasiFolder: 'F-002' })).rejects.toMatchObject({
            statusCode: 409,
            message: expect.stringMatching(/appraisal JRA/),
        });
        expect(await itemRows()).toEqual(sebelum);
        expect(await arsipUraianItem()).toBe('Lama');
        expect(await auditChanges()).toEqual([]);

        expect((await submit({ keterangan: 'Deskripsi baru' }))?.keterangan).toBe('Deskripsi baru');
    });

    it('updates an item that already carries a per-item retention decision in place', async () => {
        await seedBerkas([salinan(), lampiran()]);
        await database.exec(`INSERT INTO users(id,email,role,unit_kerja_id) VALUES ('${reviewerId}','reviewer@example.test','admin_dirjen','ditjen');`);
        const caseId = await appraisal('in_review');
        await database.exec(`
            INSERT INTO jra_appraisal_decisions(id,case_id,arsip_id,decision_status,outcome,rationale,decision_snapshot,decision_sha256,assessor_id,reviewer_id)
            VALUES ('23000000-0000-4000-8000-000000000001','${caseId}','${archiveId}','approved','musnah','Keputusan telah diperiksa.','{}'::jsonb,repeat('a',64),'${userId}','${reviewerId}');
            INSERT INTO arsip_item_retention_decisions(decision_id,case_id,arsip_id,arsip_item_id,outcome,basis,decision_snapshot,decision_sha256)
            VALUES ('23000000-0000-4000-8000-000000000001','${caseId}','${archiveId}','${ITEM.satu}','musnah','Dasar keputusan per item.','{}'::jsonb,repeat('a',64));
            UPDATE jra_appraisal_cases SET status='approved',reviewer_id='${reviewerId}',reviewed_at=now(),
                review_reason='Keputusan telah diperiksa.',updated_at=now() WHERE id='${caseId}';`);

        await submit({ uraianItem: 'Baru', lokasiFolder: 'F-002' });

        expect(await itemRow(ITEM.satu)).toMatchObject({ uraian_item: 'Baru', lokasi_folder: 'F-002' });
        expect((await database.query<any>('SELECT arsip_item_id FROM arsip_item_retention_decisions')).rows)
            .toEqual([{ arsip_item_id: ITEM.satu }]);
    });
});

describe('Ubah Metadata dari dialog yang datanya sudah diubah orang lain', () => {
    /** updatedAt seperti yang diterima dialog: Date dari Drizzle, lewat JSON, lalu dikirim balik. */
    async function versiDimuat() {
        const [row] = await holder.db.select({ updatedAt: schema.arsip.updatedAt }).from(schema.arsip);
        return new Date(JSON.parse(JSON.stringify(row.updatedAt)));
    }

    it('menolak versi lama dengan 409 DATA_SUDAH_BERUBAH tanpa mengubah data', async () => {
        await database.exec("UPDATE arsip SET updated_at = '2026-09-10 08:00:00.123456'");
        const dimuat = await versiDimuat();
        // Orang lain menyimpan sesudah dialog dibuka.
        await database.exec("UPDATE arsip SET updated_at = '2026-09-10 09:30:00'");
        await expect(service.update(archiveId, { keterangan: 'Deskripsi baru' }, { userId, userEmail: 'stale@example.test' },
            { expectedUpdatedAt: dimuat })).rejects.toMatchObject({ statusCode: 409, code: 'DATA_SUDAH_BERUBAH' });
        await unchanged();
    });

    it('menerima versi yang dimuat walau updated_at tersimpan bermikrodetik', async () => {
        await database.exec("UPDATE arsip SET updated_at = '2026-09-10 08:00:00.123456'");
        const dimuat = await versiDimuat();
        expect(dimuat.toISOString()).toBe('2026-09-10T08:00:00.123Z');
        const result = await service.update(archiveId, { keterangan: 'Deskripsi baru' }, { userId, userEmail: 'stale@example.test' },
            { expectedUpdatedAt: dimuat });
        expect(result?.keterangan).toBe('Deskripsi baru');
    });
});

describe('Ubah Metadata saat boks atau arsip dipinjam', () => {
    const boxId = '24000000-0000-4000-8000-000000000001';
    async function versiDimuat() {
        const [row] = await holder.db.select({ updatedAt: schema.arsip.updatedAt }).from(schema.arsip);
        return new Date(JSON.parse(JSON.stringify(row.updatedAt)));
    }
    async function dalamBoks() {
        await database.exec(`INSERT INTO storage_locations (id, unit_kerja_id, code, name, level) VALUES ('${boxId}', 'ditjen', 'B-01', 'Boks 1', 'box');
            UPDATE arsip SET storage_location_id = '${boxId}', updated_at = '2026-09-10 08:00:00.123456';`);
    }

    it.each(['box', 'arsip'] as const)('peminjaman dan pengembalian (%s) di antara buka dan simpan dialog tidak menolak suntingan', async jenis => {
        await dalamBoks();
        const dimuat = await versiDimuat();
        const { archiveLendingService } = await import('../services/archive-lending.service');
        const pinjam = await archiveLendingService.borrow({
            lendingType: jenis, ...(jenis === 'box' ? { storageLocationId: boxId } : { arsipId: archiveId }),
            borrowerId: userId, borrowerName: 'Peminjam', dueDate: '2026-09-20',
        }, 'ditjen');
        expect((await database.query<any>('SELECT lending_status FROM arsip')).rows[0].lending_status).toBe('borrowed');
        await archiveLendingService.return(pinjam.id, 'ditjen');
        const result = await service.update(archiveId, { keterangan: 'Deskripsi baru' }, { userId, userEmail: 'stale@example.test' },
            { expectedUpdatedAt: dimuat });
        expect(result?.keterangan).toBe('Deskripsi baru');
    });

    it('perubahan metadata oleh pengguna lain tetap ditolak', async () => {
        await dalamBoks();
        const dimuat = await versiDimuat();
        await service.update(archiveId, { personInCharge: 'Petugas lain' }, { userId, userEmail: 'lain@example.test' });
        await expect(service.update(archiveId, { keterangan: 'Deskripsi baru' }, { userId, userEmail: 'stale@example.test' },
            { expectedUpdatedAt: dimuat })).rejects.toMatchObject({ statusCode: 409, code: 'DATA_SUDAH_BERUBAH' });
    });
});
