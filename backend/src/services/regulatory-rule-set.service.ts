import { createHash } from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '../config/database';
import {
    jadwalRetensiArsip,
    klasifikasiArsip,
    regulatoryRuleSets,
    type RegulatoryRuleSet,
} from '../db/schema';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import type {
    CloneActiveRuleSetInput,
    ImportRegulatoryRuleItemsInput,
    ListRegulatoryRuleSetsQuery,
    RegulatoryInstrumentType,
} from '../validators/regulatory-rule-set.schemas';

type RuleItem = Record<string, any>;
type JsonObject = Record<string, unknown>;

export interface RuleSetValidationIssue {
    code: string;
    message: string;
    itemCode?: string;
}

export interface RuleSetValidationReport {
    valid: boolean;
    errors: RuleSetValidationIssue[];
    warnings: RuleSetValidationIssue[];
    stats: {
        total: number;
        active: number;
        selectable: number;
        roots: number;
    };
    contentHash: string;
}

export class RegulatoryRuleSetValidationError extends ValidationError {
    readonly report: RuleSetValidationReport;

    constructor(report: RuleSetValidationReport) {
        super('Draft aturan belum memenuhi syarat untuk diaktifkan.');
        this.report = report;
    }
}

function asJsonObject(value: unknown): JsonObject {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return { ...(value as JsonObject) };
}

