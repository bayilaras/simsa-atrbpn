import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { archiveLending } from '../db/schema';
import { allowedSecurityClassifications } from '../services/record-access.service';
const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('../config/database', () => ({ db: { select: (fields: any) => holder.db.select(fields) } }));
vi.mock('../services/audit-log.service.js', () => ({ default: {} }));
let database: PGlite;
let service: InstanceType<typeof import('../services/archive-lending.service').ArchiveLendingService>;
const aid='11111111-1111-4111-8111-111111111111', aid2='11111111-1111-4111-8111-111111111112', foreign='11111111-1111-4111-8111-111111111113';
const lid='22222222-2222-4222-8222-222222222222';
beforeAll(async () => {
    database = new PGlite();
    const columns = getTableConfig(archiveLending).columns.map(c => `"${c.name}" ${c.getSQLType()}`).join(',');
    await database.exec(`CREATE TABLE archive_lending (${columns});
      CREATE TABLE users(id uuid, name text, email text);
      CREATE TABLE arsip(id uuid, unit_kerja_id text, nomor_berkas text, uraian_berkas text, klasifikasi_keamanan text DEFAULT 'biasa');
      CREATE TABLE storage_locations(id uuid, unit_kerja_id text, code text, name text);
      INSERT INTO arsip(id,unit_kerja_id,nomor_berkas,uraian_berkas) VALUES ('${aid}','ditjen','QA-NOMOR-001','Arsip pertama'),('${aid2}','ditjen','QA-NOMOR-002','Sertifikat kedua'),('${foreign}','sesditjen','RAHASIA-UNIT-LAIN','Unit lain');
      INSERT INTO storage_locations VALUES ('${lid}','ditjen','BOX-001','Box sintetis');
      INSERT INTO archive_lending(id,lending_type,arsip_id,storage_location_id,borrower_name,status,borrow_date,due_date,created_at) VALUES
      ('33333333-3333-4333-8333-333333333331','arsip','${aid}',null,'Pemohon A','returned','2026-09-14','2026-09-15','2026-09-14'),
      ('33333333-3333-4333-8333-333333333332','arsip','${aid2}',null,'Petugas Kedua','returned','2026-09-14','2026-09-15','2026-09-13'),
      ('33333333-3333-4333-8333-333333333333','arsip','${foreign}',null,'Pemohon C','returned','2026-09-14','2026-09-15','2026-09-12'),
      ('33333333-3333-4333-8333-333333333334','box','${foreign}','${lid}','Pemohon box','borrowed','2026-09-14','2026-09-15','2026-09-11');`);
    holder.db = drizzle(database);
    const { ArchiveLendingService } = await import('../services/archive-lending.service');
    service = new ArchiveLendingService();
},60_000);
afterAll(async () => { await database?.close(); });
afterEach(() => vi.useRealTimers());
it('returns archive identities under the documented nested UI contract', async () => {
    const result = await service.findAll({unitKerjaId:'ditjen',securityClassifications:['biasa','terbatas'],status:'returned'});
    expect(result.data[0].arsip).toMatchObject({id:aid,noArsip:'QA-NOMOR-001',nomorBerkas:'QA-NOMOR-001'});
    expect(result.pagination.total).toBe(2);
});
it('searches the full authorized set before pagination', async () => {
    const result = await service.findAll({unitKerjaId:'ditjen',securityClassifications:['biasa','terbatas'],status:'returned',limit:1,search:'nomor-002'});
    expect(result.pagination.total).toBe(1);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].arsip?.noArsip).toBe('QA-NOMOR-002');
});
it('supports borrower and box code searches', async () => {
    expect((await service.findAll({unitKerjaId:'ditjen',securityClassifications:['biasa','terbatas'],search:'Petugas Kedua'})).pagination.total).toBe(1);
    const result=await service.findAll({unitKerjaId:'ditjen',securityClassifications:['biasa','terbatas'],search:'BOX-001'});
    expect(result.pagination.total).toBe(1);
    expect(result.data[0].storageLocation).toMatchObject({id:lid,code:'BOX-001'});
});
it('does not leak an irrelevant legacy cross-unit archive locator on a box lending row', async () => {
    const result=await service.findAll({unitKerjaId:'ditjen',securityClassifications:['biasa','terbatas'],lendingType:'box'});
    expect(result.data[0].arsip).toBeNull();
    expect(result.data[0].storageLocation?.code).toBe('BOX-001');
    expect((await service.findAll({unitKerjaId:'ditjen',securityClassifications:['biasa','terbatas'],search:'RAHASIA-UNIT-LAIN'})).pagination.total).toBe(0);
});
it('treats SQL wildcard characters as literal user search text', async () => {
    expect((await service.findAll({unitKerjaId:'ditjen',securityClassifications:['biasa','terbatas'],search:'%'})).pagination.total).toBe(0);
    expect((await service.findAll({unitKerjaId:'ditjen',securityClassifications:['biasa','terbatas'],search:'_'})).pagination.total).toBe(0);
});
it('derives overdue status and whole overdue days at the WIB date boundary without writes', async () => {
    vi.useFakeTimers({toFake:['Date']});
    vi.setSystemTime(new Date('2026-09-15T17:00:00Z'));
    const result=await service.findAll({unitKerjaId:'ditjen',securityClassifications:['biasa','terbatas'],status:'overdue'});
    expect(result.pagination.total).toBe(1);
    expect(result.data[0].status).toBe('overdue');
    expect((await service.findAll({unitKerjaId:'ditjen',securityClassifications:['biasa','terbatas'],status:'borrowed'})).pagination.total).toBe(0);
    const overdue=await service.getOverdue('ditjen',['biasa','terbatas']);
    expect(overdue[0].storageLocation?.code).toBe('BOX-001');
    expect(overdue[0].daysOverdue).toBe(1);
    expect((await database.query<{status:string}>("SELECT status FROM archive_lending WHERE lending_type='box'")).rows[0].status).toBe('borrowed');
});

