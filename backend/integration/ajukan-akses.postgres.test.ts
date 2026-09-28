// backend/integration/ajukan-akses.postgres.test.ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { dbState } from './helpers/db-proxy.js';
import { createRangkaianTestDatabase, type RangkaianTestDatabase, type TestUser } from './helpers/rangkaian-db.js';

// Mock `db` bersama untuk suite Postgres P3 (T2-5).
vi.mock('../src/config/database', () => import('./helpers/db-proxy.js'));
vi.mock('../src/config/database.js', () => import('./helpers/db-proxy.js'));

const { recordAccessGrantService } = await import('../src/services/record-access-grant.service.js');
const { recordAccessService, rangkaianService, aktor, isAllowedForRecordUnit } = await import('../src/services/rangkaian/deps.js');
const { isGrantEligible } = await import('../src/services/rangkaian/grant-eligibility.js');
const { disposisiGrantService, disposisiGrantPrefix } = await import('../src/services/rangkaian/disposisi-grant.service.js');

type Ref = { type: 'surat_masuk' | 'surat_keluar'; id: string; unitKerjaId: string };

// Tanpa TEST_POSTGRES_URL suite ini dilewati bersih (tidak ada Postgres lokal);
// CI menjalankannya pada PG16/17/18.
const adaPostgres = Boolean(process.env.TEST_POSTGRES_URL);

let h: RangkaianTestDatabase;
let bppt1: TestUser; let bppt2: TestUser; let ptep: TestUser; let superA: TestUser;
let dirjen: TestUser; let tu: TestUser; let staffBppt: TestUser;
let smRahasia: string; let skBiasa: string; let smLain: string;
let anggotaRahasia: string; let anggotaBiasa: string; let distribusi: string; let rangkaianKode: string;
const audit = (u: TestUser) => ({ userId: u.id, userEmail: u.email });
const purpose = { purpose: 'Menindaklanjuti disposisi TU atas surat ini', accessMode: 'view' as const };