function stableJson(value: unknown): string {
    if (value === undefined) return '"__undefined__"';
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;

    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
        .join(',')}}`;
}

function comparableItem(instrumentType: RegulatoryInstrumentType, item: RuleItem) {
    const common = {
        kode: item.kode,
        sourceCode: item.sourceCode ?? item.kode,
        sourceRecordKey: item.sourceRecordKey ?? null,
        organizationalScope: item.organizationalScope ?? 'kementerian',
        parentKode: item.parentKode ?? null,
        kategori: item.kategori ?? null,
        tipe: item.tipe,
        level: item.level,
        isActive: item.isActive,
        isSelectable: item.isSelectable,
        sourcePage: item.sourcePage ?? null,
    };

    if (instrumentType === 'klasifikasi') {
        return {
            ...common,
            jenis: item.jenis,
            keterangan: item.keterangan ?? null,
        };
    }

    return {
        ...common,
        uraian: item.uraian,
        retensiAktif: item.retensiAktif ?? null,
        retensiInaktif: item.retensiInaktif ?? null,
        keterangan: item.keterangan ?? null,
        activeMonths: item.activeMonths ?? null,
        inactiveMonths: item.inactiveMonths ?? null,
        calculationMode: item.calculationMode,
        dispositionCode: item.dispositionCode,
        triggerGuidance: item.triggerGuidance ?? null,
    };
}

/**
 * Hash only the legally meaningful rule content. Database identifiers,
 * timestamps, version labels, and an item's previous hash are excluded so the
 * same edition produces the same digest in every environment.
 */
export function deterministicRegulatoryContentHash(
    instrumentType: RegulatoryInstrumentType,
    items: RuleItem[],
): string {
    const content = items
        .map((item) => comparableItem(instrumentType, item))
        .sort((left, right) => {
            if (left.kode === right.kode) return stableJson(left).localeCompare(stableJson(right));
            return left.kode < right.kode ? -1 : 1;
        });

    return createHash('sha256')
        .update(stableJson({ schemaVersion: 1, instrumentType, items: content }), 'utf8')
        .digest('hex');
}

function addIssue(
    target: RuleSetValidationIssue[],
    code: string,
    message: string,
    itemCode?: string,
) {
    target.push({ code, message, ...(itemCode ? { itemCode } : {}) });
}

function applyDeclaredCompletenessChecks(
    report: RuleSetValidationReport,
    metadataValue: unknown,
) {
    const metadata = asJsonObject(metadataValue);
    const expectedItemCount = metadata.expectedItemCount;
    const expectedSelectableCount = metadata.expectedSelectableCount;
    if (typeof expectedItemCount === 'number'
        && Number.isInteger(expectedItemCount)
        && report.stats.total !== expectedItemCount) {
        addIssue(
            report.errors,
            'incomplete_source_item_count',
            `Jumlah butir ${report.stats.total} tidak sama dengan manifest sumber (${expectedItemCount}).`,
        );
    }
    if (typeof expectedSelectableCount === 'number'
        && Number.isInteger(expectedSelectableCount)
        && report.stats.selectable !== expectedSelectableCount) {
        addIssue(
            report.errors,
            'incomplete_selectable_item_count',
            `Jumlah butir yang dapat dipilih ${report.stats.selectable} tidak sama dengan manifest sumber (${expectedSelectableCount}).`,
        );
    }
    report.valid = report.errors.length === 0;
}

/** Pure validation used both by the preview endpoint and transactional activation. */
export function validateRegulatoryRuleItems(
    instrumentType: RegulatoryInstrumentType,
    items: RuleItem[],
): RuleSetValidationReport {
    const errors: RuleSetValidationIssue[] = [];
    const warnings: RuleSetValidationIssue[] = [];
    const sortedItems = [...items].sort((left, right) => {
        const leftCode = String(left.kode || '');
        const rightCode = String(right.kode || '');
        return leftCode < rightCode ? -1 : leftCode > rightCode ? 1 : 0;
    });
    // Klasifikasi in the source regulation contains deliberate duplicate
    // printed codes, so its identity is a stable source-row key. JRA has a
    // unique legal code and deliberately does not require sourceRecordKey.
    const isClassification = instrumentType === 'klasifikasi';
    const byIdentityKey = new Map<string, RuleItem>();
    const byScopedCode = new Map<string, RuleItem[]>();
    const scopeFor = (item: RuleItem) => isClassification
        ? String(item.organizationalScope || 'kementerian').trim()
        : 'jra';
    const identityFor = (item: RuleItem) => isClassification
        ? `source:${String(item.sourceRecordKey || '').trim()}`
        : `code:${String(item.kode || '').trim()}`;

    for (const item of sortedItems) {
        const code = String(item.kode || '').trim();
        if (!code) {
            addIssue(errors, 'blank_code', 'Kode aturan tidak boleh kosong.');
            continue;
        }
        if (isClassification) {
            const sourceRecordKey = String(item.sourceRecordKey || '').trim();
            if (!sourceRecordKey) {
                addIssue(errors, 'blank_source_record_key', 'Identitas baris sumber tidak boleh kosong.', code);
                continue;
            }
            if (byIdentityKey.has(identityFor(item))) {
                addIssue(
                    errors,
                    'duplicate_source_record_key',
                    `Identitas sumber ${sourceRecordKey} muncul lebih dari sekali.`,
                    code,
                );
                continue;
            }
        } else if (byIdentityKey.has(identityFor(item))) {
            addIssue(errors, 'duplicate_code', `Kode JRA ${code} muncul lebih dari sekali.`, code);
            continue;
        }

        byIdentityKey.set(identityFor(item), item);
        const scopedCode = `${scopeFor(item)}|${code}`;
        byScopedCode.set(scopedCode, [...(byScopedCode.get(scopedCode) || []), item]);
    }

    const childCount = new Map<string, number>();
    for (const item of byIdentityKey.values()) {
        const code = String(item.kode).trim();
        const parentCode = item.parentKode == null ? null : String(item.parentKode).trim();
        if (parentCode === null) {
            if (item.level !== 0) {
                addIssue(errors, 'invalid_root_level', 'Item root harus memiliki level 0.', code);
            }
            continue;
        }
        if (!parentCode) {
            addIssue(errors, 'blank_parent', 'Parent kode harus null atau berisi kode yang valid.', code);
            continue;
        }
        if (parentCode === code) {
            addIssue(errors, 'self_parent', 'Item tidak boleh menjadi parent bagi dirinya sendiri.', code);
            continue;
        }
        const parentCandidates = byScopedCode.get(`${scopeFor(item)}|${parentCode}`) || [];
        if (parentCandidates.length === 0) {
            addIssue(errors, 'missing_parent', `Parent ${parentCode} tidak ditemukan dalam draft yang sama.`, code);
            continue;
        }
        if (parentCandidates.length > 1) {
            addIssue(errors, 'ambiguous_parent', `Parent ${parentCode} ambigu dalam lingkup yang sama.`, code);
            continue;
        }
        const parent = parentCandidates[0];
        const parentKey = identityFor(parent);
        childCount.set(parentKey, (childCount.get(parentKey) || 0) + 1);
        if (item.level !== Number(parent.level) + 1) {
            addIssue(
                errors,
                'invalid_level',
                `Level harus tepat satu tingkat di bawah parent ${parentCode}.`,
                code,
            );
        }
    }

    const visitState = new Map<string, 0 | 1 | 2>();
    const reportedCycles = new Set<string>();
    const visit = (identityKey: string, path: string[]) => {
        const state = visitState.get(identityKey) || 0;
        if (state === 2) return;
        if (state === 1) {
            const cycleStart = path.indexOf(identityKey);
            const cycle = [...path.slice(Math.max(cycleStart, 0)), identityKey];
            const signature = [...new Set(cycle)].sort().join('|');
            if (!reportedCycles.has(signature)) {
                reportedCycles.add(signature);
                const itemCode = String(byIdentityKey.get(identityKey)?.kode || identityKey);
                addIssue(errors, 'hierarchy_cycle', `Siklus hierarki terdeteksi: ${cycle.join(' -> ')}.`, itemCode);
            }
            return;
        }

        visitState.set(identityKey, 1);
        const item = byIdentityKey.get(identityKey);
        const parentCode = item?.parentKode;
        if (item && parentCode != null) {
            const parentCandidates = byScopedCode.get(`${scopeFor(item)}|${String(parentCode).trim()}`) || [];
            if (parentCandidates.length === 1) {
                visit(identityFor(parentCandidates[0]), [...path, identityKey]);
            }
        }
        visitState.set(identityKey, 2);
    };
    for (const identityKey of byIdentityKey.keys()) visit(identityKey, []);

    let activeCount = 0;
    let selectableCount = 0;
    for (const [identityKey, item] of byIdentityKey) {
        const code = String(item.kode);
        if (item.isActive) activeCount += 1;
        if (item.isActive && item.isSelectable) selectableCount += 1;

        if (item.isSelectable && !item.isActive) {
            addIssue(errors, 'inactive_selectable', 'Item nonaktif tidak boleh selectable.', code);
        }
        if (item.isSelectable && (childCount.get(identityKey) || 0) > 0) {
            addIssue(errors, 'selectable_parent', 'Item yang memiliki child tidak boleh selectable.', code);
        }

        if (instrumentType === 'jra' && item.isActive && item.isSelectable) {
            if (!['duration', 'manual'].includes(item.calculationMode)) {
                addIssue(errors, 'invalid_calculation_mode', 'Mode perhitungan JRA tidak valid.', code);
            }
            if (!['musnah', 'permanen', 'dinilai_kembali', 'manual_review'].includes(item.dispositionCode)) {
                addIssue(errors, 'invalid_disposition', 'Kode hasil akhir JRA tidak valid.', code);
            }
            if (item.calculationMode === 'duration') {
                const activeMonths = item.activeMonths;
                const inactiveMonths = item.inactiveMonths;
                if (!Number.isInteger(activeMonths) || activeMonths < 0
                    || !Number.isInteger(inactiveMonths) || inactiveMonths < 0
                    || activeMonths + inactiveMonths <= 0) {
                    addIssue(
                        errors,
                        'invalid_duration',
                        'JRA duration wajib memiliki bulan aktif/inaktif nonnegatif dengan total lebih dari nol.',
                        code,
                    );
                }
            } else if (
                (item.activeMonths != null || item.inactiveMonths != null)
                && !String(item.triggerGuidance || '').trim()
            ) {
                addIssue(
                    warnings,
                    'manual_duration_guidance',
                    'JRA manual memiliki angka durasi tetapi belum memiliki petunjuk pemicu.',
                    code,
                );
            }
            if (item.dispositionCode === 'manual_review') {
                addIssue(
                    warnings,
                    'manual_disposition',
                    'Hasil akhir memerlukan penilaian manual dan tidak boleh disusutkan otomatis.',
                    code,
                );
            }
        }
    }

    if (items.length === 0) {
        addIssue(errors, 'empty_rule_set', 'Draft belum memiliki item aturan.');
    } else if (selectableCount === 0) {
        addIssue(errors, 'no_selectable_items', 'Draft harus memiliki sedikitnya satu item aktif yang selectable.');
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        stats: {
            total: items.length,
            active: activeCount,
            selectable: selectableCount,
            roots: items.filter((item) => item.parentKode == null).length,
        },
        contentHash: deterministicRegulatoryContentHash(instrumentType, items),
    };
}

function presentRuleSet(ruleSet: RegulatoryRuleSet) {
    const metadata = asJsonObject(ruleSet.metadata);
    return {
        ...ruleSet,
        contentHash: typeof metadata.contentHash === 'string' ? metadata.contentHash : null,
    };
}

function previousIsoDate(value: string): string {
    const date = new Date(`${value}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
}

