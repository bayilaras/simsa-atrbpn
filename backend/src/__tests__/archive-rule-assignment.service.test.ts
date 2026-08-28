import { createHash } from 'node:crypto';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { ArchiveRuleAssignmentService } from '../services/archive-rule-assignment.service';

type RecordedCall = { method: PropertyKey; args: any[] };

function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
        .join(',')}}`;
}

function canonicalSha256(value: unknown): string {
    return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function createExecutor(...results: any[]) {
    const calls: RecordedCall[] = [];
    const queue = [...results];
    let chain: any;

    chain = new Proxy({}, {
        get(_target, prop) {
            if (prop === 'then') {
                const value = queue.shift() ?? [];
                return (resolve: (result: any) => void) => resolve(value);
            }
            return (...args: any[]) => {
                calls.push({ method: prop, args });
                return chain;
            };
        },
    });

    const executor = {
        select: (...args: any[]) => {
            calls.push({ method: 'select', args });
            return chain;
        },
        insert: (...args: any[]) => {
            calls.push({ method: 'insert', args });
            return chain;
        },
        update: (...args: any[]) => {
            calls.push({ method: 'update', args });
            return chain;
        },
    };

    return { executor, calls, queue };
}

const classification = {
    item: {
        id: 10,
        kode: 'PT.01.01',
        sourceCode: 'PT.01.01',
        sourceRecordKey: 'atr10-2018:kementerian:0100',
        organizationalScope: 'kementerian',
        jenis: 'Pengadaan Tanah',
        keterangan: 'Berkas pengadaan tanah',
        tipe: 'substantif',
        parentKode: 'PT.01',
        contentHash: 'b'.repeat(64),
        sourcePage: 31,
    },
    ruleSet: {
        id: 'classification-set',
        version: 'ATR-BPN-10-2018',
        legalBasis: 'Permen ATR/BPN Nomor 10 Tahun 2018',
        sourceDocumentSha256: '1'.repeat(64),
    },
};

const retention = {
    item: {
        id: 20,
        kode: 'S.VI.A.0001',
        uraian: 'Pengadaan tanah',
        retensiAktif: '2 tahun',
        retensiInaktif: '3 tahun',
        activeMonths: 24,
        inactiveMonths: 36,
        calculationMode: 'duration',
        dispositionCode: 'musnah',
        keterangan: 'Musnah',
        triggerGuidance: 'Setelah berkas ditutup',
        contentHash: 'c'.repeat(64),
        sourcePage: 53,
    },
    ruleSet: {
        id: 'retention-set',
        version: 'ATR-BPN-8-2020',
        legalBasis: 'Permen ATR/BPN Nomor 8 Tahun 2020',
        sourceDocumentSha256: '2'.repeat(64),
    },
};

describe('ArchiveRuleAssignmentService', () => {
    let service: ArchiveRuleAssignmentService;

    beforeEach(() => {
        service = new ArchiveRuleAssignmentService();
    });

    it('resolves only active, selectable Ministry classification and active selectable JRA', async () => {
        const { executor, calls } = createExecutor([classification], [retention]);

        const result = await service.resolveActive(executor, {
            klasifikasiItemId: 10,
            jraItemId: 20,
        });

        const whereCalls = calls.filter(call => call.method === 'where');
        expect(whereCalls).toHaveLength(2);

        const dialect = new PgDialect();
        const classificationQuery = dialect.sqlToQuery(whereCalls[0].args[0]);
        expect(classificationQuery.sql).toContain('"regulatory_rule_sets"."instrument_type"');
        expect(classificationQuery.sql).toContain('"regulatory_rule_sets"."status"');
        expect(classificationQuery.sql).toContain('"klasifikasi_arsip"."is_selectable"');
        expect(classificationQuery.sql).toContain('"klasifikasi_arsip"."organizational_scope"');
        expect(classificationQuery.params).toEqual(expect.arrayContaining([
            'klasifikasi', 'active', true, 'kementerian', 10,
        ]));

        const retentionQuery = dialect.sqlToQuery(whereCalls[1].args[0]);
        expect(retentionQuery.sql).toContain('"jadwal_retensi_arsip"."is_selectable"');
        expect(retentionQuery.params).toEqual(expect.arrayContaining(['jra', 'active', true, 20]));

        expect(result.cache).toMatchObject({
            kodeKlasifikasi: 'PT.01.01',
            klasifikasiArsipId: 10,
            klasifikasiRuleSetId: 'classification-set',
            jraItemId: 20,
            jraRuleSetId: 'retention-set',
            hasilAkhir: 'Musnah',
            ruleProvenanceStatus: 'verified',
        });
        expect(result.snapshot.classification.sourceRecordKey)
            .toBe('atr10-2018:kementerian:0100');
        expect(result.snapshotSha256).toMatch(/^[a-f0-9]{64}$/);
        expect(result.cache.klasifikasiSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
        expect(result.cache.retentionDecisionHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('rejects an ambiguous official classification code and requires item identity', async () => {
        const duplicate = {
            ...classification,
            item: {
                ...classification.item,
                id: 11,
                sourceRecordKey: 'atr10-2018:kementerian:0101',
            },
        };
        const { executor, calls } = createExecutor([classification, duplicate]);

        await expect(service.resolveActive(executor, {
            kodeKlasifikasi: 'PT.01.01',
            jraItemId: 20,
        })).rejects.toThrow(/lebih dari satu butir resmi/i);

        expect(calls.filter(call => call.method === 'select')).toHaveLength(1);
        expect(calls.find(call => call.method === 'limit')?.args[0]).toBe(2);
    });

    it('maps a conditional or compound disposition to manual appraisal', async () => {
        const conditionalRetention = {
            ...retention,
            item: {
                ...retention.item,
                dispositionCode: 'manual_review',
                keterangan: 'Permanen, kecuali duplikat dapat dimusnahkan',
            },
        };
        const { executor } = createExecutor([classification], [conditionalRetention]);

        const result = await service.resolveActive(executor, {
            klasifikasiItemId: 10,
            jraItemId: 20,
        });

        expect(result.cache.hasilAkhir).toBe('Dinilai Kembali');
    });

    it('never turns a manual active 1 year / inactive dash rule into an expiry', async () => {
        const manualRetention = {
            ...retention,
            item: {
                ...retention.item,
                retensiAktif: '1 tahun',
                retensiInaktif: '-',
                activeMonths: 12,
                inactiveMonths: null,
                calculationMode: 'manual',
                dispositionCode: 'musnah',
                keterangan: 'Musnah',
            },
        };
        const assignment = await service.resolveActive(
            createExecutor([classification], [manualRetention]).executor,
            { klasifikasiItemId: 10, jraItemId: 20 },
        );

        expect(service.calculateExpiry('2000-01-01', assignment.normalizedRetention)).toBeNull();
        expect(service.calculateRetentionDates('2000-01-01', assignment.normalizedRetention))
            .toEqual({
                tanggalAktifBerakhir: null,
                tanggalInaktifBerakhir: null,
                tanggalKadaluarsa: null,
            });

        const evaluation = service.evaluateCanonicalRetention('2000-01-01', {
            arsipId: 'archive-1',
            ruleProvenanceStatus: 'verified',
            currentRuleSnapshotId: 'snapshot-1',
            jraItemId: assignment.cache.jraItemId,
            jraRuleSetId: assignment.cache.jraRuleSetId,
            retentionDecisionHash: assignment.cache.retentionDecisionHash,
            snapshotId: 'snapshot-1',
            snapshotArsipId: 'archive-1',
            snapshotStatus: 'verified',
            snapshotJraItemId: assignment.cache.jraItemId,
            snapshotJraRuleSetId: assignment.cache.jraRuleSetId,
            snapshot: assignment.snapshot,
            snapshotSha256: assignment.snapshotSha256,
            currentRetentionTriggerEventId: 'event-1',
            triggerEventRecordId: 'event-1',
            triggerEventArsipId: 'archive-1',
            triggerEventDate: '2000-01-01',
            triggerEventRevision: 1,
            triggerEventActorId: 'actor-1',
            triggerVerificationVerdict: 'verified',
            triggerVerifierId: 'verifier-1',
            latestTriggerEventRevision: 1,
            currentAppraisalDecisionId: null,
            hasActiveAppraisalCase: false,
        });

        expect(evaluation).toMatchObject({
            verified: true,
            calculationEligible: false,
            status: 'aktif',
        });
        expect(evaluation.calculationBlockReason).toMatch(/penilaian manusia/i);
    });

    it('accepts dinilai_kembali as verified but never automates its disposition', async () => {
        const appraisalRetention = {
            ...retention,
            item: {
                ...retention.item,
                calculationMode: 'duration',
                dispositionCode: 'dinilai_kembali',
                keterangan: 'Dinilai Kembali',
            },
        };
        const assignment = await service.resolveActive(
            createExecutor([classification], [appraisalRetention]).executor,
            { klasifikasiItemId: 10, jraItemId: 20 },
        );

        const evaluation = service.evaluateCanonicalRetention('2000-01-01', {
            arsipId: 'archive-1',
            ruleProvenanceStatus: 'verified',
            currentRuleSnapshotId: 'snapshot-1',
            jraItemId: assignment.cache.jraItemId,
            jraRuleSetId: assignment.cache.jraRuleSetId,
            retentionDecisionHash: assignment.cache.retentionDecisionHash,
            snapshotId: 'snapshot-1',
            snapshotArsipId: 'archive-1',
            snapshotStatus: 'verified',
            snapshotJraItemId: assignment.cache.jraItemId,
            snapshotJraRuleSetId: assignment.cache.jraRuleSetId,
            snapshot: assignment.snapshot,
            snapshotSha256: assignment.snapshotSha256,
            currentRetentionTriggerEventId: 'event-1',
            triggerEventRecordId: 'event-1',
            triggerEventArsipId: 'archive-1',
            triggerEventDate: '2000-01-01',
            triggerEventRevision: 1,
            triggerEventActorId: 'actor-1',
            triggerVerificationVerdict: 'verified',
            triggerVerifierId: 'verifier-1',
            latestTriggerEventRevision: 1,
            currentAppraisalDecisionId: null,
            hasActiveAppraisalCase: false,
        });

        expect(evaluation).toMatchObject({
            verified: true,
            calculationEligible: true,
            dates: {
                tanggalKadaluarsa: '2005-01-01',
            },
            effectiveDispositionCode: null,
            dispositionEligible: false,
        });
        expect(evaluation.dispositionBlockReason).toMatch(/appraisal/i);
    });

    it('accepts only the current, latest, independently verified trigger event', async () => {
        const assignment = await service.resolveActive(
            createExecutor([classification], [retention]).executor,
            { klasifikasiItemId: 10, jraItemId: 20 },
        );
        const evidence = {
            arsipId: 'archive-1',
            ruleProvenanceStatus: 'verified',
            currentRuleSnapshotId: 'snapshot-1',
            jraItemId: assignment.cache.jraItemId,
            jraRuleSetId: assignment.cache.jraRuleSetId,
            retentionDecisionHash: assignment.cache.retentionDecisionHash,
            snapshotId: 'snapshot-1',
            snapshotArsipId: 'archive-1',
            snapshotStatus: 'verified',
            snapshotJraItemId: assignment.cache.jraItemId,
            snapshotJraRuleSetId: assignment.cache.jraRuleSetId,
            snapshot: assignment.snapshot,
            snapshotSha256: assignment.snapshotSha256,
            currentRetentionTriggerEventId: 'event-1',
            triggerEventRecordId: 'event-1',
            triggerEventArsipId: 'archive-1',
            triggerEventDate: '2000-01-01',
            triggerEventRevision: 1,
            triggerEventActorId: 'actor-1',
            triggerVerificationVerdict: 'verified',
            triggerVerifierId: 'verifier-1',
            latestTriggerEventRevision: 1,
            currentAppraisalDecisionId: null,
            hasActiveAppraisalCase: false,
        };

        expect(service.evaluateCanonicalRetention('2000-01-01', evidence))
            .toMatchObject({ verified: true, effectiveDispositionCode: 'musnah' });
        expect(service.evaluateCanonicalRetention('2000-01-01', {
            ...evidence,
            latestTriggerEventRevision: 2,
        })).toMatchObject({ verified: false, blockReason: expect.stringMatching(/revisi terbaru/i) });
        expect(service.evaluateCanonicalRetention('2000-01-01', {
            ...evidence,
            triggerVerifierId: 'actor-1',
        })).toMatchObject({ verified: false, blockReason: expect.stringMatching(/independen/i) });
        expect(service.evaluateCanonicalRetention('2000-01-01', {
            ...evidence,
            currentRetentionTriggerEventId: 'event-2',
        })).toMatchObject({ verified: false, blockReason: expect.stringMatching(/belum ditetapkan/i) });
    });

    it('uses only a current approved appraisal and rejects a stale rule or trigger snapshot', async () => {
        const appraisalRetention = {
            ...retention,
            item: {
                ...retention.item,
                dispositionCode: 'dinilai_kembali',
                keterangan: 'Dinilai Kembali',
            },
        };
        const assignment = await service.resolveActive(
            createExecutor([classification], [appraisalRetention]).executor,
            { klasifikasiItemId: 10, jraItemId: 20 },
        );
        const submissionSnapshot = {
            ruleSnapshot: { id: 'snapshot-1', sha256: assignment.snapshotSha256 },
            archive: { retentionDecisionHash: assignment.cache.retentionDecisionHash },
            retentionTrigger: {
                event: { id: 'event-1' },
                verification: { verdict: 'verified', verifierId: 'verifier-1' },
            },
        };
        const decisionSnapshot = {
            schemaVersion: 1,
            arsipId: 'archive-1',
            submissionSnapshot,
        };
        const evidence = {
            arsipId: 'archive-1',
            ruleProvenanceStatus: 'verified',
            currentRuleSnapshotId: 'snapshot-1',
            jraItemId: assignment.cache.jraItemId,
            jraRuleSetId: assignment.cache.jraRuleSetId,
            retentionDecisionHash: assignment.cache.retentionDecisionHash,
            snapshotId: 'snapshot-1',
            snapshotArsipId: 'archive-1',
            snapshotStatus: 'verified',
            snapshotJraItemId: assignment.cache.jraItemId,
            snapshotJraRuleSetId: assignment.cache.jraRuleSetId,
            snapshot: assignment.snapshot,
            snapshotSha256: assignment.snapshotSha256,
            currentRetentionTriggerEventId: 'event-1',
            triggerEventRecordId: 'event-1',
            triggerEventArsipId: 'archive-1',
            triggerEventDate: '2000-01-01',
            triggerEventRevision: 1,
            triggerEventActorId: 'actor-1',
            triggerVerificationVerdict: 'verified',
            triggerVerifierId: 'verifier-1',
            latestTriggerEventRevision: 1,
            currentAppraisalDecisionId: 'decision-1',
            appraisalDecisionRecordId: 'decision-1',
            appraisalDecisionArsipId: 'archive-1',
            appraisalDecisionStatus: 'approved',
            appraisalDecisionOutcome: 'permanen',
            appraisalDecisionSnapshot: decisionSnapshot,
            appraisalDecisionSha256: canonicalSha256(decisionSnapshot),
            appraisalCaseStatus: 'approved',
            hasActiveAppraisalCase: false,
        };

        expect(service.evaluateCanonicalRetention('2000-01-01', evidence)).toMatchObject({
            verified: true,
            effectiveDispositionCode: 'permanen',
            effectiveDecisionSource: 'appraisal',
            effectiveAppraisalDecisionId: 'decision-1',
            dispositionEligible: true,
        });

        const staleDecisionSnapshot = {
            ...decisionSnapshot,
            submissionSnapshot: {
                ...submissionSnapshot,
                ruleSnapshot: { id: 'snapshot-old', sha256: assignment.snapshotSha256 },
            },
        };
        expect(service.evaluateCanonicalRetention('2000-01-01', {
            ...evidence,
            appraisalDecisionSnapshot: staleDecisionSnapshot,
            appraisalDecisionSha256: canonicalSha256(staleDecisionSnapshot),
        })).toMatchObject({
            verified: false,
            blockReason: expect.stringMatching(/kedaluwarsa/i),
        });
    });

    it('creates revision one and only updates the archive pointer/cache status', async () => {
        const assignment = await service.resolveActive(
            createExecutor([classification], [retention]).executor,
            { klasifikasiItemId: 10, jraItemId: 20 },
        );
        const snapshotRecord = { id: 'snapshot-1', revision: 1 };
        const updatedArchive = {
            id: 'archive-1',
            currentRuleSnapshotId: 'snapshot-1',
            ruleProvenanceStatus: 'verified',
        };
        const { executor, calls } = createExecutor([snapshotRecord], [updatedArchive]);

        await expect(service.attachInitialSnapshot(
            executor,
            'archive-1',
            assignment,
            'user-1',
        )).resolves.toEqual(updatedArchive);

        const inserted = calls.find(call => call.method === 'values')?.args[0];
        expect(inserted).toMatchObject({
            arsipId: 'archive-1',
            revision: 1,
            status: 'verified',
            snapshotSha256: assignment.snapshotSha256,
            reason: 'Registrasi awal berdasarkan master peraturan aktif.',
            createdBy: 'user-1',
        });
        const archiveSet = calls.find(call => call.method === 'set')?.args[0];
        expect(archiveSet).toMatchObject({
            currentRuleSnapshotId: 'snapshot-1',
            ruleProvenanceStatus: 'verified',
        });
    });

    it('appends the next evidence revision and refreshes cache from canonical rules', async () => {
        const assignment = await service.resolveActive(
            createExecutor([classification], [retention]).executor,
            { klasifikasiItemId: 10, jraItemId: 20 },
        );
        const previous = { id: 'snapshot-3', revision: 3 };
        const appended = { id: 'snapshot-4', revision: 4 };
        const archive = { id: 'archive-1', currentRuleSnapshotId: 'snapshot-4' };
        const { executor, calls } = createExecutor([previous], [appended], [archive]);

        const result = await service.appendRevision(
            executor,
            'archive-1',
            assignment,
            'Koreksi klasifikasi setelah verifikasi petugas',
            '2020-01-31',
            'user-1',
        );

        expect(result).toEqual({ archive, snapshot: appended });
        const inserted = calls.find(call => call.method === 'values')?.args[0];
        expect(inserted).toMatchObject({
            arsipId: 'archive-1',
            revision: 4,
            supersedesSnapshotId: 'snapshot-3',
            snapshot: assignment.snapshot,
            reason: 'Koreksi klasifikasi setelah verifikasi petugas',
            createdBy: 'user-1',
        });

        const archiveSet = calls.find(call => call.method === 'set')?.args[0];
        expect(archiveSet).toMatchObject({
            ...assignment.cache,
            tanggalKadaluarsa: '2025-01-31',
            currentRuleSnapshotId: 'snapshot-4',
            ruleProvenanceStatus: 'verified',
        });
        expect(calls.filter(call => call.method === 'insert')).toHaveLength(1);
        expect(calls.filter(call => call.method === 'update')).toHaveLength(1);
    });
});
