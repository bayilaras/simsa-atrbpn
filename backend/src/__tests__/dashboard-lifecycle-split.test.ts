import { PGlite } from '@electric-sql/pglite';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { arsip } from '../db/schema/arsip';
import { arsipRuleSnapshots } from '../db/schema/arsip-rule-snapshots';
import {
    jraAppraisalCases,
    jraAppraisalDecisions,
    retentionTriggerEvents,
    retentionTriggerVerifications,
} from '../db/schema/retention-governance';

const holder = vi.hoisted(() => ({ db: null as any }));
// Only the arsip queries run against PostgreSQL (PGlite); the other widget
// queries are stubbed because this test is about the lifecycle counters.
const empty: any = new Proxy({}, { get: (_target, key) => key === 'then'
    ? (resolve: (rows: unknown[]) => unknown) => resolve([]) : () => empty });
vi.mock('../config/database', async () => {
    const { arsip: tabelArsip } = await import('../db/schema/arsip');
    return { db: { select: (fields: any) => ({
        from: (table: any) => table === tabelArsip ? holder.db.select(fields).from(table) : empty,
    }) } };
});

const { arsipService } = await import('../services/arsip.service');
const {
    CURRENT_APPRAISAL_CASE_JOIN,
    CURRENT_APPRAISAL_DECISION_JOIN,
    CURRENT_RETENTION_TRIGGER_JOIN,
    CURRENT_RETENTION_VERIFICATION_JOIN,
    RETENTION_GOVERNANCE_EVIDENCE_SELECT,
} = await import('../services/archive-rule-assignment.service');