describe.skipIf(!adaPostgres)('Ajukan Akses via rangkaian dan grant disposisi di PostgreSQL', () => {
    beforeAll(async () => {
        h = await createRangkaianTestDatabase('ajukanakses');
        dbState.db = h.db;
        await h.seedUnits();
        bppt1 = await h.seedUser('admin_unit', 'dir_bppt');
        bppt2 = await h.seedUser('admin_unit', 'dir_bppt');
        ptep = await h.seedUser('admin_unit', 'dir_ptep');
        superA = await h.seedUser('super_admin', null);
        dirjen = await h.seedUser('admin_dirjen', 'ditjen');
        tu = await h.seedUser('admin_unit', 'sesditjen');
        staffBppt = await h.seedUser('staff', 'dir_bppt');
        smRahasia = await h.insertSuratMasuk({ unitKerjaId: 'sesditjen', nomorSurat: 'R-01/2026', sifatSurat: 'Rahasia' });
        skBiasa = await h.insertSuratKeluar({ unitKerjaId: 'sesditjen', nomorSurat: 'ND-01/2026', approvalStatus: 'approved' });
        smLain = await h.insertSuratMasuk({ unitKerjaId: 'dir_ptep', nomorSurat: 'T-09/2026', sifatSurat: 'Terbatas' });
        let rangkaianId = '';
        await h.db.transaction(async (tx: any) => {
            const r = await rangkaianService.ensureForSuratMasuk(tx, smRahasia, aktor(superA));
            rangkaianId = r.rangkaianId;
            anggotaRahasia = r.anggotaId;
            anggotaBiasa = (await rangkaianService.attach(tx, { rangkaianId, surat: { jenis: 'surat_keluar', id: skBiasa }, keAnggotaId: r.anggotaId, jenisRelasi: 'tindak_lanjut' }, aktor(superA))).anggotaId;
        });
        distribusi = await h.insertDistribusi({ suratMasukId: smRahasia, sourceUnitId: 'sesditjen', targetUnitId: 'dir_bppt', status: 'sent', rangkaianId });
        [{ kode: rangkaianKode }] = await h.query<{ kode: string }>('SELECT kode FROM rangkaian_surat WHERE id = $1', [rangkaianId]);
    }, 120_000);

    afterAll(async () => { await h?.close(); });

    /**
     * T6-3 dengan koreksi C-2: pengguna unit pemilik selalu layak (jalur request());
     * selain itu kelayakan identik dengan jalurJangkauan checkMany (FR:26).
     * Hanya baris yang tidak terhapus (seluruh fixture di sini).
     */
    async function cekParitas() {
        const matriks = [bppt1, bppt2, ptep, superA, dirjen, tu, staffBppt];
        const refs: Ref[] = [
            { type: 'surat_masuk', id: smRahasia, unitKerjaId: 'sesditjen' },
            { type: 'surat_keluar', id: skBiasa, unitKerjaId: 'sesditjen' },
            { type: 'surat_masuk', id: smLain, unitKerjaId: 'dir_ptep' },
        ];
        for (const user of matriks) for (const ref of refs) {
            const eligible = await isGrantEligible(h.db as any, user, ref);
            if (isAllowedForRecordUnit(user, ref.unitKerjaId)) { expect(eligible).toBe(true); continue; }   // owner path = request()
            const { via } = await recordAccessService.checkRead(user, ref.type, ref.id, h.db);
            expect({ user: user.email, ref: ref.id, eligible }).toEqual({ user: user.email, ref: ref.id, eligible: via === 'pengawas' || via === 'peserta' });
        }
    }

    describe('matriks Ajukan Akses via rangkaian', () => {
        it('peserta di luar unit pemilik dapat mengajukan; non-peserta mendapat 404', async () => {
            const grant = await recordAccessGrantService.requestViaRangkaian(bppt1, anggotaRahasia, purpose, audit(bppt1));
            expect(grant).toMatchObject({ status: 'pending', unitKerjaId: 'sesditjen', requiredClassification: 'rahasia', entityId: smRahasia });
            const [log] = await h.query<{ via: string; anggota: string }>(
                "SELECT changes->>'via' AS via, changes->>'anggotaId' AS anggota FROM audit_log WHERE entity_type = 'record_access_grant' AND entity_id = $1 AND action = 'request_access'",
                [grant.id]);
            expect(log).toEqual({ via: 'rangkaian', anggota: anggotaRahasia });
            await expect(recordAccessGrantService.requestViaRangkaian(ptep, anggotaRahasia, purpose, audit(ptep)))
                .rejects.toMatchObject({ statusCode: 404 });
        });

        it('persetujuan super_admin lalu pembacaan via grant', async () => {
            const [pending] = await h.query<{ id: string }>("SELECT id FROM record_access_grants WHERE target_user_id = $1 AND status = 'pending'", [bppt1.id]);
            await recordAccessGrantService.approve(pending.id, superA.id, 'Disetujui untuk tindak lanjut', new Date(Date.now() + 2 * 3600_000), audit(superA));
            const akses = await recordAccessService.checkRead(bppt1, 'surat_masuk', smRahasia);
            expect(akses).toMatchObject({ allowed: true, mutable: false });
        });

        it('persetujuan ditolak setelah jangkauan dicabut (disposisi ditolak)', async () => {
            const grant = await recordAccessGrantService.requestViaRangkaian(bppt2, anggotaRahasia, purpose, audit(bppt2));
            await h.query("UPDATE surat_distributions SET status = 'rejected', rejection_reason = 'Bukan tugas unit ini' WHERE id = $1", [distribusi]);
            await expect(recordAccessGrantService.approve(grant.id, superA.id, 'Disetujui untuk tindak lanjut', new Date(Date.now() + 3600_000), audit(superA)))
                .rejects.toMatchObject({ statusCode: 409 });
            await cekParitas();
            await h.query("UPDATE record_access_grants SET status = 'denied', decided_by = $2, decided_at = now(), decision_reason = 'Jangkauan sudah dicabut' WHERE id = $1", [grant.id, superA.id]);
            await expect(recordAccessGrantService.requestViaRangkaian(bppt2, anggotaRahasia, purpose, audit(bppt2)))
                .rejects.toMatchObject({ statusCode: 404 });
        });

        it('node biasa tidak memerlukan grant (409)', async () => {
            await h.query("UPDATE surat_distributions SET status = 'sent', rejection_reason = NULL WHERE id = $1", [distribusi]);
            await expect(recordAccessGrantService.requestViaRangkaian(bppt2, anggotaBiasa, purpose, audit(bppt2)))
                .rejects.toMatchObject({ statusCode: 409 });
        });

        it('paritas isGrantEligible dengan jalurJangkauan checkRead (T6-3, C-2)', async () => {
            await cekParitas();
        });
    });

    describe('grant disposisi terkendali', () => {
        it('ajukan membuat grant view bertujuan disposisi hanya untuk admin unit target tanpa grant aktif', async () => {
            const dibuat = await h.db.transaction((tx: any) => disposisiGrantService.ajukan(tx, {
                distribusiId: distribusi, suratMasukId: smRahasia, suratUnitKerjaId: 'sesditjen', classification: 'rahasia',
                targetUnitId: 'dir_bppt', requesterId: tu.id, rangkaianKode,
            }, audit(tu)));
            // bppt1 masih memegang grant approved; staff bukan admin unit.
            expect(dibuat).toHaveLength(1);
            const [grant] = await h.query<{ target_user_id: string; purpose: string; access_mode: string; status: string }>(
                'SELECT target_user_id, purpose, access_mode, status FROM record_access_grants WHERE id = $1', [dibuat[0]]);
            expect(grant).toMatchObject({ target_user_id: bppt2.id, access_mode: 'view', status: 'pending' });
            expect(grant.purpose.startsWith(disposisiGrantPrefix(distribusi))).toBe(true);
            expect(grant.purpose).toContain(rangkaianKode);
        });

        it('cabut hanya menyentuh grant surat masuk disposisi itu, bukan grant buatan pengguna berawalan sama (T6-2)', async () => {
            const [disposisiGrant] = await h.query<{ id: string }>(
                "SELECT id FROM record_access_grants WHERE target_user_id = $1 AND status = 'pending' AND purpose LIKE $2", [bppt2.id, `${disposisiGrantPrefix(distribusi)}%`]);
            await recordAccessGrantService.approve(disposisiGrant.id, superA.id, 'Disetujui untuk disposisi', new Date(Date.now() + 3600_000), audit(superA));
            const [palsu] = await h.query<{ id: string }>(`INSERT INTO record_access_grants
                (requester_id, target_user_id, entity_type, entity_id, unit_kerja_id, required_classification, purpose, access_mode, status)
                VALUES ($1, $1, 'surat_masuk', $2, 'dir_ptep', 'terbatas', $3, 'view', 'pending') RETURNING id`,
                [ptep.id, smLain, `${disposisiGrantPrefix(distribusi)} permohonan buatan pengguna sendiri`]);

            await expect(h.db.transaction((tx: any) => disposisiGrantService.cabut(tx, { distribusiId: distribusi, suratMasukId: smRahasia, actorId: tu.id, alasan: 'singkat' })))
                .rejects.toMatchObject({ statusCode: 400 });
            await expect(h.db.transaction((tx: any) => disposisiGrantService.cabut(tx, { distribusiId: distribusi, suratMasukId: smRahasia, actorId: '', alasan: 'Disposisi ditutup oleh pengawas' })))
                .rejects.toMatchObject({ statusCode: 400 });

            const jumlah = await h.db.transaction((tx: any) => disposisiGrantService.cabut(tx,
                { distribusiId: distribusi, suratMasukId: smRahasia, actorId: tu.id, alasan: 'Disposisi ditutup oleh pengawas' }, audit(tu)));
            expect(jumlah).toBe(1);
            const status = new Map((await h.query<{ id: string; status: string }>('SELECT id, status FROM record_access_grants')).map(r => [r.id, r.status]));
            expect(status.get(disposisiGrant.id)).toBe('revoked');
            expect(status.get(palsu.id)).toBe('pending');
            const [grantBppt1] = await h.query<{ status: string }>("SELECT status FROM record_access_grants WHERE target_user_id = $1 AND entity_id = $2", [bppt1.id, smRahasia]);
            expect(grantBppt1.status).toBe('approved');
            const [log] = await h.query<{ action: string }>("SELECT action FROM audit_log WHERE entity_id = $1 AND action = 'revoke_access'", [disposisiGrant.id]);
            expect(log).toEqual({ action: 'revoke_access' });
        });

        it('cabut tetap mencabut grant yang disetujui bersamaan (F1, READ COMMITTED)', async () => {
            // Tiru approve(): kunci baris grant pending FOR UPDATE di koneksi lain,
            // biarkan cabut() menunggu kunci itu, lalu commit sebagai 'approved'.
            // cabut() hanya memakai id distribusi sebagai awalan `purpose`; id baru
            // menghindari indeks unik distribusi aktif per (surat, unit tujuan).
            const distribusiBalapan = randomUUID();
            const [grant] = await h.query<{ id: string }>(`INSERT INTO record_access_grants
                (requester_id, target_user_id, entity_type, entity_id, unit_kerja_id, required_classification, purpose, access_mode, status)
                VALUES ($1, $2, 'surat_masuk', $3, 'sesditjen', 'rahasia', $4, 'view', 'pending') RETURNING id`,
                [tu.id, bppt2.id, smRahasia, `${disposisiGrantPrefix(distribusiBalapan)} Tindak lanjut disposisi surat masuk dalam rangkaian ${rangkaianKode}`]);
            const penyetuju = await h.pool.connect();
            let cabutJalan: Promise<number> | undefined;
            try {
                await penyetuju.query('BEGIN');
                const [{ pid }] = (await penyetuju.query('SELECT pg_backend_pid() AS pid')).rows as { pid: number }[];
                await penyetuju.query("SELECT id FROM record_access_grants WHERE id = $1 AND status = 'pending' FOR UPDATE", [grant.id]);

                cabutJalan = h.db.transaction((tx: any) => disposisiGrantService.cabut(tx,
                    { distribusiId: distribusiBalapan, suratMasukId: smRahasia, actorId: tu.id, alasan: 'Disposisi ditolak oleh unit tujuan' }, audit(tu)));
                cabutJalan.catch(() => undefined);   // ditunggu di bawah; cegah unhandled rejection sementara menunggu kunci

                const batas = Date.now() + 10_000;
                for (;;) {
                    const [{ menunggu }] = await h.query<{ menunggu: boolean }>(
                        'SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1::int = ANY (pg_blocking_pids(pid))) AS menunggu', [pid]);
                    if (menunggu) break;
                    if (Date.now() > batas) throw new Error('cabut() tidak pernah menunggu kunci grant');
                    await new Promise(r => setTimeout(r, 25));
                }

                await penyetuju.query(`UPDATE record_access_grants SET status = 'approved', decided_by = $2, decided_at = now(),
                    decision_reason = 'Disetujui untuk disposisi', expires_at = now() + interval '30 days', updated_at = now() WHERE id = $1`, [grant.id, superA.id]);
                await penyetuju.query('COMMIT');
            } catch (error) {
                await penyetuju.query('ROLLBACK').catch(() => undefined);
                throw error;
            } finally {
                penyetuju.release();
            }

            expect(await cabutJalan).toBe(1);
            const [akhir] = await h.query<{ status: string; revoked_by: string | null }>('SELECT status, revoked_by FROM record_access_grants WHERE id = $1', [grant.id]);
            expect(akhir).toEqual({ status: 'revoked', revoked_by: tu.id });
            const log = await h.query<{ action: string }>("SELECT action FROM audit_log WHERE entity_id = $1 AND action IN ('revoke_access', 'deny_access')", [grant.id]);
            expect(log).toEqual([{ action: 'revoke_access' }]);
        });
    });
});
