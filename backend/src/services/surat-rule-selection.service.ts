import { and, eq, inArray, or } from 'drizzle-orm';
import { jadwalRetensiArsip, klasifikasiArsip, regulatoryRuleSets } from '../db/schema';
import { ValidationError } from '../utils/errors';
import { archiveRuleAssignmentService } from './archive-rule-assignment.service';

type SuratKind = 'masuk' | 'keluar';
type Selection = {
    klasifikasiItemId?: number | null;
    jraItemId?: number | null;
    [key: string]: unknown;
};

function classificationFields(kind: SuratKind, item: { kode: string; jenis: string; tipe: string }) {
    return kind === 'masuk'
        ? { klasifikasiKode: item.kode, klasifikasiUraian: item.jenis }
        : {
            klasifikasiFasilitatifKode: item.tipe === 'fasilitatif' ? item.kode : null,
            klasifikasiFasilitatif: item.tipe === 'fasilitatif' ? item.jenis : null,
            klasifikasiSubstantifKode: item.tipe === 'substantif' ? item.kode : null,
            klasifikasiSubstantif: item.tipe === 'substantif' ? item.jenis : null,
        };
}

export function hasSuratRuleSelection(data: Selection): boolean {
    return ['klasifikasiItemId', 'jraItemId', 'klasifikasiKode', 'klasifikasiUraian',
        'klasifikasiFasilitatifKode', 'klasifikasiFasilitatif', 'klasifikasiSubstantifKode', 'klasifikasiSubstantif']
        .some(key => data[key] !== undefined);
}

/** Persist identities, never client-supplied retention durations or outcomes. */
export async function prepareSuratRuleSelection(
    executor: any,
    kind: SuratKind,
    data: Selection,
    current?: Selection,
) {
    const codeFields = kind === 'masuk'
        ? ['klasifikasiKode', 'klasifikasiUraian']
        : ['klasifikasiFasilitatifKode', 'klasifikasiFasilitatif', 'klasifikasiSubstantifKode', 'klasifikasiSubstantif'];
    if (data.klasifikasiItemId === undefined && data.jraItemId === undefined) {
        // A legacy client changing free-text classification cannot retain an
        // unrelated identity/JRA. Resending unchanged text is still a metadata
        // edit and must preserve the saved decisions.
        const suppliedFields = codeFields.filter(key => data[key] !== undefined);
        const normalized = (value: unknown) => typeof value === 'string' ? value.trim() : value ?? '';
        if (current && suppliedFields.every(key => normalized(data[key]) === normalized(current[key]))) return {};
        return suppliedFields.length
            ? { klasifikasiItemId: null, jraItemId: null }
            : {};
    }

    const klasifikasiItemId = data.klasifikasiItemId !== undefined
        ? data.klasifikasiItemId : current?.klasifikasiItemId ?? null;
    const changedClassification = klasifikasiItemId !== (current?.klasifikasiItemId ?? null);
    const jraItemId = data.jraItemId !== undefined
        ? data.jraItemId
        : changedClassification ? null : current?.jraItemId ?? null;
    if (!klasifikasiItemId) {
        if (jraItemId) throw new ValidationError('Pilih klasifikasi arsip sebelum memilih JRA.');
        return {
            klasifikasiItemId: null, jraItemId: null,
            ...Object.fromEntries(codeFields.map(key => [key, null])),
        };
    }
    if (jraItemId && (changedClassification || jraItemId !== current?.jraItemId)) {
        await archiveRuleAssignmentService.resolveRetention(executor, { jraItemId });
    }
    // An unrelated edit must still work when a previously selected instrument
    // has been retired. Its identity and stored labels remain historical facts.
    if (current && !changedClassification) {
        return {
            ...Object.fromEntries(codeFields.map(key => [key, current[key] ?? null])),
            klasifikasiItemId, jraItemId,
        };
    }
    const { item } = await archiveRuleAssignmentService.resolveClassification(executor, { klasifikasiItemId });
    return { ...classificationFields(kind, item), klasifikasiItemId, jraItemId };
}