function jakartaToday(): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function withoutComputedMetadata(value: unknown): JsonObject {
    const metadata = asJsonObject(value);
    delete metadata.contentHash;
    delete metadata.contentHashAlgorithm;
    delete metadata.contentSchemaVersion;
    delete metadata.contentItemCount;
    delete metadata.validatedAt;
    // Completeness expectations belong to one source edition and must never
    // silently constrain a later regulation that legitimately adds/removes rows.
    delete metadata.expectedItemCount;
    delete metadata.expectedSelectableCount;
    return metadata;
}

function isUniqueViolation(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && (
        (error as any).code === '23505' || (error as any).cause?.code === '23505'
    ));
}

export class RegulatoryRuleSetService {
    async list(filters: ListRegulatoryRuleSetsQuery = {}) {
        const conditions = [];
        if (filters.instrumentType) {
            conditions.push(eq(regulatoryRuleSets.instrumentType, filters.instrumentType));
        }
        if (filters.status) {
            conditions.push(eq(regulatoryRuleSets.status, filters.status));
        }

        const rows = await db
            .select()
            .from(regulatoryRuleSets)
            .where(conditions.length ? and(...conditions) : undefined)
            .orderBy(desc(regulatoryRuleSets.effectiveFrom), desc(regulatoryRuleSets.createdAt));
        return rows.map(presentRuleSet);
    }

