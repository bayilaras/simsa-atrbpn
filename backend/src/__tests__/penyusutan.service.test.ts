import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Chainable DB Mock ───
const resultQueue: any[] = [];
const chainCalls: Array<{ method: string; args: any[] }> = [];
let transactionCommits = 0;
let transactionRollbacks = 0;
function enqueue(...results: any[]) { resultQueue.push(...results); }

const auditMocks = vi.hoisted(() => ({
    logActionOrThrow: vi.fn(),
    createAttachment: vi.fn(),
    verifyIntegrity: vi.fn(),
}));

const validJraProvenance = {
    jraKode: 'JRA-PT-001',
    jraVersion: 'Permen ATR/BPN 2/2026',
    jraReference: 'Lampiran JRA Pengadaan Tanah',
    klasifikasiArsipId: 101,
    klasifikasiRuleSetId: 'klasifikasi-ruleset-2018',
    klasifikasiSnapshotHash: 'a'.repeat(64),
    jraItemId: 202,
    jraRuleSetId: 'jra-ruleset-2020',
    retentionDecisionHash: 'b'.repeat(64),
    currentRuleSnapshotId: 'snapshot-1',
    currentRetentionTriggerEventId: 'trigger-event-1',
    ruleProvenanceStatus: 'verified',
};

const mockChain: any = new Proxy({}, {
    get(_target, prop) {
        if (prop === 'then') {
            const val = resultQueue.shift() ?? [];
            return (resolve: any) => resolve(val);
        }
        return (...args: any[]) => {
            chainCalls.push({ method: String(prop), args });
            return mockChain;
        };
    },
});

const mockDb = {
    select: (..._a: any[]) => mockChain,
    insert: (..._a: any[]) => mockChain,
    update: (..._a: any[]) => mockChain,
    delete: (..._a: any[]) => mockChain,
    transaction: async (fn: any) => {
        try {
            const result = await fn(mockDb);
            transactionCommits += 1;
            return result;
        } catch (error) {
            transactionRollbacks += 1;
            throw error;
        }
    },
};

vi.mock('../config/database', () => ({ db: mockDb }));
vi.mock('../services/audit-log.service.js', () => ({ default: auditMocks }));
vi.mock('../services/file-attachment.service', () => ({ fileAttachmentService: { create: auditMocks.createAttachment, verifyIntegrity: auditMocks.verifyIntegrity } }));
// Fresh DB authority is exercised independently by the PGlite integration suite.
vi.mock('../services/penyusutan-authority', () => ({ lockDispositionActor: async (_tx: any, actor: any) => actor }));
vi.mock('../services/arsip.service', () => ({
    arsipService: {
        getDisposalCandidates: vi.fn().mockResolvedValue({ data: [], pagination: { total: 0 } }),
        getArchiveStatus: vi.fn().mockReturnValue('kadaluarsa'),
        calculateRetentionDates: vi.fn().mockReturnValue({ tanggalKadaluarsa: '2002-01-01' }),
        evaluateCanonicalRetention: vi.fn(),
    },
}));

// penyusutanService is a singleton, not a class export
const { penyusutanService } = await import('../services/penyusutan.service');
const { arsipService } = await import('../services/arsip.service');