/** Read historical selections by ID, including a subsequently retired rule. */
export async function hydrateSuratRuleSelections<T extends { klasifikasiItemId?: number | null; jraItemId?: number | null }>(
    executor: any, rows: T[], kind?: SuratKind,
): Promise<T[]> {
    const classificationIds = [...new Set(rows.flatMap(row => row.klasifikasiItemId ? [row.klasifikasiItemId] : []))];
    function legacyCodes(row: T) {
        if (row.klasifikasiItemId) return [];
        const record = row as Record<string, unknown>;
        return [...new Set(['klasifikasiKode', 'klasifikasiFasilitatifKode', 'klasifikasiSubstantifKode']
            .map(key => record[key]).filter((code): code is string => typeof code === 'string' && Boolean(code.trim()))
            .map(code => code.trim()))];
    }
    const codes = [...new Set(rows.flatMap(legacyCodes))];
    const classifications = classificationIds.length || codes.length
        ? await executor.select({ item: klasifikasiArsip, ruleSetStatus: regulatoryRuleSets.status,
            instrumentType: regulatoryRuleSets.instrumentType }).from(klasifikasiArsip)
            .leftJoin(regulatoryRuleSets, eq(klasifikasiArsip.ruleSetId, regulatoryRuleSets.id))
            .where(or(
                classificationIds.length ? inArray(klasifikasiArsip.id, classificationIds) : undefined,
                codes.length ? and(
                    inArray(klasifikasiArsip.kode, codes),
                    eq(klasifikasiArsip.isActive, true),
                    eq(klasifikasiArsip.isSelectable, true),
                    eq(regulatoryRuleSets.status, 'active'),
                    eq(regulatoryRuleSets.instrumentType, 'klasifikasi'),
                ) : undefined,
            )) : [];
    const classificationById = new Map<number, any>();
    const classificationByCode = new Map<string, any[]>();
    for (const { item, ruleSetStatus, instrumentType } of classifications) {
        classificationById.set(item.id, item);
        if (!item.isActive || !item.isSelectable || ruleSetStatus !== 'active' || instrumentType !== 'klasifikasi') continue;
        const matches = classificationByCode.get(item.kode) ?? [];
        matches.push(item);
        classificationByCode.set(item.kode, matches);
    }
    const ids = [...new Set(rows.flatMap(row => row.jraItemId ? [row.jraItemId] : []))];
    const items = ids.length
        ? await executor.select().from(jadwalRetensiArsip).where(inArray(jadwalRetensiArsip.id, ids)) : [];
    const byId = new Map<number, any>(items.map((item: any) => [item.id, item]));
    return rows.map(row => {
        const knownCodes = legacyCodes(row);
        const matches = knownCodes.length === 1 ? classificationByCode.get(knownCodes[0]) : undefined;
        const classification = row.klasifikasiItemId ? classificationById.get(row.klasifikasiItemId)
            : matches?.length === 1 ? matches[0] : undefined;
        const jra = row.jraItemId ? byId.get(row.jraItemId) : undefined;
        const rowKind = kind ?? ('klasifikasiKode' in row ? 'masuk' : 'keluar');
        return {
            ...row,
            // Resolve only an unambiguous code for legacy display. A read does
            // not manufacture a persisted item identity or a JRA decision.
            ...(classification ? {
                ...classificationFields(rowKind, classification),
                klasifikasiTipe: classification.tipe,
                klasifikasiOrganizationalScope: classification.organizationalScope,
            } : {}),
            ...(ids.length ? {
                jraKode: jra?.kode ?? null,
                jraUraian: jra?.uraian ?? null,
                jraRetensiAktif: jra?.retensiAktif ?? null,
                jraRetensiInaktif: jra?.retensiInaktif ?? null,
                jraKeterangan: jra?.keterangan ?? null,
            } : {}),
        };
    });
}