    async getById(id: string) {
        const [row] = await db
            .select()
            .from(regulatoryRuleSets)
            .where(eq(regulatoryRuleSets.id, id))
            .limit(1);
        if (!row) throw new NotFoundError('Versi aturan');
        return presentRuleSet(row);
    }

    async getActive(instrumentType: RegulatoryInstrumentType) {
        const [row] = await db
            .select()
            .from(regulatoryRuleSets)
            .where(and(
                eq(regulatoryRuleSets.instrumentType, instrumentType),
                eq(regulatoryRuleSets.status, 'active'),
            ))
            .limit(1);
        if (!row) throw new NotFoundError(`Aturan aktif ${instrumentType}`);
        return presentRuleSet(row);
    }

    private async getItems(executor: any, ruleSet: RegulatoryRuleSet): Promise<RuleItem[]> {
        if (ruleSet.instrumentType === 'klasifikasi') {
            return executor
                .select()
                .from(klasifikasiArsip)
                .where(eq(klasifikasiArsip.ruleSetId, ruleSet.id))
                .orderBy(asc(klasifikasiArsip.kode));
        }
        return executor
            .select()
            .from(jadwalRetensiArsip)
            .where(eq(jadwalRetensiArsip.ruleSetId, ruleSet.id))
            .orderBy(asc(jadwalRetensiArsip.kode));
    }