it.each(['admin_unit', 'staff', 'auditor'])('hides same-unit secret archive loans from every read surface for %s', async role => {
    vi.useFakeTimers({toFake:['Date']});
    vi.setSystemTime(new Date('2026-09-16T00:00:00Z'));
    const secretArchive='11111111-1111-4111-8111-111111111114';
    const secretLoan='33333333-3333-4333-8333-333333333335';
    const actor={id:'qa-reader',role,unitKerjaId:'ditjen'};
    const securityClassifications=allowedSecurityClassifications(actor);
    await database.exec(`INSERT INTO arsip VALUES ('${secretArchive}','ditjen','PRIVATE-SECRET-001','PRIVATE-SECRET-DESCRIPTION','rahasia');
      INSERT INTO archive_lending(id,lending_type,arsip_id,borrower_name,status,borrow_date,due_date,created_at)
      VALUES ('${secretLoan}','arsip','${secretArchive}','PRIVATE-SECRET-BORROWER','borrowed','2026-09-14','2026-09-15','2026-09-14');`);
    try {
        const result=await service.findAll({unitKerjaId:'ditjen',securityClassifications});
        expect.soft(result.pagination.total).toBe(3);
        expect.soft(JSON.stringify(result)).not.toContain('PRIVATE-SECRET');
        for(const search of ['PRIVATE-SECRET-001','PRIVATE-SECRET-DESCRIPTION','PRIVATE-SECRET-BORROWER']) {
            const found=await service.findAll({unitKerjaId:'ditjen',securityClassifications,search});
            expect.soft(found.pagination.total).toBe(0);
            expect.soft(found.data).toEqual([]);
        }
        const overdue=await service.getOverdue('ditjen',securityClassifications);
        expect.soft(overdue).toHaveLength(1);
        expect.soft(JSON.stringify(overdue)).not.toContain('PRIVATE-SECRET');
        expect.soft(await service.getStats('ditjen',securityClassifications)).toMatchObject({total:3,borrowed:1,overdue:1,returned:2});
        expect.soft(await service.findById(secretLoan,'ditjen',securityClassifications)).toBeNull();
        expect.soft(await service.getHistoryByArsipId(secretArchive,'ditjen',securityClassifications)).toEqual([]);
        const superClasses=allowedSecurityClassifications({id:'qa-super',role:'super_admin',unitKerjaId:null});
        const authorized=await service.findAll({unitKerjaId:'ditjen',securityClassifications:superClasses,search:'PRIVATE-SECRET-001'});
        expect.soft(authorized.pagination.total).toBe(1);
        expect.soft(authorized.data[0].arsip?.noArsip).toBe('PRIVATE-SECRET-001');
    } finally {
        await database.exec(`DELETE FROM archive_lending WHERE id='${secretLoan}'; DELETE FROM arsip WHERE id='${secretArchive}';`);
    }
});

it('preserves the catalog distinction between admin-unit and staff/auditor access to restricted archives', async () => {
    await database.exec(`UPDATE arsip SET klasifikasi_keamanan='terbatas' WHERE id='${aid2}'`);
    try {
        for(const role of ['admin_unit','staff','auditor']) {
            const securityClassifications=allowedSecurityClassifications({id:'qa-reader',role,unitKerjaId:'ditjen'});
            const found=await service.findAll({unitKerjaId:'ditjen',securityClassifications,search:'QA-NOMOR-002'});
            expect(found.pagination.total).toBe(role==='admin_unit'?1:0);
        }
    } finally {
        await database.exec(`UPDATE arsip SET klasifikasi_keamanan='biasa' WHERE id='${aid2}'`);
    }
});

it('hides unrecognized archive classifications even from the super-admin catalog', async () => {
    await database.exec(`UPDATE arsip SET klasifikasi_keamanan='unrecognized-class' WHERE id='${aid2}'`);
    try {
        const securityClassifications=allowedSecurityClassifications({id:'qa-super',role:'super_admin',unitKerjaId:null});
        const found=await service.findAll({unitKerjaId:'ditjen',securityClassifications,search:'QA-NOMOR-002'});
        expect(found.pagination.total).toBe(0);
        expect(found.data).toEqual([]);
    } finally {
        await database.exec(`UPDATE arsip SET klasifikasi_keamanan='biasa' WHERE id='${aid2}'`);
    }
});

it('does not default to all archive classifications when a caller omits the read policy', async () => {
    const found=await service.findAll({unitKerjaId:'ditjen'});
    expect(found.pagination.total).toBe(1);
    expect(found.data[0].lendingType).toBe('box');
    expect(found.data[0].arsip).toBeNull();
});