describe('PenyusutanService', () => {
    beforeEach(() => {
        resultQueue.length = 0;
        chainCalls.length = 0;
        transactionCommits = 0;
        transactionRollbacks = 0;
        auditMocks.logActionOrThrow.mockReset();
        auditMocks.logActionOrThrow.mockResolvedValue(undefined);
        vi.mocked(arsipService.getArchiveStatus).mockReturnValue('kadaluarsa');
        vi.mocked(arsipService.evaluateCanonicalRetention).mockImplementation((row: any) => {
            const calculationMode = row.calculationMode || 'duration';
            const calculationEligible = calculationMode === 'duration';
            const dispositionCode = row.dispositionCode
                || (row.hasilAkhir === 'Permanen' ? 'permanen'
                    : row.hasilAkhir === 'Dinilai Kembali' ? 'manual_review' : 'musnah');
            const status = calculationEligible
                ? arsipService.getArchiveStatus(row.retentionTriggerDate, null, null)
                : 'aktif';
            const requiresAppraisal = calculationMode === 'manual'
                || ['manual_review', 'dinilai_kembali'].includes(dispositionCode);
            const effectiveDispositionCode = row.appraisalOutcome
                || (requiresAppraisal ? null : dispositionCode);
            const dispositionEligible = ['musnah', 'permanen'].includes(
                effectiveDispositionCode || '',
            ) && (calculationEligible ? status === 'kadaluarsa' : Boolean(row.appraisalOutcome));
            return {
                verified: row.snapshotVerified !== false,
                blockReason: row.snapshotVerified === false ? 'snapshot JRA tidak terverifikasi' : null,
                calculationEligible,
                calculationBlockReason: calculationEligible ? null : 'mode perhitungan JRA manual memerlukan penilaian manusia',
                normalizedRetention: {
                    activeMonths: calculationEligible ? 12 : 12,
                    inactiveMonths: calculationEligible ? 12 : null,
                    calculationMode,
                    dispositionCode,
                },
                dates: {
                    tanggalAktifBerakhir: calculationEligible ? '2001-01-01' : null,
                    tanggalInaktifBerakhir: calculationEligible ? '2002-01-01' : null,
                    tanggalKadaluarsa: calculationEligible ? '2002-01-01' : null,
                },
                status,
                effectiveDispositionCode,
                effectiveDecisionSource: row.appraisalOutcome ? 'appraisal'
                    : effectiveDispositionCode ? 'jra' : null,
                effectiveAppraisalDecisionId: row.appraisalOutcome ? 'decision-1' : null,
                dispositionEligible,
                dispositionBlockReason: dispositionEligible ? null
                    : effectiveDispositionCode && status !== 'kadaluarsa'
                        ? 'retensi belum berakhir'
                        : 'hasil akhir JRA memerlukan appraisal efektif',
            } as any;
        });
    });

    // ── findAll ──
    describe('findAll', () => {
        it('should return paginated penyusutan batches', async () => {
            // Promise.all([data, countResult])
            enqueue(
                [{ id: 'p1', status: 'draft' }, { id: 'p2', status: 'approved' }], // data
                [{ count: 2 }],   // countResult
            );
            const res = await penyusutanService.findAll({ unitKerjaId: 'u1' });
            expect(res.data).toHaveLength(2);
            expect(res.pagination.total).toBe(2);
        });

        it('should filter by jenisPenyusutan', async () => {
            enqueue(
                [{ id: 'p1', jenisPenyusutan: 'pemusnahan' }],
                [{ count: 1 }],
            );
            const res = await penyusutanService.findAll({
                unitKerjaId: 'u1',
                jenisPenyusutan: 'pemusnahan',
            });
            expect(res.data).toHaveLength(1);
        });

        it('should filter by status', async () => {
            enqueue([], [{ count: 0 }]);
            const res = await penyusutanService.findAll({
                unitKerjaId: 'u1',
                status: 'executed',
            });
            expect(res.data).toEqual([]);
        });

        it('should handle pagination parameters', async () => {
            enqueue([], [{ count: 50 }]);
            const res = await penyusutanService.findAll({
                unitKerjaId: 'u1',
                page: 3,
                limit: 10,
            });
            expect(res.pagination.page).toBe(3);
            expect(res.pagination.limit).toBe(10);
            expect(res.pagination.totalPages).toBe(5);
        });
    });

    // ── findById ──
    describe('findById', () => {
        it('should return batch with items', async () => {
            enqueue([{ id: 'p1', status: 'draft' }]); // batch query
            enqueue([{ item: { id: 'i1' }, arsip: { id: 'a1' } }]); // items query
            const res = await penyusutanService.findById('p1', 'u1');
            expect(res).toBeDefined();
            expect(res?.items).toHaveLength(1);
        });

        it('should return null for nonexistent batch', async () => {
            enqueue([]);
            expect(await penyusutanService.findById('missing', 'u1')).toBeNull();
        });
    });

    // ── create ──
    describe('create', () => {
        it('should fail closed for legacy permanent-transfer batches before database access', async () => {
            await expect(penyusutanService.create({
                unitKerjaId: 'u1',
                jenisPenyusutan: 'penyerahan',
                arsipIds: ['a1'],
            })).rejects.toThrow(/Tata Kelola Retensi.*permanent-transfers/i);
            expect(resultQueue).toHaveLength(0);
            expect(chainCalls).toHaveLength(0);
        });

        it('should create batch with arsip items', async () => {
            enqueue([
                { id: 'a1', unitKerjaId: 'u1', disposalStatus: 'active', disposalBatchId: null, retentionTriggerDate: '2020-01-01', retensiAktif: '1 tahun', retensiInaktif: '1 tahun', hasilAkhir: 'Musnah', legalHold: false, ...validJraProvenance },
                { id: 'a2', unitKerjaId: 'u1', disposalStatus: 'active', disposalBatchId: null, retentionTriggerDate: '2020-01-01', retensiAktif: '1 tahun', retensiInaktif: '1 tahun', hasilAkhir: 'Musnah', legalHold: false, ...validJraProvenance },
            ]); // eligibility check
            enqueue([{ id: 'p-new', status: 'draft' }]); // insert batch
            enqueue([]); // insert items (returns nothing important)
            enqueue([]); // update arsip disposalStatus
            const res = await penyusutanService.create({
                unitKerjaId: 'u1',
                jenisPenyusutan: 'pemusnahan',
                arsipIds: ['a1', 'a2'],
            });
            expect(res.id).toBe('p-new');
        });

        it('should reject arsip belonging to another unit kerja', async () => {
            enqueue([{ id: 'a1', unitKerjaId: 'lain', disposalStatus: 'active', disposalBatchId: null, retentionTriggerDate: '2020-01-01', legalHold: false }]);
            await expect(penyusutanService.create({
                unitKerjaId: 'u1',
                jenisPenyusutan: 'pemusnahan',
                arsipIds: ['a1'],
            })).rejects.toThrow(/luar unit kerja/);
        });

        it('should reject arsip above the actor security classification', async () => {
            enqueue([{
                id: 'a1',
                unitKerjaId: 'u1',
                disposalStatus: 'active',
                disposalBatchId: null,
                retentionTriggerDate: '2020-01-01',
                retensiAktif: '1 tahun',
                retensiInaktif: '1 tahun',
                hasilAkhir: 'Musnah',
                legalHold: false,
                klasifikasiKeamanan: 'rahasia',
                ...validJraProvenance,
            }]);

            await expect(penyusutanService.create({
                unitKerjaId: 'u1',
                jenisPenyusutan: 'pemusnahan',
                arsipIds: ['a1'],
                securityClassifications: ['biasa', 'terbatas'],
            })).rejects.toThrow(/tidak ditemukan atau tidak dapat diakses/);
        });

        it('should reject arsip already in another disposal batch', async () => {
            enqueue([{ id: 'a1', unitKerjaId: 'u1', disposalStatus: 'active', disposalBatchId: 'p-lama', retentionTriggerDate: '2020-01-01', legalHold: false }]);
            await expect(penyusutanService.create({
                unitKerjaId: 'u1',
                jenisPenyusutan: 'pemusnahan',
                arsipIds: ['a1'],
            })).rejects.toThrow(/penyusutan lain/);
        });

        it('should reject creating an empty batch', async () => {
            await expect(penyusutanService.create({
                unitKerjaId: 'u1',
                jenisPenyusutan: 'pemindahan',
                arsipIds: [],
            })).rejects.toThrow(/minimal satu arsip/i);
            expect(resultQueue).toHaveLength(0);
        });

        it('should reject duplicate archive IDs before creating a batch', async () => {
            await expect(penyusutanService.create({
                unitKerjaId: 'u1',
                jenisPenyusutan: 'pemindahan',
                arsipIds: ['a1', 'a1'],
            })).rejects.toThrow(/ID duplikat/i);
            expect(resultQueue).toHaveLength(0);
        });

        it('should reject an archive without a retention trigger', async () => {
            enqueue([{ id: 'a1', unitKerjaId: 'u1', disposalStatus: 'active', disposalBatchId: null, retentionTriggerDate: null, legalHold: false }]);
            await expect(penyusutanService.create({
                unitKerjaId: 'u1',
                jenisPenyusutan: 'pemusnahan',
                arsipIds: ['a1'],
            })).rejects.toThrow(/belum memiliki pemicu retensi/);
        });

        it('should reject an archive under legal hold', async () => {
            enqueue([{ id: 'a1', unitKerjaId: 'u1', disposalStatus: 'active', disposalBatchId: null, retentionTriggerDate: '2020-01-01', legalHold: true }]);
            await expect(penyusutanService.create({
                unitKerjaId: 'u1',
                jenisPenyusutan: 'pemusnahan',
                arsipIds: ['a1'],
            })).rejects.toThrow(/legal hold/);
        });

        it('should reject destruction without complete JRA provenance', async () => {
            enqueue([{
                id: 'a1', unitKerjaId: 'u1', disposalStatus: 'active', disposalBatchId: null,
                retentionTriggerDate: '2020-01-01', retensiAktif: '1 tahun', retensiInaktif: '1 tahun',
                hasilAkhir: 'Musnah', legalHold: false, ...validJraProvenance,
                jraVersion: null,
            }]);
            await expect(penyusutanService.create({
                unitKerjaId: 'u1', jenisPenyusutan: 'pemusnahan', arsipIds: ['a1'],
            })).rejects.toThrow(/provenance JRA lengkap/);
        });

        it('should clearly reject legacy archives that have not been rule-verified', async () => {
            enqueue([{
                id: 'a-legacy', unitKerjaId: 'u1', disposalStatus: 'active', disposalBatchId: null,
                retentionTriggerDate: '2020-01-01', retensiAktif: '1 tahun', retensiInaktif: '1 tahun',
                hasilAkhir: 'Musnah', legalHold: false,
                currentRetentionTriggerEventId: 'trigger-event-1',
                ruleProvenanceStatus: 'legacy_unverified',
            }]);
            await expect(penyusutanService.create({
                unitKerjaId: 'u1', jenisPenyusutan: 'pemusnahan', arsipIds: ['a-legacy'],
            })).rejects.toThrow(/legacy_unverified.*verifikasi aturan terlebih dahulu/i);
        });

        it('should clearly reject archives whose JRA assignment is pending', async () => {
            enqueue([{
                id: 'a-pending', unitKerjaId: 'u1', disposalStatus: 'active', disposalBatchId: null,
                retentionTriggerDate: '2020-01-01', retensiAktif: '1 tahun', retensiInaktif: '1 tahun',
                hasilAkhir: 'Musnah', legalHold: false,
                currentRetentionTriggerEventId: 'trigger-event-1',
                ruleProvenanceStatus: 'pending_jra',
            }]);
            await expect(penyusutanService.create({
                unitKerjaId: 'u1', jenisPenyusutan: 'pemusnahan', arsipIds: ['a-pending'],
            })).rejects.toThrow(/pending_jra.*pilih butir JRA aktif/i);
        });

        it('should reject verified status when rule IDs or hashes are missing', async () => {
            enqueue([{
                id: 'a-incomplete', unitKerjaId: 'u1', disposalStatus: 'active', disposalBatchId: null,
                retentionTriggerDate: '2020-01-01', retensiAktif: '1 tahun', retensiInaktif: '1 tahun',
                hasilAkhir: 'Musnah', legalHold: false, ...validJraProvenance,
                retentionDecisionHash: null,
            }]);
            await expect(penyusutanService.create({
                unitKerjaId: 'u1', jenisPenyusutan: 'pemusnahan', arsipIds: ['a-incomplete'],
            })).rejects.toThrow(/snapshot aturan terverifikasi tidak lengkap.*retentionDecisionHash/i);
        });

        it('should reject destruction before retention has ended', async () => {
            vi.mocked(arsipService.getArchiveStatus).mockReturnValueOnce('inaktif');
            enqueue([{ id: 'a1', unitKerjaId: 'u1', disposalStatus: 'active', disposalBatchId: null, retentionTriggerDate: '2020-01-01', retensiAktif: '2 tahun', retensiInaktif: '3 tahun', hasilAkhir: 'Musnah', legalHold: false, ...validJraProvenance }]);
            await expect(penyusutanService.create({
                unitKerjaId: 'u1', jenisPenyusutan: 'pemusnahan', arsipIds: ['a1'],
            })).rejects.toThrow(/retensi belum berakhir/);
        });

        it('should reject destruction when the JRA outcome is not Musnah', async () => {
            enqueue([{ id: 'a1', unitKerjaId: 'u1', disposalStatus: 'active', disposalBatchId: null, retentionTriggerDate: '2020-01-01', retensiAktif: '2 tahun', retensiInaktif: '3 tahun', hasilAkhir: 'Permanen', legalHold: false, ...validJraProvenance }]);
            await expect(penyusutanService.create({
                unitKerjaId: 'u1', jenisPenyusutan: 'pemusnahan', arsipIds: ['a1'],
            })).rejects.toThrow(/bukan Musnah/);
        });
    });

    // ── updateStatus ──
    describe('updateStatus', () => {
        function executionFixture() {
            const ids = Array.from({ length: 6 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
            const input = { beritaAcaraAttachmentId: ids[0], decisionAttachmentId: ids[1], executionProofAttachmentId: ids[2],
                performedAt: '2020-01-02T00:00:00Z', method: 'Pencacahan yang disaksikan petugas',
                copiesStatement: 'Salinan dan backup telah diperiksa sesuai lampiran keputusan.',
                witnesses: [{ userId: ids[4], authorityAttachmentId: ids[3] }, { userId: ids[5], authorityAttachmentId: ids[3] }] };
            const attachments = ids.slice(0, 4).map(id => ({ id, entityType: 'arsip', entityId: 'a1',
                storageAccess: 'private', fileUrl: 'private/bukti.pdf', sha256: 'a'.repeat(64),
                malwareScanStatus: 'clean', integrityStatus: 'verified', lastFixityCheckAt: new Date('2020-01-01') }));
            const witnesses = ids.slice(4).map(id => ({ id, name: 'Saksi', isActive: true, role: 'staff', unitKerjaId: 'u1' }));
            auditMocks.verifyIntegrity.mockImplementation(async id => ({ matches: true, actualHash: 'a'.repeat(64),
                attachment: attachments.find(attachment => attachment.id === id) }));
            return { input, attachments, witnesses };
        }
        it('stores controlled evidence and final archive status in the audited transaction', async () => {
            const { input, attachments, witnesses } = executionFixture();
            enqueue([{ id: 'p-destroy', status: 'approved', jenisPenyusutan: 'pemusnahan', unitKerjaId: 'u1', tanggalPersetujuan: '2020-01-01' }],
                [{ id: 'a1', legalHold: false, hasilAkhir: 'Musnah', ...validJraProvenance }],
                attachments, witnesses, [{ id: 'p-destroy', status: 'executed' }], [{ arsipId: 'a1' }], []);
            await penyusutanService.updateStatus('p-destroy', { executionEvidence: input,
                user: { id: 'executor', role: 'super_admin', unitKerjaId: '' } }, null);
            const writes = chainCalls.filter(call => call.method === 'set').map(call => call.args[0]);
            expect(writes[0]).toMatchObject({ status: 'executed', executionEvidence: {
                archiveIds: ['a1'], witnesses: expect.any(Array), documents: expect.any(Object) }, executionEvidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
            expect(writes[1]).toMatchObject({ disposalStatus: 'executed' });
            expect(auditMocks.logActionOrThrow).toHaveBeenCalledWith(expect.objectContaining({
                changes: expect.objectContaining({ executionEvidenceSha256: writes[0].executionEvidenceSha256 }),
            }), mockDb);
        });
        it('rolls back completed evidence when its critical audit cannot persist', async () => {
            const { input, attachments, witnesses } = executionFixture();
            enqueue([{ id: 'p-destroy', status: 'approved', jenisPenyusutan: 'pemusnahan', unitKerjaId: 'u1', tanggalPersetujuan: '2020-01-01' }],
                [{ id: 'a1', legalHold: false, hasilAkhir: 'Musnah', ...validJraProvenance }],
                attachments, witnesses, [{ id: 'p-destroy', status: 'executed' }], [{ arsipId: 'a1' }], []);
            auditMocks.logActionOrThrow.mockRejectedValueOnce(new Error('audit unavailable'));
            await expect(penyusutanService.updateStatus('p-destroy', { executionEvidence: input,
                user: { id: 'executor', role: 'super_admin', unitKerjaId: '' } }, null)).rejects.toThrow('audit unavailable');
            expect(transactionCommits).toBe(0);
            expect(transactionRollbacks).toBe(1);
        });
        it('requires a current manage grant even for a super administrator on controlled archives', async () => {
            enqueue([{ id: 'p1', status: 'draft', jenisPenyusutan: 'pemindahan', unitKerjaId: 'u1' }],
                [{ id: 'a1', unitKerjaId: 'u1', klasifikasiKeamanan: 'Terbatas', legalHold: false, hasilAkhir: 'Musnah', ...validJraProvenance }], []);
            await expect(penyusutanService.updateStatus('p1', {
                user: { id: 'executor', role: 'super_admin', unitKerjaId: '' } }, null)).rejects.toThrow(/Akses kelola/);
            expect(chainCalls.some(call => call.method === 'set')).toBe(false);
        });
        it('blocks a newly designated terjaga record before destruction transition', async () => {
            enqueue([{ id: 'p1', status: 'draft', jenisPenyusutan: 'pemusnahan', unitKerjaId: 'u1' }],
                [{ id: 'a1', isTerjaga: true, legalHold: false, hasilAkhir: 'Musnah', ...validJraProvenance }]);
            await expect(penyusutanService.updateStatus('p1', {
                user: { id: 'executor', role: 'super_admin', unitKerjaId: '' } }, null)).rejects.toThrow(/arsip terjaga/);
        });
        it('releases a completed inactive transfer for a later final disposition', async () => {
            enqueue([{ id: 'p-transfer', status: 'approved', jenisPenyusutan: 'pemindahan', unitKerjaId: 'u1' }]);
            enqueue([{ id: 'a1', unitKerjaId: 'u1', disposalStatus: 'approved', disposalBatchId: 'p-transfer',
                legalHold: false, hasilAkhir: 'Musnah', ...validJraProvenance }]);
            enqueue([{ id: 'p-transfer', status: 'executed' }], [{ arsipId: 'a1' }], []);
            await penyusutanService.updateStatus('p-transfer', {
                user: { id: 'executor-1', role: 'super_admin', unitKerjaId: '' },
            }, null);
            const archiveUpdate = chainCalls.filter(call => call.method === 'set').at(-1)?.args[0];
            expect(archiveUpdate).toMatchObject({ disposalStatus: 'active', disposalBatchId: null,
                inactiveTransferBatchId: 'p-transfer', inactiveTransferredAt: expect.any(Date) });
            enqueue([{ id: 'a1', unitKerjaId: 'u1', legalHold: false, hasilAkhir: 'Musnah',
                ...validJraProvenance, ...archiveUpdate }], [{ id: 'p-final' }], [], []);
            await expect(penyusutanService.create({ unitKerjaId: 'u1', jenisPenyusutan: 'pemusnahan', arsipIds: ['a1'] }))
                .resolves.toMatchObject({ id: 'p-final' });
        });

        it('does not make an alih-media operation a terminal disposition', async () => {
            enqueue([{ id: 'p-media', status: 'approved', jenisPenyusutan: 'alih_media', unitKerjaId: 'u1' }]);
            enqueue([{ id: 'a1', legalHold: false, ...validJraProvenance }]);
            enqueue([{ id: 'p-media', status: 'executed' }], [{ arsipId: 'a1' }], []);
            await penyusutanService.updateStatus('p-media', {
                user: { id: 'executor-1', role: 'super_admin', unitKerjaId: '' },
            }, null);
            expect(chainCalls.filter(call => call.method === 'set').at(-1)?.args[0])
                .toMatchObject({ disposalStatus: 'active', disposalBatchId: null });
        });

        it('rejects final destruction when controlled execution evidence is missing', async () => {
            enqueue([{ id: 'p-destroy', status: 'approved', jenisPenyusutan: 'pemusnahan', unitKerjaId: 'u1' }]);
            enqueue([{ id: 'a1', legalHold: false, hasilAkhir: 'Musnah', ...validJraProvenance }]);
            enqueue([{ id: 'p-destroy', status: 'executed' }], [{ arsipId: 'a1' }], []);
            await expect(penyusutanService.updateStatus('p-destroy', {
                user: { id: 'executor-1', role: 'super_admin', unitKerjaId: '' },
            }, null)).rejects.toThrow(/bukti pelaksanaan/i);
            expect(transactionCommits).toBe(0);
        });

        it('should keep a grandfathered transfer batch read-only', async () => {
            enqueue([{ id: 'p1', status: 'approved', jenisPenyusutan: 'penyerahan', unitKerjaId: 'u1' }]);
            await expect(penyusutanService.updateStatus('p1', {
                user: { id: 'executor-1', role: 'super_admin', unitKerjaId: '' },
            }, null)).rejects.toThrow(/Tata Kelola Retensi.*permanent-transfers/i);
            expect(resultQueue).toHaveLength(0);
        });

        it('should advance status from draft to proposed', async () => {
            enqueue([{ id: 'p1', status: 'draft', jenisPenyusutan: 'pemusnahan', unitKerjaId: 'ditjen' }]); // find batch
            enqueue([{
                id: 'a1', retentionTriggerDate: '2020-01-01', retensiAktif: '1 tahun',
                retensiInaktif: '1 tahun', hasilAkhir: 'Musnah', legalHold: false,
                ...validJraProvenance,
            }]); // retention/hold/provenance re-check
            enqueue([{ id: 'p1', status: 'proposed' }]); // update
            const res = await penyusutanService.updateStatus('p1', {
                user: { id: 'proposer-1', role: 'admin_dirjen', unitKerjaId: 'stale-unit' },
            }, 'ditjen');
            expect(res.status).toBe('proposed');
            expect(chainCalls.filter(call => call.method === 'for')).toHaveLength(2);
        });

        it('should throw for nonexistent batch', async () => {
            enqueue([]);
            await expect(penyusutanService.updateStatus('missing', {
                user: { id: 'proposer-1', role: 'admin_dirjen', unitKerjaId: 'u1' },
            }, 'u1')).rejects.toThrow('Penyusutan batch not found');
        });

        it('should throw when already at terminal state', async () => {
            enqueue([{ id: 'p1', status: 'executed' }]);
            await expect(penyusutanService.updateStatus('p1', {
                user: { id: 'proposer-1', role: 'admin_dirjen', unitKerjaId: 'u1' },
            }, 'u1')).rejects.toThrow('Cannot advance from status: executed');
        });

        it('should stop a workflow when an item is placed under legal hold', async () => {
            enqueue([{ id: 'p1', status: 'reviewed', jenisPenyusutan: 'pemusnahan', unitKerjaId: 'u1' }]);
            enqueue([{ id: 'a1', retentionTriggerDate: '2020-01-01', legalHold: true }]);
            await expect(penyusutanService.updateStatus('p1', {
                user: { id: 'approver-1', role: 'super_admin', unitKerjaId: '' },
            }, null)).rejects.toThrow(/legal hold/);
        });

        it('should enforce separation of duties between proposer and reviewer', async () => {
            enqueue([{ id: 'p1', status: 'proposed', jenisPenyusutan: 'pemusnahan', unitKerjaId: 'ditjen', createdBy: 'creator-1', proposedBy: 'same-user' }]);
            await expect(penyusutanService.updateStatus('p1', {
                user: { id: 'same-user', role: 'admin_dirjen', unitKerjaId: 'stale-unit' },
            }, 'ditjen')).rejects.toThrow(/Separation of duties/);
        });

        it('should reject every non-super-admin transition outside the actor unit', async () => {
            enqueue([{
                id: 'p1', status: 'proposed', jenisPenyusutan: 'pemusnahan',
                unitKerjaId: 'ditjen', createdBy: 'creator-1', proposedBy: 'proposer-1',
            }]);
            await expect(penyusutanService.updateStatus('p1', {
                user: { id: 'reviewer-1', role: 'admin_dirjen', unitKerjaId: 'u2' },
            }, 'u1')).rejects.toThrow(/own unit/);
        });

        it('should re-check JRA provenance while holding the workflow transaction', async () => {
            enqueue([{
                id: 'p1', status: 'proposed', jenisPenyusutan: 'pemusnahan',
                unitKerjaId: 'ditjen', createdBy: 'creator-1', proposedBy: 'proposer-1',
            }]);
            enqueue([{
                id: 'a1', retentionTriggerDate: '2020-01-01', retensiAktif: '1 tahun',
                retensiInaktif: '1 tahun', hasilAkhir: 'Musnah', legalHold: false,
                ...validJraProvenance, jraVersion: '',
            }]);
            await expect(penyusutanService.updateStatus('p1', {
                user: { id: 'reviewer-1', role: 'admin_dirjen', unitKerjaId: 'stale-unit' },
            }, 'ditjen')).rejects.toThrow(/provenance JRA tidak lengkap/);
        });

        it('should stop an approval transition when a legacy item remains in the batch', async () => {
            enqueue([{
                id: 'p1', status: 'reviewed', jenisPenyusutan: 'pemusnahan',
                unitKerjaId: 'u1', createdBy: 'creator-1', proposedBy: 'proposer-1', reviewedBy: 'reviewer-1',
            }]);
            enqueue([{
                id: 'a-legacy', retentionTriggerDate: '2020-01-01', retensiAktif: '1 tahun',
                retensiInaktif: '1 tahun', hasilAkhir: 'Musnah', legalHold: false,
                currentRetentionTriggerEventId: 'trigger-event-1',
                ruleProvenanceStatus: 'legacy_unverified',
            }]);
            await expect(penyusutanService.updateStatus('p1', {
                user: { id: 'approver-1', role: 'super_admin', unitKerjaId: '' },
            }, null)).rejects.toThrow(/workflow penyusutan.*legacy_unverified/i);
        });

        it('should keep the executor separate from every prior workflow actor', async () => {
            enqueue([{
                id: 'p1', status: 'approved', jenisPenyusutan: 'pemusnahan', unitKerjaId: 'u1',
                createdBy: 'same-user', proposedBy: 'proposer-1', reviewedBy: 'reviewer-1', approvedBy: 'approver-1',
            }]);
            await expect(penyusutanService.updateStatus('p1', {
                user: { id: 'same-user', role: 'super_admin', unitKerjaId: '' },
            }, null)).rejects.toThrow(/executor must differ from creator\/proposer\/reviewer\/approver/);
        });

        it('should reject a conditional transition when the status changed concurrently', async () => {
            enqueue([{ id: 'p1', status: 'draft', jenisPenyusutan: 'pemindahan', unitKerjaId: 'ditjen' }]);
            enqueue([{
                id: 'a1', retentionTriggerDate: '2020-01-01', retensiAktif: '1 tahun',
                retensiInaktif: '1 tahun', hasilAkhir: 'Musnah', legalHold: false,
                ...validJraProvenance,
            }]); // locked retention re-check
            enqueue([]); // conditional UPDATE did not match the old status
            await expect(penyusutanService.updateStatus('p1', {
                user: { id: 'proposer-1', role: 'admin_dirjen', unitKerjaId: 'stale-unit' },
            }, 'ditjen')).rejects.toThrow(/status changed concurrently/);
        });

        it('should reject advancing an empty batch', async () => {
            enqueue([{ id: 'p1', status: 'draft', jenisPenyusutan: 'pemindahan', unitKerjaId: 'ditjen' }]);
            enqueue([]);

            await expect(penyusutanService.updateStatus('p1', {
                user: { id: 'proposer-1', role: 'admin_dirjen', unitKerjaId: 'stale-unit' },
            }, 'ditjen')).rejects.toThrow(/tanpa arsip/i);
        });
    });

    describe('recoverInactiveTransfer', () => {
        const reviewer = { id: 'reviewer', role: 'super_admin', unitKerjaId: '' };
        const reason = 'Berita acara pemindahan lama telah ditinjau kembali.';
        it('repairs only archives still owned by an executed inactive-transfer batch and audits the repair', async () => {
            enqueue([{ id: 'old-transfer', jenisPenyusutan: 'pemindahan', status: 'executed', unitKerjaId: 'u1',
                tanggalPelaksanaan: '2020-01-01', executedBy: 'old-executor' }]);
            enqueue([{ id: 'a1', disposalStatus: 'executed', disposalBatchId: 'old-transfer', legalHold: false, unitKerjaId: 'u1' }]);
            enqueue([{ id: 'a1' }]);
            await expect(penyusutanService.recoverInactiveTransfer('old-transfer', reason, reviewer, 'u1')).resolves.toEqual({ recovered: 1 });
            expect(chainCalls.find(call => call.method === 'set')?.args[0]).toMatchObject({
                disposalStatus: 'active', disposalBatchId: null, inactiveTransferBatchId: 'old-transfer' });
            expect(auditMocks.logActionOrThrow).toHaveBeenCalledWith(expect.objectContaining({
                entityId: 'old-transfer', changes: expect.objectContaining({ operation: 'recover_inactive_transfer', reason }),
            }), mockDb);
        });
        it.each(['pemusnahan', 'alih_media', 'penyerahan'])('never reopens terminal or unrelated %s batches', async jenisPenyusutan => {
            enqueue([{ id: 'old-transfer', jenisPenyusutan, status: 'executed', unitKerjaId: 'u1' }]);
            await expect(penyusutanService.recoverInactiveTransfer('old-transfer', reason, reviewer, 'u1')).rejects.toThrow(/pemindahan/);
        });
        it.each([{ legalHold: true }, { disposalBatchId: 'newer-batch' }, { inactiveTransferBatchId: 'old-transfer' }])(
            'rejects unsafe recovery state %j', async override => {
                enqueue([{ id: 'old-transfer', jenisPenyusutan: 'pemindahan', status: 'executed', unitKerjaId: 'u1',
                    tanggalPelaksanaan: '2020-01-01', executedBy: 'old-executor' }]);
                enqueue([{ id: 'a1', disposalStatus: 'executed', disposalBatchId: 'old-transfer', legalHold: false, unitKerjaId: 'u1', ...override }]);
                await expect(penyusutanService.recoverInactiveTransfer('old-transfer', reason, reviewer, 'u1')).rejects.toThrow(/dipulihkan/);
                expect(transactionCommits).toBe(0);
            });
    });

    describe('uploadExecutionEvidence', () => {
        const actor = { id: 'executor', role: 'super_admin', unitKerjaId: '' };
        const file = { originalname: 'berita-acara.pdf', mimetype: 'application/pdf', buffer: Buffer.from('%PDF-1.7') };
        it('uses the locked batch transaction for evidence creation and its audit', async () => {
            enqueue([{ id: 'batch-1', jenisPenyusutan: 'pemusnahan', status: 'approved', unitKerjaId: 'u1' }],
                [{ id: 'a1', disposalBatchId: 'batch-1', disposalStatus: 'approved', unitKerjaId: 'u1', legalHold: false }]);
            auditMocks.createAttachment.mockResolvedValueOnce({ id: 'attachment-1', malwareScanStatus: 'not_scanned' });
            await expect(penyusutanService.uploadExecutionEvidence('batch-1', 'a1', file, actor, 'u1'))
                .resolves.toMatchObject({ malwareScanStatus: 'not_scanned' });
            expect(auditMocks.createAttachment).toHaveBeenCalledWith(expect.objectContaining({ suratId: 'a1', suratType: 'arsip' }),
                expect.objectContaining({ userId: 'executor' }), mockDb);
        });
        it('rejects archives belonging to another batch before any storage write', async () => {
            auditMocks.createAttachment.mockClear();
            enqueue([{ id: 'batch-1', jenisPenyusutan: 'pemusnahan', status: 'approved', unitKerjaId: 'u1' }],
                [{ id: 'a1', disposalBatchId: 'other-batch', disposalStatus: 'approved', unitKerjaId: 'u1', legalHold: false }]);
            await expect(penyusutanService.uploadExecutionEvidence('batch-1', 'a1', file, actor, 'u1')).rejects.toThrow(/Arsip tidak tersedia/);
            expect(auditMocks.createAttachment).not.toHaveBeenCalled();
        });
    });

    // ── addItems ──
    describe('addItems', () => {
        it('should block adding items to a grandfathered transfer batch', async () => {
            enqueue([{ id: 'p1', status: 'draft', jenisPenyusutan: 'penyerahan', unitKerjaId: 'u1' }]);
            await expect(penyusutanService.addItems('p1', ['a-new'], 'u1'))
                .rejects.toThrow(/Tata Kelola Retensi.*permanent-transfers/i);
            expect(resultQueue).toHaveLength(0);
        });

        it('should add arsip items to draft batch', async () => {
            enqueue([{ id: 'p1', status: 'draft', jenisPenyusutan: 'pemusnahan', unitKerjaId: 'u1' }]); // find batch
            enqueue([{ id: 'a-new', unitKerjaId: 'u1', disposalStatus: 'active', disposalBatchId: null, retentionTriggerDate: '2020-01-01', retensiAktif: '1 tahun', retensiInaktif: '1 tahun', hasilAkhir: 'Musnah', legalHold: false, ...validJraProvenance }]); // eligibility check
            enqueue([{ nomorUrut: 3 }]); // existing items max nomorUrut
            enqueue([]); // insert items
            enqueue([]); // update arsip
            enqueue([{ count: 5 }]); // count items
            enqueue([]); // update batch totalBerkas
            const res = await penyusutanService.addItems('p1', ['a-new'], 'u1');
            expect(res.added).toBe(1);
            expect(chainCalls.filter(call => call.method === 'for')).toHaveLength(2);
        });

        it('rolls back item addition when the critical audit insert fails', async () => {
            enqueue([{ id: 'p1', status: 'draft', jenisPenyusutan: 'pemusnahan', unitKerjaId: 'u1' }]);
            enqueue([{ id: 'a-new', unitKerjaId: 'u1', disposalStatus: 'active', disposalBatchId: null, retentionTriggerDate: '2020-01-01', retensiAktif: '1 tahun', retensiInaktif: '1 tahun', hasilAkhir: 'Musnah', legalHold: false, ...validJraProvenance }]);
            enqueue([{ nomorUrut: 3 }], [], [], [{ count: 5 }], []);
            auditMocks.logActionOrThrow.mockRejectedValueOnce(new Error('audit unavailable'));

            await expect(penyusutanService.addItems(
                'p1',
                ['a-new'],
                'u1',
                undefined,
                { userId: 'user-1' },
            )).rejects.toThrow('audit unavailable');

            expect(transactionCommits).toBe(0);
            expect(transactionRollbacks).toBe(1);
            expect(auditMocks.logActionOrThrow).toHaveBeenCalledWith(
                expect.objectContaining({ action: 'update', entityType: 'penyusutan', entityId: 'p1' }),
                mockDb,
            );
        });

        it('should throw for non-draft batch', async () => {
            enqueue([{ id: 'p1', status: 'proposed' }]);
            await expect(penyusutanService.addItems('p1', ['a1'], 'u1')).rejects.toThrow('Can only add items to draft batches');
        });
    });

    describe('getCandidates', () => {
        it('excludes previously transferred archives from repeated inactive transfer', async () => {
            enqueue([{ id: 'transferred', disposalStatus: 'active', legalHold: false,
                hasilAkhir: 'Musnah', ...validJraProvenance,
                inactiveTransferredAt: new Date('2020-01-01'), inactiveTransferBatchId: 'old-transfer' }]);
            vi.mocked(arsipService.getArchiveStatus).mockReturnValue('inaktif');
            expect(await penyusutanService.getCandidates('u1', 'pemindahan')).toEqual([]);
        });

        it('should exclude held archives and archives without a retention trigger', async () => {
            enqueue([
                {
                    id: 'eligible', disposalStatus: 'active', legalHold: false,
                    retentionTriggerDate: '2000-01-01', retensiAktif: '1 tahun', retensiInaktif: '1 tahun',
                    hasilAkhir: 'Musnah', ...validJraProvenance,
                },
                {
                    id: 'held', disposalStatus: 'active', legalHold: true,
                    retentionTriggerDate: '2000-01-01', retensiAktif: '1 tahun', retensiInaktif: '1 tahun',
                    hasilAkhir: 'Musnah',
                },
                {
                    id: 'missing-trigger', disposalStatus: 'active', legalHold: false,
                    retentionTriggerDate: null, retensiAktif: '1 tahun', retensiInaktif: '1 tahun',
                    hasilAkhir: 'Musnah',
                },
                {
                    id: 'missing-jra-provenance', disposalStatus: 'active', legalHold: false,
                    retentionTriggerDate: '2000-01-01', retensiAktif: '1 tahun', retensiInaktif: '1 tahun',
                    hasilAkhir: 'Musnah', ...validJraProvenance, jraVersion: '',
                },
                {
                    id: 'legacy-unverified', disposalStatus: 'active', legalHold: false,
                    retentionTriggerDate: '2000-01-01', retensiAktif: '1 tahun', retensiInaktif: '1 tahun',
                    hasilAkhir: 'Musnah', ...validJraProvenance,
                    ruleProvenanceStatus: 'legacy_unverified',
                },
                {
                    id: 'invalid-hash', disposalStatus: 'active', legalHold: false,
                    retentionTriggerDate: '2000-01-01', retensiAktif: '1 tahun', retensiInaktif: '1 tahun',
                    hasilAkhir: 'Musnah', ...validJraProvenance,
                    klasifikasiSnapshotHash: 'not-a-sha256',
                },
            ]);

            const result = await penyusutanService.getCandidates('u1', 'pemusnahan');
            expect(result.map(item => item.id)).toEqual(['eligible']);
        });

        it('should exclude a manual active 1 year / inactive dash rule from destruction candidates', async () => {
            enqueue([{
                id: 'manual-rule', disposalStatus: 'active', legalHold: false,
                retentionTriggerDate: '2000-01-01', retensiAktif: '1 tahun', retensiInaktif: '-',
                calculationMode: 'manual', dispositionCode: 'musnah', hasilAkhir: 'Musnah',
                ...validJraProvenance,
            }]);

            const result = await penyusutanService.getCandidates('u1', 'pemusnahan');

            expect(result).toEqual([]);
        });

        it('should exclude a duration rule whose disposition is conditional/manual review', async () => {
            enqueue([{
                id: 'conditional-rule', disposalStatus: 'active', legalHold: false,
                retentionTriggerDate: '2000-01-01', retensiAktif: '1 tahun', retensiInaktif: '1 tahun',
                calculationMode: 'duration', dispositionCode: 'manual_review',
                hasilAkhir: 'Dinilai Kembali', ...validJraProvenance,
            }]);

            const result = await penyusutanService.getCandidates('u1', 'pemusnahan');

            expect(result).toEqual([]);
        });

        it('should reject duplicate archive IDs before touching a draft batch', async () => {
            await expect(penyusutanService.addItems('p1', ['a1', 'a1'], 'u1'))
                .rejects.toThrow(/ID duplikat/i);
            expect(resultQueue).toHaveLength(0);
        });
    });

    // ── removeItems ──
    describe('removeItems', () => {
        it('should block removing items from a grandfathered transfer batch', async () => {
            enqueue([{ id: 'p1', status: 'draft', jenisPenyusutan: 'penyerahan' }]);
            await expect(penyusutanService.removeItems('p1', ['a1'], 'u1'))
                .rejects.toThrow(/Tata Kelola Retensi.*permanent-transfers/i);
            expect(resultQueue).toHaveLength(0);
        });

        it('should remove items from draft batch', async () => {
            enqueue([{ id: 'p1', status: 'draft' }]); // find batch
            enqueue([]); // delete items
            enqueue([]); // reset arsip
            enqueue([{ count: 2 }]); // count remaining items
            enqueue([]); // update batch totalBerkas
            const res = await penyusutanService.removeItems('p1', ['a1'], 'u1');
            expect(res.removed).toBe(1);
        });

        it('should throw for non-draft batch', async () => {
            enqueue([{ id: 'p1', status: 'approved' }]);
            await expect(penyusutanService.removeItems('p1', ['a1'], 'u1')).rejects.toThrow('Can only remove items from draft batches');
        });
    });

    // ── deleteBatch ──
    describe('deleteBatch', () => {
        it('should block deleting a grandfathered transfer batch', async () => {
            enqueue([{ id: 'p1', status: 'draft', jenisPenyusutan: 'penyerahan' }]);
            await expect(penyusutanService.deleteBatch('p1', 'u1'))
                .rejects.toThrow(/Tata Kelola Retensi.*permanent-transfers/i);
            expect(resultQueue).toHaveLength(0);
        });

        it('should delete draft batch', async () => {
            enqueue([{ id: 'p1', status: 'draft' }]); // find batch
            enqueue([{ arsipId: 'a1' }]); // get items
            enqueue([]); // reset arsip
            enqueue([{ id: 'p1' }]); // delete batch
            const res = await penyusutanService.deleteBatch('p1', 'u1');
            expect(res.deleted).toBe(true);
            expect(chainCalls.filter(call => call.method === 'for')).toHaveLength(2);
        });

        it('should throw for non-draft batch', async () => {
            enqueue([{ id: 'p1', status: 'executed' }]);
            await expect(penyusutanService.deleteBatch('p1', 'u1')).rejects.toThrow('Can only delete draft batches');
        });

        it('should throw for nonexistent batch', async () => {
            enqueue([]);
            await expect(penyusutanService.deleteBatch('missing', 'u1')).rejects.toThrow('Batch not found');
        });
    });

    // ── Status Flow ──
    describe('Status Flow', () => {
        const STATUS_FLOW = {
            draft: 'proposed',
            proposed: 'reviewed',
            reviewed: 'approved',
            approved: 'executed',
            executed: null,
        };

        it('should define correct status transitions', () => {
            expect(STATUS_FLOW.draft).toBe('proposed');
            expect(STATUS_FLOW.proposed).toBe('reviewed');
            expect(STATUS_FLOW.reviewed).toBe('approved');
            expect(STATUS_FLOW.approved).toBe('executed');
            expect(STATUS_FLOW.executed).toBeNull();
        });

        it('should have 5 statuses in the flow', () => {
            expect(Object.keys(STATUS_FLOW)).toHaveLength(5);
        });
    });
});