    async cloneActive(
        instrumentType: RegulatoryInstrumentType,
        input: CloneActiveRuleSetInput,
        actorId?: string,
    ) {
        try {
            return await db.transaction(async (tx: any) => {
                const [active] = await tx
                    .select()
                    .from(regulatoryRuleSets)
                    .where(and(
                        eq(regulatoryRuleSets.instrumentType, instrumentType),
                        eq(regulatoryRuleSets.status, 'active'),
                    ))
                    .limit(1)
                    .for('share');
                if (!active) throw new NotFoundError(`Aturan aktif ${instrumentType}`);

                const inheritedMetadata = withoutComputedMetadata(active.metadata);
                const requestedMetadata = withoutComputedMetadata(input.metadata);
                const [draft] = await tx
                    .insert(regulatoryRuleSets)
                    .values({
                        instrumentType,
                        version: input.version,
                        name: input.name ?? active.name,
                        legalBasis: input.legalBasis ?? active.legalBasis,
                        regulationNumber: input.regulationNumber ?? active.regulationNumber,
                        sourceDocumentName: input.sourceDocumentName === undefined
                            ? active.sourceDocumentName
                            : input.sourceDocumentName,
                        sourceDocumentSha256: input.sourceDocumentSha256 === undefined
                            ? active.sourceDocumentSha256
                            : input.sourceDocumentSha256,
                        sourceUrl: input.sourceUrl === undefined ? active.sourceUrl : input.sourceUrl,
                        status: 'draft',
                        effectiveFrom: input.effectiveFrom,
                        effectiveTo: null,
                        supersedesId: active.id,
                        changeSummary: input.changeSummary ?? null,
                        metadata: { ...inheritedMetadata, ...requestedMetadata },
                        publishedAt: null,
                        publishedBy: null,
                        createdBy: actorId || null,
                    })
                    .returning();

                const sourceItems = await this.getItems(tx, active);
                const batchSize = 250;
                for (let offset = 0; offset < sourceItems.length; offset += batchSize) {
                    const batch = sourceItems.slice(offset, offset + batchSize);
                    if (instrumentType === 'klasifikasi') {
                        await tx.insert(klasifikasiArsip).values(batch.map((item) => ({
                            ruleSetId: draft.id,
                            kode: item.kode,
                            sourceCode: item.sourceCode || item.kode,
                            sourceRecordKey: item.sourceRecordKey,
                            organizationalScope: item.organizationalScope || 'kementerian',
                            jenis: item.jenis,
                            keterangan: item.keterangan,
                            kategori: item.kategori,
                            parentKode: item.parentKode,
                            tipe: item.tipe,
                            level: item.level,
                            isActive: item.isActive,
                            isSelectable: item.isSelectable,
                            sourcePage: item.sourcePage,
                            contentHash: deterministicRegulatoryContentHash('klasifikasi', [item]),
                        })));
                    } else {
                        await tx.insert(jadwalRetensiArsip).values(batch.map((item) => ({
                            ruleSetId: draft.id,
                            kode: item.kode,
                            uraian: item.uraian,
                            retensiAktif: item.retensiAktif,
                            retensiInaktif: item.retensiInaktif,
                            keterangan: item.keterangan,
                            kategori: item.kategori,
                            parentKode: item.parentKode,
                            tipe: item.tipe,
                            level: item.level,
                            isActive: item.isActive,
                            isSelectable: item.isSelectable,
                            activeMonths: item.activeMonths,
                            inactiveMonths: item.inactiveMonths,
                            calculationMode: item.calculationMode,
                            dispositionCode: item.dispositionCode,
                            triggerGuidance: item.triggerGuidance,
                            sourcePage: item.sourcePage,
                            contentHash: deterministicRegulatoryContentHash('jra', [item]),
                        })));
                    }
                }

                return {
                    ruleSet: presentRuleSet(draft),
                    clonedFrom: presentRuleSet(active),
                    itemCount: sourceItems.length,
                };
            });
        } catch (error) {
            if (isUniqueViolation(error)) {
                throw new ConflictError(`Versi ${input.version} sudah ada untuk ${instrumentType}.`);
            }
            throw error;
        }
    }

    async validateDraft(id: string): Promise<RuleSetValidationReport> {
        const [ruleSet] = await db
            .select()
            .from(regulatoryRuleSets)
            .where(eq(regulatoryRuleSets.id, id))
            .limit(1);
        if (!ruleSet) throw new NotFoundError('Versi aturan');
        if (ruleSet.status !== 'draft') {
            throw new ConflictError('Hanya draft yang dapat divalidasi untuk publikasi.');
        }

        const items = await this.getItems(db, ruleSet);
        const report = validateRegulatoryRuleItems(
            ruleSet.instrumentType as RegulatoryInstrumentType,
            items,
        );
        applyDeclaredCompletenessChecks(report, ruleSet.metadata);
        if (!ruleSet.sourceDocumentSha256) {
            addIssue(
                report.errors,
                'missing_source_hash',
                'Dokumen sumber wajib memiliki SHA-256 sebelum versi aturan dipublikasikan.',
            );
            report.valid = false;
        }
        return report;
    }

