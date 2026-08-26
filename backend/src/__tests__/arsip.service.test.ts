import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Chainable DB Mock ───
const resultQueue: any[] = [];
const capturedValues: any[] = [];
const capturedSets: any[] = [];
function enqueue(...results: any[]) { resultQueue.push(...results); }

const mockChain: any = new Proxy({}, {
    get(_target, prop) {
        if (prop === 'then') {
            const val = resultQueue.shift() ?? [];
            return (resolve: any) => resolve(val);
        }
        return (...args: any[]) => {
            if (prop === 'values') capturedValues.push(args[0]);
            if (prop === 'set') capturedSets.push(args[0]);
            return mockChain;
        };
    },
});

const mockDb = {
    select: (..._a: any[]) => mockChain,
    insert: (..._a: any[]) => mockChain,
    update: (..._a: any[]) => mockChain,
    delete: (..._a: any[]) => mockChain,
    transaction: async (fn: any) => fn(mockDb),
};

vi.mock('../config/database', () => ({ db: mockDb }));

const canonicalAssignment = {
    snapshot: { schemaVersion: 1 },
    snapshotSha256: 'a'.repeat(64),
    cache: {
        kodeKlasifikasi: 'PT.01.01',
        klasifikasiArsipId: 10,
        klasifikasiRuleSetId: '10102018-1010-4010-8010-000000000010',
        klasifikasiVersion: 'ATR-BPN-10-2018',
        klasifikasiReference: 'Permen ATR/BPN Nomor 10 Tahun 2018',
        klasifikasiSnapshotHash: 'b'.repeat(64),
        jraKode: 'S.VI.A.0001',
        jraItemId: 20,
        jraRuleSetId: '08002020-0800-4080-8080-000000000008',
        jraUraian: 'Pengadaan tanah',
        retensiAktif: '2 tahun',
        retensiInaktif: '3 tahun',
        masaSimpanAktif: '2 tahun',
        masaSimpanInaktif: '3 tahun',
        hasilAkhir: 'Musnah',
        jraVersion: 'ATR-BPN-8-2020',
        jraReference: 'Permen ATR/BPN Nomor 8 Tahun 2020',
        retentionDecisionHash: 'c'.repeat(64),
        ruleProvenanceStatus: 'verified',
    },
    normalizedRetention: {
        activeMonths: 24,
        inactiveMonths: 36,
        calculationMode: 'duration',
        dispositionCode: 'musnah',
    },
};

vi.mock('../services/archive-rule-assignment.service', () => ({
    archiveRuleAssignmentService: {
        resolveActive: vi.fn().mockResolvedValue(canonicalAssignment),
        calculateExpiry: vi.fn((triggerDate: string | undefined, normalized: any) => {
            if (!triggerDate || normalized.calculationMode !== 'duration') return null;
            const date = new Date(`${triggerDate}T00:00:00.000Z`);
            date.setUTCMonth(date.getUTCMonth() + normalized.activeMonths + normalized.inactiveMonths);
            return date.toISOString().slice(0, 10);
        }),
        attachInitialSnapshot: vi.fn(async (_tx: any, id: string) => ({ id })),
        appendRevision: vi.fn(),
    },
}));

const { ArsipService } = await import('../services/arsip.service');
const { archiveRuleAssignmentService } = await import('../services/archive-rule-assignment.service');