type Evaluasi = { verified: boolean; calculationEligible: boolean; effectiveDispositionCode: string | null; status: string };
const id = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const eventId = (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const snapshotId = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const lolos = (status: string, kode: string | null = 'musnah'): Evaluasi =>
    ({ verified: true, calculationEligible: true, effectiveDispositionCode: kode, status });
/** n, unit, kelas, ditahan, ada pemicu, status provenance, hasil evaluasi kanonis (bila dievaluasi). */
const ARSIP: Array<[number, string, string | null, boolean, boolean, string, Evaluasi | null]> = [
    [1, 'unit-a', 'biasa', true, true, 'verified', null],
    [2, 'unit-a', null, true, false, 'legacy_unverified', null],
    [3, 'unit-a', 'biasa', false, false, 'verified', null],
    [4, 'unit-a', null, false, false, 'legacy_unverified', null],
    [5, 'unit-a', 'biasa', false, true, 'legacy_unverified', null],
    [6, 'unit-a', 'biasa', false, true, 'pending_jra', null],
    [7, 'unit-a', 'biasa', false, true, 'verified', { verified: false, calculationEligible: false, effectiveDispositionCode: null, status: 'belum_ditentukan' }],
    [8, 'unit-a', 'biasa', false, true, 'verified', { verified: true, calculationEligible: false, effectiveDispositionCode: null, status: 'belum_ditentukan' }],
    [9, 'unit-a', null, false, true, 'verified', lolos('aktif', null)],
    [10, 'unit-a', 'biasa', false, true, 'verified', lolos('aktif')],
    [11, 'unit-a', 'biasa', false, true, 'verified', lolos('akan_inaktif')],
    [12, 'unit-a', 'biasa', false, true, 'verified', lolos('inaktif')],
    [13, 'unit-a', 'biasa', false, true, 'verified', lolos('akan_kadaluarsa')],
    [14, 'unit-a', 'biasa', false, true, 'verified', lolos('kadaluarsa')],
    [15, 'unit-b', 'biasa', false, true, 'verified', lolos('kadaluarsa')],
    [16, 'unit-a', 'rahasia', false, true, 'verified', lolos('inaktif')],
    [17, 'unit-a', 'rahasia', true, false, 'verified', null],
];
const evaluasi = new Map(ARSIP.filter(row => row[6]).map(row => [id(row[0]), row[6]!]));

function kelasArsip(classes: string[] | null) {
    if (classes === null) return undefined;
    if (classes.length === 0) return sql`false`;
    return inArray(sql<string>`lower(coalesce(${arsip.klasifikasiKeamanan}, 'biasa'))`, classes);
}

/** Bentuk getWidgetData sebelum pemisahan: semua arsip dalam cakupan dimuat lalu dihitung di JS. */
async function siklusHidupLama(unitKerjaId: string | null, classes: string[] | null) {
    const rows = await holder.db.select({
        id: arsip.id,
        retentionTriggerDate: arsip.retentionTriggerDate,
        legalHold: arsip.legalHold,
        ruleProvenanceStatus: arsip.ruleProvenanceStatus,
        currentRuleSnapshotId: arsip.currentRuleSnapshotId,
        currentRetentionTriggerEventId: arsip.currentRetentionTriggerEventId,
        currentAppraisalDecisionId: arsip.currentAppraisalDecisionId,
        jraItemId: arsip.jraItemId,
        jraRuleSetId: arsip.jraRuleSetId,
        retentionDecisionHash: arsip.retentionDecisionHash,
        ruleSnapshotId: arsipRuleSnapshots.id,
        ruleSnapshotArsipId: arsipRuleSnapshots.arsipId,
        ruleSnapshotStatus: arsipRuleSnapshots.status,
        ruleSnapshotJraItemId: arsipRuleSnapshots.jraItemId,
        ruleSnapshotJraRuleSetId: arsipRuleSnapshots.jraRuleSetId,
        ruleSnapshot: arsipRuleSnapshots.snapshot,
        ruleSnapshotSha256: arsipRuleSnapshots.snapshotSha256,
        ...RETENTION_GOVERNANCE_EVIDENCE_SELECT,
    }).from(arsip)
        .leftJoin(arsipRuleSnapshots, and(
            eq(arsipRuleSnapshots.id, arsip.currentRuleSnapshotId),
            eq(arsipRuleSnapshots.arsipId, arsip.id),
        ))
        .leftJoin(retentionTriggerEvents, CURRENT_RETENTION_TRIGGER_JOIN)
        .leftJoin(retentionTriggerVerifications, CURRENT_RETENTION_VERIFICATION_JOIN)
        .leftJoin(jraAppraisalDecisions, CURRENT_APPRAISAL_DECISION_JOIN)
        .leftJoin(jraAppraisalCases, CURRENT_APPRAISAL_CASE_JOIN)
        .where(and(unitKerjaId ? eq(arsip.unitKerjaId, unitKerjaId) : undefined, kelasArsip(classes)));

    let aktif = 0, inaktif = 0, kadaluarsa = 0, belumDitentukan = 0;
    let held = 0, missingTrigger = 0, manualReview = 0, unverifiedRules = 0;
    for (const archive of rows) {
        if (archive.legalHold) { held += 1; continue; }
        if (!archive.currentRetentionTriggerEventId) { missingTrigger += 1; continue; }
        if (archive.ruleProvenanceStatus !== 'verified') { unverifiedRules += 1; belumDitentukan += 1; continue; }
        const evaluation = arsipService.evaluateCanonicalRetention(archive);
        if (!evaluation.verified) { unverifiedRules += 1; belumDitentukan += 1; continue; }
        if (!evaluation.calculationEligible) { manualReview += 1; belumDitentukan += 1; continue; }
        if (!evaluation.effectiveDispositionCode) manualReview += 1;
        const status = evaluation.status;
        if (status === 'aktif' || status === 'akan_inaktif') aktif += 1;
        if (status === 'inaktif' || status === 'akan_kadaluarsa') inaktif += 1;
        if (status === 'kadaluarsa') kadaluarsa += 1;
    }
    return { aktif, inaktif, kadaluarsa, belumDitentukan, held, missingTrigger, manualReview, unverifiedRules, total: rows.length };
}

let database: PGlite;
let service: typeof import('../services/dashboard.service').dashboardService;
const evaluasiSpy = vi.spyOn(arsipService, 'evaluateCanonicalRetention');

beforeAll(async () => {
    database = new PGlite();
    await database.exec(`
        CREATE TABLE arsip (
            id uuid PRIMARY KEY, unit_kerja_id varchar(50) NOT NULL, klasifikasi_keamanan varchar(100),
            media_type varchar(50) DEFAULT 'kertas', legal_hold boolean DEFAULT false NOT NULL,
            current_retention_trigger_event_id uuid, rule_provenance_status varchar(30) DEFAULT 'legacy_unverified' NOT NULL,
            retention_trigger_date date, current_rule_snapshot_id uuid, current_appraisal_decision_id uuid,
            jra_item_id integer, jra_rule_set_id uuid, retention_decision_hash varchar(64));
        CREATE TABLE arsip_rule_snapshots (
            id uuid PRIMARY KEY, arsip_id uuid NOT NULL, status varchar(30) NOT NULL, jra_item_id integer,
            jra_rule_set_id uuid, snapshot jsonb NOT NULL, snapshot_sha256 varchar(64) NOT NULL);
        CREATE TABLE retention_trigger_events (
            id uuid PRIMARY KEY, arsip_id uuid NOT NULL, revision integer NOT NULL, event_type varchar(50) NOT NULL,
            event_date date NOT NULL, label varchar(255) NOT NULL, evidence_uri text NOT NULL, actor_id uuid NOT NULL);
        CREATE TABLE retention_trigger_verifications (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL UNIQUE, verdict varchar(20) NOT NULL, verifier_id uuid NOT NULL);
        CREATE TABLE jra_appraisal_cases (id uuid PRIMARY KEY, arsip_id uuid NOT NULL, status varchar(20) NOT NULL);
        CREATE TABLE jra_appraisal_decisions (
            id uuid PRIMARY KEY, case_id uuid NOT NULL, arsip_id uuid NOT NULL, decision_status varchar(20) NOT NULL,
            outcome varchar(30), decision_snapshot jsonb NOT NULL, decision_sha256 varchar(64) NOT NULL);`);
    const aktor = '60000000-0000-4000-8000-000000000001';
    for (const [n, unit, kelas, ditahan, pemicu, provenance] of ARSIP) {
        await database.query(`INSERT INTO arsip (id, unit_kerja_id, klasifikasi_keamanan, legal_hold,
                current_retention_trigger_event_id, rule_provenance_status, retention_trigger_date, current_rule_snapshot_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id(n), unit, kelas, ditahan, pemicu ? eventId(n) : null, provenance, pemicu ? '2020-01-01' : null, snapshotId(n)]);
        await database.query(`INSERT INTO arsip_rule_snapshots VALUES ($1, $2, 'active', 7, NULL, $3, $4)`,
            [snapshotId(n), id(n), JSON.stringify({ n }), 'a'.repeat(64)]);
        if (!pemicu) continue;
        await database.query(`INSERT INTO retention_trigger_events VALUES ($1, $2, 1, 'selesai', '2020-01-01', 'Pemicu', 'bukti://x', $3)`,
            [eventId(n), id(n), aktor]);
        await database.query(`INSERT INTO retention_trigger_verifications (event_id, verdict, verifier_id) VALUES ($1, 'verified', $2)`,
            [eventId(n), aktor]);
    }
    holder.db = drizzle(database);
    ({ dashboardService: service } = await import('../services/dashboard.service'));
}, 20_000);
afterAll(async () => { await database?.close(); });

beforeEach(() => {
    evaluasiSpy.mockReset();
    evaluasiSpy.mockImplementation((row: any) => {
        expect(row.triggerEventRecordId).toBe(row.currentRetentionTriggerEventId);
        expect(row.triggerVerificationVerdict).toBe('verified');
        expect(row.ruleSnapshotId).toBe(row.currentRuleSnapshotId);
        return evaluasi.get(row.id) as any;
    });
});

describe('dashboard archive lifecycle split (aggregate counts + evaluable evidence only)', () => {
    it('matches the former single-scan result for one archive per category', async () => {
        const lama = await siklusHidupLama('unit-a', ['biasa']);
        const evaluasiLama = evaluasiSpy.mock.calls.map(([row]) => (row as any).id).sort();
        evaluasiSpy.mockClear();

        const baru = (await service.getWidgetData('unit-a', ['biasa'])).archiveLifecycle;
        expect(baru).toEqual(lama);
        expect(baru).toEqual({
            aktif: 3, inaktif: 2, kadaluarsa: 1, belumDitentukan: 4, held: 2,
            missingTrigger: 2, manualReview: 2, unverifiedRules: 3, total: 14,
        });
        // Only verified, triggered, unheld archives reach the canonical evaluator.
        const evaluasiBaru = evaluasiSpy.mock.calls.map(([row]) => (row as any).id).sort();
        expect(evaluasiBaru).toEqual(evaluasiLama);
        expect(evaluasiBaru).toEqual([7, 8, 9, 10, 11, 12, 13, 14].map(id));
    });

    it.each([
        ['all units and classes', null, null],
        ['one unit, every class', 'unit-a', null],
        ['all units, Biasa only', null, ['biasa']],
        ['restricted classes', 'unit-a', ['rahasia']],
        ['an empty authorized class scope', 'unit-a', []],
        ['a unit without archives', 'unit-z', ['biasa', 'rahasia']],
    ] as Array<[string, string | null, string[] | null]>)('matches the former result for %s', async (_label, unit, classes) => {
        const lama = await siklusHidupLama(unit, classes);
        const baru = (await service.getWidgetData(unit, classes)).archiveLifecycle;
        expect(baru).toEqual(lama);
    });
});