    async replaceDraftItems(
        id: string,
        input: ImportRegulatoryRuleItemsInput,
    ) {
        return db.transaction(async (tx: any) => {
            const [ruleSet] = await tx
                .select()
                .from(regulatoryRuleSets)
                .where(eq(regulatoryRuleSets.id, id))
                .limit(1)
                .for('update');
            if (!ruleSet) throw new NotFoundError('Versi aturan');
            if (ruleSet.status !== 'draft') {
                throw new ConflictError('Impor hanya boleh mengganti isi versi draft. Versi terbit bersifat immutable.');
            }

            const instrumentType = ruleSet.instrumentType as RegulatoryInstrumentType;
            const hasWrongShape = input.items.some((item: any) => instrumentType === 'klasifikasi'
                ? !String(item.jenis || '').trim() || Boolean(item.uraian)
                : !String(item.uraian || '').trim() || Boolean(item.jenis));
            if (hasWrongShape) {
                throw new ValidationError(`Manifest item tidak sesuai dengan instrumen ${instrumentType}.`);
            }

            const items = input.items.map((item: any) => ({
                ...item,
                sourceCode: instrumentType === 'klasifikasi' ? (item.sourceCode || item.kode) : undefined,
            }));
            const report = validateRegulatoryRuleItems(instrumentType, items);
            applyDeclaredCompletenessChecks(report, ruleSet.metadata);
            if (!report.valid) throw new RegulatoryRuleSetValidationError(report);

            if (instrumentType === 'klasifikasi') {
                await tx.delete(klasifikasiArsip).where(eq(klasifikasiArsip.ruleSetId, id));
            } else {
                await tx.delete(jadwalRetensiArsip).where(eq(jadwalRetensiArsip.ruleSetId, id));
            }

            const batchSize = 250;
            for (let offset = 0; offset < items.length; offset += batchSize) {
                const batch = items.slice(offset, offset + batchSize);
                if (instrumentType === 'klasifikasi') {
                    await tx.insert(klasifikasiArsip).values(batch.map((item: any) => ({
                        ...item,
                        ruleSetId: id,
                        contentHash: deterministicRegulatoryContentHash('klasifikasi', [item]),
                    })));
                } else {
                    await tx.insert(jadwalRetensiArsip).values(batch.map((item: any) => ({
                        ...item,
                        ruleSetId: id,
                        contentHash: deterministicRegulatoryContentHash('jra', [item]),
                    })));
                }
            }

            return {
                ruleSet: presentRuleSet(ruleSet),
                imported: items.length,
                validation: report,
            };
        });
    }