describe('ArsipService', () => {
    let svc: InstanceType<typeof ArsipService>;

    beforeEach(() => {
        vi.clearAllMocks();
        svc = new ArsipService();
        resultQueue.length = 0;
        capturedValues.length = 0;
        capturedSets.length = 0;
        vi.mocked(archiveRuleAssignmentService.resolveActive).mockResolvedValue(canonicalAssignment as any);
    });

    // ── findAll ──
    describe('findAll', () => {
        it('should return paginated arsip data', async () => {
            enqueue(
                [{ count: 5 }],
                [{ id: '1' }, { id: '2' }],
            );
            const res = await svc.findAll({ unitKerjaId: 'u1' });
            expect(res.data).toHaveLength(2);
            expect(res.pagination.total).toBe(5);
        });

        it('should handle all filter parameters', async () => {
            enqueue([{ count: 1 }], [{ id: '1' }]);
            const res = await svc.findAll({
                unitKerjaId: 'u1',
                jenisArsip: 'masuk',
                tahun: 2026,
            });
            expect(res.data).toHaveLength(1);
        });

        it('should handle empty results', async () => {
            enqueue([{ count: 0 }], []);
            const res = await svc.findAll({ unitKerjaId: 'u1' });
            expect(res.data).toEqual([]);
            expect(res.pagination.total).toBe(0);
        });
    });

    // ── findById ──
    describe('findById', () => {
        it('should return arsip when found', async () => {
            // findById makes 2 DB calls: select arsip + select arsipItems
            enqueue([{ id: '1', jenisArsip: 'masuk' }]); // arsip
            enqueue([{ nomorItem: 1 }]); // arsipItems
            expect(await svc.findById('1')).toEqual({ id: '1', jenisArsip: 'masuk', items: [{ nomorItem: 1 }] });
        });

        it('should return null when not found', async () => {
            enqueue([]);
            expect(await svc.findById('x')).toBeNull();
        });
    });

    // ── create ──
    describe('create', () => {
        it('should create arsip and return result', async () => {
            const newArsip = { id: 'a1', jenisArsip: 'masuk', unitKerjaId: 'u1' };
            enqueue([newArsip]);
            const res = await svc.create({ unitKerjaId: 'u1', jenisArsip: 'masuk' } as any);
            expect(res).toEqual(newArsip);
        });
    });

    describe('rule reconciliation', () => {
        it('reconciles a legacy archive through a new canonical snapshot revision', async () => {
            const legacyArchive = {
                id: 'archive-1',
                unitKerjaId: 'u1',
                disposalStatus: 'active',
                disposalBatchId: null,
                legalHold: false,
                ruleProvenanceStatus: 'legacy_unverified',
                klasifikasiArsipId: null,
                klasifikasiRuleSetId: null,
                jraItemId: null,
                jraRuleSetId: null,
                retentionTriggerDate: '2020-01-31',
            };
            const appended = {
                archive: {
                    ...legacyArchive,
                    ...canonicalAssignment.cache,
                    currentRuleSnapshotId: 'snapshot-2',
                },
                snapshot: { id: 'snapshot-2', revision: 2 },
            };
            enqueue([legacyArchive]);
            vi.mocked(archiveRuleAssignmentService.appendRevision)
                .mockResolvedValue(appended as any);

            const result = await svc.reconcileRules(
                'archive-1',
                'u1',
                { klasifikasiItemId: 10, jraItemId: 20 },
                'Verifikasi ulang terhadap peraturan aktif',
                'user-1',
            );

            expect(result).toEqual(appended);
            expect(archiveRuleAssignmentService.resolveActive).toHaveBeenCalledWith(
                mockDb,
                { klasifikasiItemId: 10, jraItemId: 20 },
            );
            expect(archiveRuleAssignmentService.appendRevision).toHaveBeenCalledWith(
                mockDb,
                'archive-1',
                canonicalAssignment,
                'Verifikasi ulang terhadap peraturan aktif',
                '2020-01-31',
                'user-1',
            );
        });

        it('rejects an unchanged verified assignment without appending duplicate evidence', async () => {
            enqueue([{
                id: 'archive-1',
                unitKerjaId: 'u1',
                disposalStatus: 'active',
                disposalBatchId: null,
                legalHold: false,
                ruleProvenanceStatus: 'verified',
                klasifikasiArsipId: canonicalAssignment.cache.klasifikasiArsipId,
                klasifikasiRuleSetId: canonicalAssignment.cache.klasifikasiRuleSetId,
                jraItemId: canonicalAssignment.cache.jraItemId,
                jraRuleSetId: canonicalAssignment.cache.jraRuleSetId,
                retentionTriggerDate: '2020-01-31',
            }]);

            await expect(svc.reconcileRules(
                'archive-1',
                'u1',
                { klasifikasiItemId: 10, jraItemId: 20 },
                'Tidak ada perubahan butir peraturan',
                'user-1',
            )).rejects.toThrow(/sudah menggunakan butir/i);

            expect(archiveRuleAssignmentService.appendRevision).not.toHaveBeenCalled();
        });

        it('fails before database access when the reconciliation reason is not meaningful', async () => {
            await expect(svc.reconcileRules(
                'archive-1',
                'u1',
                { klasifikasiItemId: 10, jraItemId: 20 },
                'singkat',
                'user-1',
            )).rejects.toThrow(/minimal 10 karakter/i);

            expect(resultQueue).toHaveLength(0);
            expect(archiveRuleAssignmentService.resolveActive).not.toHaveBeenCalled();
        });

        it('does not reconcile records already under legal hold or disposition workflow', async () => {
            enqueue([{
                id: 'archive-1',
                unitKerjaId: 'u1',
                disposalStatus: 'active',
                disposalBatchId: null,
                legalHold: true,
            }]);

            await expect(svc.reconcileRules(
                'archive-1',
                'u1',
                { klasifikasiItemId: 10, jraItemId: 20 },
                'Koreksi berdasarkan pemeriksaan petugas',
                'user-1',
            )).rejects.toThrow(/legal hold|workflow penyusutan/i);

            expect(archiveRuleAssignmentService.resolveActive).not.toHaveBeenCalled();
            expect(archiveRuleAssignmentService.appendRevision).not.toHaveBeenCalled();
        });
    });

    // ── update ──
    describe('update', () => {
        it('should update and return arsip', async () => {
            enqueue(
                [{
                    id: '1',
                    disposalStatus: 'active',
                    disposalBatchId: null,
                    legalHold: false,
                }],
                [{ id: '1', keterangan: 'updated' }],
            );
            const res = await svc.update('1', { keterangan: 'updated' } as any);
            expect(res.keterangan).toBe('updated');
        });

        it('should allow non-retention metadata while an archive is held or in a batch', async () => {
            enqueue(
                [{
                    id: '1',
                    disposalStatus: 'approved',
                    disposalBatchId: 'batch-1',
                    legalHold: true,
                }],
                [{ id: '1', keterangan: 'Koreksi deskripsi' }],
            );

            const result = await svc.update('1', { keterangan: 'Koreksi deskripsi' } as any);

            expect(result.keterangan).toBe('Koreksi deskripsi');
        });

        it('should block retention and JRA decisions while legal hold is active', async () => {
            enqueue([{
                id: '1',
                disposalStatus: 'active',
                disposalBatchId: null,
                legalHold: true,
            }]);

            await expect(svc.update('1', { jraVersion: 'JRA-2026-v2' } as any))
                .rejects.toThrow(/rekonsiliasi aturan/i);
        });

        it('should block retention and JRA decisions after entering a disposal batch', async () => {
            enqueue([{
                id: '1',
                disposalStatus: 'active',
                disposalBatchId: 'batch-1',
                legalHold: false,
            }]);

            await expect(svc.update('1', { hasilAkhir: 'Permanen' } as any))
                .rejects.toThrow(/rekonsiliasi aturan/i);
        });

        it('should block retention and JRA decisions in a non-active disposal state', async () => {
            enqueue([{
                id: '1',
                disposalStatus: 'proposed',
                disposalBatchId: null,
                legalHold: false,
            }]);

            await expect(svc.update('1', { retentionTriggerDate: '2026-01-01' } as any))
                .rejects.toThrow(/workflow penyusutan/i);
        });

        it('should make an executed archive immutable', async () => {
            enqueue([{
                id: '1',
                disposalStatus: 'executed',
                disposalBatchId: 'batch-1',
                legalHold: false,
            }]);

            await expect(svc.update('1', { keterangan: 'Tidak boleh berubah' } as any))
                .rejects.toThrow(/immutable/i);
        });

        it('should reject direct mutation of workflow-managed fields', async () => {
            await expect(svc.update('1', { legalHold: true } as any))
                .rejects.toThrow(/workflow khusus/i);
        });

        it('should reject forged canonical rule hashes through the generic update path', async () => {
            await expect(svc.update('1', {
                klasifikasiSnapshotHash: 'attacker-controlled-hash',
                retentionDecisionHash: 'attacker-controlled-decision',
            } as any)).rejects.toThrow(/rekonsiliasi aturan/i);

            expect(resultQueue).toHaveLength(0);
        });

        it('should derive expiry when a documented trigger changes, without changing canonical JRA', async () => {
            enqueue(
                [{
                    id: '1',
                    disposalStatus: 'active',
                    disposalBatchId: null,
                    legalHold: false,
                    retentionTriggerType: 'berkas_ditutup',
                    retentionTriggerLabel: 'Berkas perkara ditutup',
                    retentionTriggerDate: '2020-01-15',
                    retentionTriggerEvidence: 'Berita acara penutupan nomor 1/2020',
                    retensiAktif: '2 tahun',
                    retensiInaktif: '3 tahun',
                }],
                [{ id: '1', retentionTriggerDate: '2021-01-15', tanggalKadaluarsa: '2026-01-15' }],
            );

            await svc.update('1', {
                retentionTriggerType: 'berkas_ditutup',
                retentionTriggerLabel: 'Berkas perkara ditutup ulang',
                retentionTriggerDate: '2021-01-15',
                retentionTriggerEvidence: 'Berita acara koreksi nomor 2/2021',
            } as any);

            expect(capturedSets[0]).toMatchObject({
                retentionTriggerDate: '2021-01-15',
                tanggalKadaluarsa: '2026-01-15',
            });
        });

        it('should require evidence when adding a retention trigger', async () => {
            enqueue([{
                id: '1',
                disposalStatus: 'active',
                disposalBatchId: null,
                legalHold: false,
                retentionTriggerDate: null,
            }]);

            await expect(svc.update('1', { retentionTriggerDate: '2026-01-01' } as any))
                .rejects.toThrow(/bukti pendukung/i);
        });
    });

    // ── delete ──
    describe('delete', () => {
        it('should always require the formal penyusutan workflow', async () => {
            await expect(svc.delete('1')).rejects.toThrow(/workflow penyusutan/i);
        });
    });

    // ── Pure function: parseRetentionPeriod ──
    describe('parseRetentionPeriod', () => {
        it('should parse "2 tahun" to 2', () => {
            expect(svc.parseRetentionPeriod('2 tahun')).toBe(2);
        });

        it('should parse "5 Tahun" (case-insensitive)', () => {
            expect(svc.parseRetentionPeriod('5 Tahun')).toBe(5);
        });

        it('should parse "10 tahun"', () => {
            expect(svc.parseRetentionPeriod('10 tahun')).toBe(10);
        });

        it('should parse "1 tahun"', () => {
            expect(svc.parseRetentionPeriod('1 tahun')).toBe(1);
        });

        it('should return 0 for null', () => {
            expect(svc.parseRetentionPeriod(null)).toBe(0);
        });

        it('should return 0 for empty string', () => {
            expect(svc.parseRetentionPeriod('')).toBe(0);
        });

        it('should return 0 for invalid format', () => {
            expect(svc.parseRetentionPeriod('abc')).toBe(0);
        });
    });

    // ── Pure function: calculateRetentionDates ──
    describe('calculateRetentionDates', () => {
        it('should calculate active and inactive end dates from the explicit trigger', () => {
            const result = svc.calculateRetentionDates('2020-01-15', '2 tahun', '3 tahun');
            expect(result.tanggalAktifBerakhir).toBe('2022-01-15');
            expect(result.tanggalInaktifBerakhir).toBe('2025-01-15');
            expect(result.tanggalKadaluarsa).toBe('2025-01-15');
        });

        it('should handle null active retention', () => {
            const result = svc.calculateRetentionDates('2020-01-15', null, '5 tahun');
            expect(result.tanggalAktifBerakhir).toBeNull();
            expect(result.tanggalInaktifBerakhir).toBe('2025-01-15');
        });

        it('should handle both retentions as null', () => {
            const result = svc.calculateRetentionDates('2020-01-15', null, null);
            expect(result.tanggalAktifBerakhir).toBeNull();
            expect(result.tanggalInaktifBerakhir).toBeNull();
            // No parsable retention means no expiry date at all, not "expired on day one"
            expect(result.tanggalKadaluarsa).toBeNull();
        });

        it('should never calculate an expiry without a retention trigger', () => {
            const result = svc.calculateRetentionDates(null, '2 tahun', '3 tahun');
            expect(result.tanggalAktifBerakhir).toBeNull();
            expect(result.tanggalInaktifBerakhir).toBeNull();
            expect(result.tanggalKadaluarsa).toBeNull();
        });

        it('should handle only active retention (no inactive)', () => {
            const result = svc.calculateRetentionDates('2020-06-01', '3 tahun', null);
            expect(result.tanggalAktifBerakhir).toBe('2023-06-01');
            expect(result.tanggalInaktifBerakhir).toBe('2023-06-01');
            expect(result.tanggalKadaluarsa).toBe('2023-06-01');
        });
    });

    // ── Pure function: getArchiveStatus ──
    describe('getArchiveStatus', () => {
        it('should return "aktif" for archive within active period', () => {
            const farFuture = `${new Date().getFullYear() + 10}-01-01`;
            expect(svc.getArchiveStatus(farFuture, '20 tahun', '10 tahun')).toBe('aktif');
        });

        it('should return "kadaluarsa" for expired archive', () => {
            expect(svc.getArchiveStatus('2000-01-01', '1 tahun', '1 tahun')).toBe('kadaluarsa');
        });

        it('should return "inaktif" for archive in inactive period', () => {
            const twoYearsAgo = new Date();
            twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
            const dateStr = twoYearsAgo.toISOString().split('T')[0];
            expect(svc.getArchiveStatus(dateStr, '1 tahun', '10 tahun')).toBe('inaktif');
        });

        it('should return "aktif" when no active retention is set', () => {
            expect(svc.getArchiveStatus('2020-01-01', null, null)).toBe('aktif');
        });

        it('should return an undetermined status when the trigger is missing', () => {
            expect(svc.getArchiveStatus(null, '1 tahun', '1 tahun')).toBe('belum_ditentukan');
        });
    });

    describe('archiveFromSuratMasuk retention trigger', () => {
        it('rechecks deleted/archived state after locking the incoming source', async () => {
            enqueue([{
                id: 'sm-1',
                unitKerjaId: 'u1',
                isDeleted: true,
                isArchived: false,
            }]);

            await expect(svc.archiveFromSuratMasuk(
                'sm-1',
                {} as any,
                'u1',
            )).rejects.toThrow(/surat masuk/i);

            expect(archiveRuleAssignmentService.resolveActive).not.toHaveBeenCalled();

            enqueue([{
                id: 'sm-2',
                unitKerjaId: 'u1',
                isDeleted: false,
                isArchived: true,
            }]);

            await expect(svc.archiveFromSuratMasuk(
                'sm-2',
                {} as any,
                'u1',
            )).rejects.toThrow(/sudah diarsipkan/i);

            expect(archiveRuleAssignmentService.resolveActive).not.toHaveBeenCalled();
        });

        it('fails closed if the source unit changes after route authorization', async () => {
            enqueue([{
                id: 'sm-1',
                unitKerjaId: 'unit-b',
                isDeleted: false,
                isArchived: false,
            }]);

            await expect(svc.archiveFromSuratMasuk(
                'sm-1',
                {} as any,
                'unit-a',
            )).rejects.toThrow(/surat masuk/i);

            expect(archiveRuleAssignmentService.resolveActive).not.toHaveBeenCalled();
        });

        it('should not infer retention expiry from the letter/archive date', async () => {
            enqueue([
                { id: 'sm-1', unitKerjaId: 'u1', tahun: 2020, tanggalSurat: '2020-01-15', nomorSurat: '1/2020', perihal: 'Test' },
            ]);
            enqueue([]); // duplicate check
            enqueue([{ id: 'a1' }]); // inserted archive
            enqueue([]); // mark source as archived

            await svc.archiveFromSuratMasuk('sm-1', {
                retensiAktif: '2 tahun',
                retensiInaktif: '3 tahun',
                tanggalArsip: '2020-01-15',
            });

            expect(capturedValues[0].tanggalArsip).toBe('2020-01-15');
            expect(capturedValues[0].retentionTriggerDate).toBeUndefined();
            expect(capturedValues[0].tanggalKadaluarsa).toBeNull();
        });

        it('should derive expiry from a documented trigger instead', async () => {
            enqueue([
                { id: 'sm-1', unitKerjaId: 'u1', tahun: 2020, tanggalSurat: '2020-01-15', nomorSurat: '1/2020', perihal: 'Test' },
            ]);
            enqueue([]);
            enqueue([{ id: 'a1' }]);
            enqueue([]);

            await svc.archiveFromSuratMasuk('sm-1', {
                retensiAktif: '2 tahun',
                retensiInaktif: '3 tahun',
                retentionTriggerType: 'serah_terima',
                retentionTriggerLabel: 'BAST final',
                retentionTriggerDate: '2021-06-30',
                retentionTriggerEvidence: 'BAST Nomor 12/2021 tanggal 30 Juni 2021',
            });

            expect(capturedValues[0].tanggalKadaluarsa).toBe('2026-06-30');
            expect(capturedValues[0].tanggalKadaluarsa).not.toBe('2025-01-15');
        });
    });

    describe('archiveFromSuratKeluar transaction authorization', () => {
        it('rechecks source mutability and authorized unit after acquiring the row lock', async () => {
            enqueue([{
                id: 'sk-1',
                unitKerjaId: 'unit-b',
                isDeleted: false,
                isArchived: false,
            }]);

            await expect(svc.archiveFromSuratKeluar(
                'sk-1',
                {} as any,
                'unit-a',
            )).rejects.toThrow(/surat keluar/i);

            expect(archiveRuleAssignmentService.resolveActive).not.toHaveBeenCalled();
        });
    });

    describe('getDisposalCandidates', () => {
        it('should exclude legal holds and archives without an explicit trigger', async () => {
            enqueue([
                {
                    id: 'eligible', unitKerjaId: 'u1', disposalStatus: 'active', legalHold: false,
                    retentionTriggerDate: '2000-01-01', retensiAktif: '1 tahun', retensiInaktif: '1 tahun',
                    hasilAkhir: 'Musnah',
                },
                {
                    id: 'held', unitKerjaId: 'u1', disposalStatus: 'active', legalHold: true,
                    retentionTriggerDate: '2000-01-01', retensiAktif: '1 tahun', retensiInaktif: '1 tahun',
                    hasilAkhir: 'Musnah',
                },
                {
                    id: 'missing-trigger', unitKerjaId: 'u1', disposalStatus: 'active', legalHold: false,
                    retentionTriggerDate: null, retensiAktif: '1 tahun', retensiInaktif: '1 tahun',
                    hasilAkhir: 'Musnah',
                },
            ]);

            const result = await svc.getDisposalCandidates('u1');
            expect(result.data.map(item => item.id)).toEqual(['eligible']);
        });
    });

    describe('getLifecycleNotifications', () => {
        it('reports held and missing-trigger records without treating them as actionable', async () => {
            enqueue([
                { id: 'held', legalHold: true, retentionTriggerDate: '2000-01-01', retensiAktif: '1 tahun', retensiInaktif: '1 tahun' },
                { id: 'missing-trigger', legalHold: false, ruleProvenanceStatus: 'verified', retentionTriggerDate: null, retensiAktif: '1 tahun', retensiInaktif: '1 tahun' },
                { id: 'expired', legalHold: false, ruleProvenanceStatus: 'verified', retentionTriggerDate: '2000-01-01', retensiAktif: '1 tahun', retensiInaktif: '1 tahun' },
            ]);

            const result = await svc.getLifecycleNotifications('u1');
            expect(result.summary).toMatchObject({ held: 1, missingTrigger: 1, expired: 1 });
            expect(result.expired.map(item => item.id)).toEqual(['expired']);
        });
    });

    describe('legal hold', () => {
        it('should require a meaningful reason', async () => {
            await expect(svc.placeLegalHold('a1', 'u1', 'singkat', 'user-1'))
                .rejects.toThrow(/minimal 10 karakter/);
        });

        it('should place a unit-scoped legal hold', async () => {
            enqueue([{ id: 'a1', unitKerjaId: 'u1', legalHold: false }]);
            enqueue([{ id: 'a1', unitKerjaId: 'u1', legalHold: true, legalHoldReason: 'Pemeriksaan masih berjalan' }]);

            const result = await svc.placeLegalHold('a1', 'u1', 'Pemeriksaan masih berjalan', 'user-1');
            expect(result.after.legalHold).toBe(true);
            expect(result.after.legalHoldReason).toBe('Pemeriksaan masih berjalan');
        });

        it('should fail if disposal finishes before the conditional hold update', async () => {
            enqueue([{ id: 'a1', unitKerjaId: 'u1', legalHold: false, disposalStatus: 'approved' }]);
            enqueue([]); // disposal became executed while the hold update waited for its row lock

            await expect(svc.placeLegalHold(
                'a1',
                'u1',
                'Perkara hukum masih berlangsung',
                'user-1',
            )).rejects.toThrow(/Status legal hold berubah/);
        });
    });

    // ── getStats ──
    describe('getStats', () => {
        it('should return archive statistics', async () => {
            const stats = { total: 100, arsipMasuk: 60, arsipKeluar: 40 };
            enqueue([stats]);
            expect(await svc.getStats('u1', 2026)).toEqual(stats);
        });

        it('should work without year filter', async () => {
            const stats = { total: 200, arsipMasuk: 120, arsipKeluar: 80 };
            enqueue([stats]);
            expect(await svc.getStats('u1')).toEqual(stats);
        });
    });
});