    async activate(id: string, actorId?: string) {
        try {
            return await db.transaction(async (tx: any) => {
                const [candidate] = await tx
                    .select()
                    .from(regulatoryRuleSets)
                    .where(eq(regulatoryRuleSets.id, id))
                    .limit(1)
                    .for('update');
                if (!candidate) throw new NotFoundError('Versi aturan');
                if (candidate.status !== 'draft') {
                    throw new ConflictError('Versi yang sudah dipublikasikan bersifat immutable; aktifkan hanya draft.');
                }

                const instrumentType = candidate.instrumentType as RegulatoryInstrumentType;
                const items = await this.getItems(tx, candidate);
                const report = validateRegulatoryRuleItems(instrumentType, items);
                applyDeclaredCompletenessChecks(report, candidate.metadata);
                if (!candidate.sourceDocumentSha256) {
                    addIssue(
                        report.errors,
                        'missing_source_hash',
                        'Dokumen sumber wajib memiliki SHA-256 sebelum versi aturan dipublikasikan.',
                    );
                    report.valid = false;
                }
                if (!report.valid) throw new RegulatoryRuleSetValidationError(report);
                if (candidate.effectiveFrom > jakartaToday()) {
                    throw new ValidationError(
                        'Tanggal berlaku masih di masa depan. Aktifkan versi pada atau setelah tanggal berlakunya.',
                    );
                }

                // Refresh only changed/manual draft rows. The per-item digest is
                // later copied into every archive decision snapshot, while the
                // set digest below protects the edition as a whole.
                for (const item of items) {
                    const itemHash = deterministicRegulatoryContentHash(instrumentType, [item]);
                    if (item.contentHash === itemHash) continue;
                    if (instrumentType === 'klasifikasi') {
                        await tx.update(klasifikasiArsip)
                            .set({ contentHash: itemHash, updatedAt: new Date() })
                            .where(and(
                                eq(klasifikasiArsip.id, item.id),
                                eq(klasifikasiArsip.ruleSetId, candidate.id),
                            ));
                    } else {
                        await tx.update(jadwalRetensiArsip)
                            .set({ contentHash: itemHash, updatedAt: new Date() })
                            .where(and(
                                eq(jadwalRetensiArsip.id, item.id),
                                eq(jadwalRetensiArsip.ruleSetId, candidate.id),
                            ));
                    }
                }

                const [current] = await tx
                    .select()
                    .from(regulatoryRuleSets)
                    .where(and(
                        eq(regulatoryRuleSets.instrumentType, instrumentType),
                        eq(regulatoryRuleSets.status, 'active'),
                    ))
                    .limit(1)
                    .for('update');

                let superseded: RegulatoryRuleSet | null = null;
                if (current) {
                    if (candidate.supersedesId !== current.id) {
                        throw new ConflictError(
                            'Draft tidak lagi menunjuk versi aktif terkini. Buat clone baru dari versi aktif.',
                        );
                    }
                    if (candidate.effectiveFrom <= current.effectiveFrom) {
                        throw new ValidationError(
                            'Tanggal berlaku versi pengganti harus setelah versi aktif saat ini.',
                        );
                    }

                    const [updatedCurrent] = await tx
                        .update(regulatoryRuleSets)
                        .set({
                            status: 'superseded',
                            effectiveTo: previousIsoDate(candidate.effectiveFrom),
                            updatedAt: new Date(),
                        })
                        .where(and(
                            eq(regulatoryRuleSets.id, current.id),
                            eq(regulatoryRuleSets.status, 'active'),
                        ))
                        .returning();
                    if (!updatedCurrent) {
                        throw new ConflictError('Versi aktif berubah selama proses aktivasi.');
                    }
                    superseded = updatedCurrent;
                } else if (candidate.supersedesId) {
                    throw new ConflictError('Versi yang hendak digantikan tidak lagi aktif.');
                }

                const now = new Date();
                const metadata = {
                    ...asJsonObject(candidate.metadata),
                    contentHash: report.contentHash,
                    contentHashAlgorithm: 'sha256',
                    contentSchemaVersion: 1,
                    contentItemCount: report.stats.total,
                    validatedAt: now.toISOString(),
                };
                const [activated] = await tx
                    .update(regulatoryRuleSets)
                    .set({
                        status: 'active',
                        effectiveTo: null,
                        metadata,
                        publishedAt: now,
                        publishedBy: actorId || null,
                        updatedAt: now,
                    })
                    .where(and(
                        eq(regulatoryRuleSets.id, candidate.id),
                        eq(regulatoryRuleSets.status, 'draft'),
                    ))
                    .returning();
                if (!activated) {
                    throw new ConflictError('Status draft berubah selama proses aktivasi.');
                }

                return {
                    ruleSet: presentRuleSet(activated),
                    supersededRuleSet: superseded ? presentRuleSet(superseded) : null,
                    validation: report,
                };
            });
        } catch (error) {
            if (isUniqueViolation(error)) {
                throw new ConflictError('Sudah ada versi aktif untuk jenis instrumen ini.');
            }
            throw error;
        }
    }
}

export const regulatoryRuleSetService = new RegulatoryRuleSetService();
export default regulatoryRuleSetService;
