import { createHash, randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '../config/database';
import {
    jadwalRetensiArsip,
    klasifikasiArsip,
    arsip,
    arsipRuleSnapshots,
    fileAttachments,
    regulatoryRuleEvents,
    regulatoryRuleSets,
    KLASIFIKASI_RULE_SET_2018_ID,
    JRA_RULE_SET_2020_ID,
    type RegulatoryRuleSet,
} from '../db/schema';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import type {
    CloneActiveRuleSetInput,
    ImportRegulatoryRuleItemsInput,
    ListRegulatoryRuleSetsQuery,
    RegulatoryCompletenessManifestInput,
    RegulatoryInstrumentType,
    VerifyRegulatorySourceBlobInput,
} from '../validators/regulatory-rule-set.schemas';
import {
    appendRegulatoryEvents,
    regulatoryEvidenceHash,
    verifyRegulatoryEventChain,
    type GovernanceAuditContext,
    type RegulatoryEventInput,
} from './regulatory-audit.service';
import { blobStorageService } from './blob-storage.service';
import {
    clientBlobUploadService,
    type ClaimClientBlobUpload,
} from './client-blob-upload.service.js';
import { parseGcsLocator, toGcsLocator } from '../storage/locator.js';
import {
    durableFinalObjectService,
    type FinalObjectWrite,
} from './durable-final-object.service.js';

type RuleItem = Record<string, any>;
type JsonObject = Record<string, unknown>;

export const REGULATORY_SOURCE_MAX_BYTES = 50 * 1024 * 1024;

interface VerifiedSourceDocument {
    originalName: string;
    sha256: string;
    sizeBytes: number;
    pageCount: number;
    blobUrl: string;
    objectGeneration: string | null;
}

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

export interface RuleSetDiffItem {
    identity: string;
    kode: string;
    itemId: number | null;
    changedFields?: string[];
    beforeHash?: string;
    afterHash?: string;
}

export interface RuleSetImpactReport {
    schemaVersion: 1;
    instrumentType: RegulatoryInstrumentType;
    candidateRuleSetId: string;
    predecessorRuleSetId: string | null;
    candidateContentHash: string;
    predecessorContentHash: string | null;
    diff: {
        added: RuleSetDiffItem[];
        removed: RuleSetDiffItem[];
        changed: RuleSetDiffItem[];
        unchangedCount: number;
    };
    archiveImpact: {
        usingPredecessor: number;
        affectedByChangedOrRemovedRules: number;
        operationalAffected: number;
        legalHoldAffected: number;
        snapshotReferences: number;
    };
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

function pageCovered(page: number, ranges: Array<{ start: number; end: number }>): boolean {
    return ranges.some(({ start, end }) => page >= start && page <= end);
}

function applyGovernanceReadinessChecks(
    report: RuleSetValidationReport,
    ruleSet: RegulatoryRuleSet,
    items: RuleItem[],
    requireImpact = true,
) {
    const officialBaseline = [KLASIFIKASI_RULE_SET_2018_ID, JRA_RULE_SET_2020_ID].includes(ruleSet.id);
    const manifest = asJsonObject(ruleSet.completenessManifest) as Partial<RegulatoryCompletenessManifestInput>;
    const ranges = Array.isArray(manifest.coveredPageRanges)
        ? manifest.coveredPageRanges.filter((range: any) => (
            Number.isInteger(range?.start) && Number.isInteger(range?.end)
        )) as Array<{ start: number; end: number }>
        : [];

    if (!ruleSet.sourceDocumentSha256 || !ruleSet.sourceDocumentVerifiedAt) {
        addIssue(
            report.errors,
            'unverified_source_document',
            'Dokumen sumber wajib diunggah dan SHA-256 dihitung oleh server sebelum publikasi.',
        );
    }
    if (!officialBaseline && !ruleSet.sourceDocumentVerifiedBy) {
        addIssue(
            report.errors,
            'missing_source_verifier',
            'Aktor yang melakukan verifikasi byte PDF sumber wajib tercatat.',
        );
    }
    if (ruleSet.sourceDocumentMimeType !== 'application/pdf') {
        addIssue(report.errors, 'invalid_source_mime', 'Dokumen sumber terverifikasi harus berformat PDF.');
    }
    if (!officialBaseline && !ruleSet.sourceDocumentBlobUrl) {
        addIssue(
            report.errors,
            'missing_source_bitstream',
            'Byte PDF sumber wajib disimpan pada private Blob yang terikat ke versi aturan.',
        );
    } else if (ruleSet.sourceDocumentBlobUrl) {
        try {
            assertRegulatorySourceBlobLocator(ruleSet.id, ruleSet.sourceDocumentBlobUrl);
            assertRegulatorySourceObjectGeneration(
                ruleSet.sourceDocumentBlobUrl,
                ruleSet.sourceDocumentObjectGeneration,
            );
        } catch {
            addIssue(
                report.errors,
                'invalid_source_bitstream_locator',
                'Locator byte PDF sumber tidak valid atau tidak terikat ke versi aturan.',
            );
        }
    }
    if (!officialBaseline && (!Number.isInteger(ruleSet.sourceDocumentSizeBytes)
        || Number(ruleSet.sourceDocumentSizeBytes) <= 0)) {
        addIssue(report.errors, 'missing_source_size', 'Ukuran PDF sumber belum diverifikasi server.');
    }
    if (!Number.isInteger(ruleSet.sourceDocumentPageCount)
        || Number(ruleSet.sourceDocumentPageCount) <= 0) {
        addIssue(report.errors, 'missing_source_page_count', 'Jumlah halaman PDF sumber belum diverifikasi server.');
    }
    if (!ruleSet.completenessManifest
        || !ruleSet.completenessManifestSha256
        || !ruleSet.completenessVerifiedAt) {
        addIssue(
            report.errors,
            'unverified_completeness_manifest',
            'Manifest kelengkapan jumlah dan cakupan halaman wajib diverifikasi.',
        );
    } else if (regulatoryEvidenceHash(ruleSet.completenessManifest) !== ruleSet.completenessManifestSha256) {
        addIssue(report.errors, 'manifest_hash_mismatch', 'Hash manifest kelengkapan tidak sesuai isinya.');
    }
    if (!Number.isInteger(manifest.expectedItemCount)
        || manifest.expectedItemCount !== report.stats.total) {
        addIssue(
            report.errors,
            'incomplete_source_item_count',
            `Jumlah butir ${report.stats.total} tidak sama dengan manifest (${manifest.expectedItemCount ?? 'belum diisi'}).`,
        );
    }
    if (!Number.isInteger(manifest.expectedSelectableCount)
        || manifest.expectedSelectableCount !== report.stats.selectable) {
        addIssue(
            report.errors,
            'incomplete_selectable_item_count',
            `Jumlah butir selectable ${report.stats.selectable} tidak sama dengan manifest (${manifest.expectedSelectableCount ?? 'belum diisi'}).`,
        );
    }
    if (!Number.isInteger(manifest.sourcePageCount)
        || manifest.sourcePageCount !== ruleSet.sourceDocumentPageCount) {
        addIssue(
            report.errors,
            'source_page_count_mismatch',
            'Jumlah halaman manifest tidak sama dengan hasil pembacaan PDF oleh server.',
        );
    }
    if (ranges.length === 0) {
        addIssue(report.errors, 'missing_page_coverage', 'Manifest wajib menyatakan rentang halaman sumber yang diperiksa.');
    }
    for (const item of items) {
        const page = Number(item.sourcePage);
        if (!Number.isInteger(page) || page <= 0) {
            addIssue(report.errors, 'missing_item_source_page', 'Butir tidak memiliki halaman sumber.', item.kode);
        } else if (!pageCovered(page, ranges)) {
            addIssue(
                report.errors,
                'item_outside_page_coverage',
                `Halaman sumber ${page} berada di luar cakupan manifest.`,
                item.kode,
            );
        }
    }
    if (ruleSet.supersedesId && String(ruleSet.changeSummary || '').trim().length < 10) {
        addIssue(report.errors, 'missing_change_summary', 'Ringkasan perubahan wajib diisi untuk edisi pengganti.');
    }

    if (requireImpact) {
        const impact = asJsonObject(ruleSet.impactReport);
        if (!ruleSet.impactReport || !ruleSet.impactReportSha256 || !ruleSet.impactReportGeneratedAt) {
            addIssue(report.errors, 'missing_impact_report', 'Diff dan analisis dampak wajib dibuat sebelum pengajuan.');
        } else if (regulatoryEvidenceHash(ruleSet.impactReport) !== ruleSet.impactReportSha256) {
            addIssue(report.errors, 'impact_report_hash_mismatch', 'Hash laporan dampak tidak sesuai isinya.');
        } else if (impact.candidateContentHash !== report.contentHash) {
            addIssue(report.errors, 'stale_impact_report', 'Isi draft berubah setelah laporan dampak dibuat. Buat laporan baru.');
        }
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
    const {
        sourceDocumentBlobUrl,
        sourceDocumentObjectGeneration: _sourceDocumentObjectGeneration,
        ...visibleRuleSet
    } = ruleSet;
    return {
        ...visibleRuleSet,
        // The private object URL is an internal locator, not an access grant or
        // public API field. Clients only need to know whether the exact bytes
        // have been retained.
        sourceDocumentStored: Boolean(sourceDocumentBlobUrl),
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

function ruleIdentity(instrumentType: RegulatoryInstrumentType, item: RuleItem): string {
    return instrumentType === 'klasifikasi'
        ? String(item.sourceRecordKey || '').trim()
        : String(item.kode || '').trim();
}

function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
        .filter((key) => stableJson(before[key]) !== stableJson(after[key]))
        .sort();
}

export function buildRegulatoryDiff(
    instrumentType: RegulatoryInstrumentType,
    candidateItems: RuleItem[],
    predecessorItems: RuleItem[],
) {
    const candidate = new Map(candidateItems.map((item) => [ruleIdentity(instrumentType, item), item]));
    const predecessor = new Map(predecessorItems.map((item) => [ruleIdentity(instrumentType, item), item]));
    const added: RuleSetDiffItem[] = [];
    const removed: RuleSetDiffItem[] = [];
    const changed: RuleSetDiffItem[] = [];
    let unchangedCount = 0;

    for (const [identity, item] of candidate) {
        const previous = predecessor.get(identity);
        const after = comparableItem(instrumentType, item) as Record<string, unknown>;
        if (!previous) {
            added.push({
                identity,
                kode: String(item.kode),
                itemId: Number.isInteger(item.id) ? item.id : null,
                afterHash: regulatoryEvidenceHash(after),
            });
            continue;
        }
        const before = comparableItem(instrumentType, previous) as Record<string, unknown>;
        const fields = changedFields(before, after);
        if (fields.length === 0) {
            unchangedCount += 1;
        } else {
            changed.push({
                identity,
                kode: String(item.kode),
                itemId: Number.isInteger(previous.id) ? previous.id : null,
                changedFields: fields,
                beforeHash: regulatoryEvidenceHash(before),
                afterHash: regulatoryEvidenceHash(after),
            });
        }
    }
    for (const [identity, item] of predecessor) {
        if (candidate.has(identity)) continue;
        removed.push({
            identity,
            kode: String(item.kode),
            itemId: Number.isInteger(item.id) ? item.id : null,
            beforeHash: regulatoryEvidenceHash(comparableItem(instrumentType, item)),
        });
    }
    const byIdentity = (left: RuleSetDiffItem, right: RuleSetDiffItem) => left.identity.localeCompare(right.identity);
    return {
        added: added.sort(byIdentity),
        removed: removed.sort(byIdentity),
        changed: changed.sort(byIdentity),
        unchangedCount,
    };
}

async function pdfPageCount(buffer: Buffer): Promise<number> {
    try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const document = await pdfjs.getDocument({
            data: new Uint8Array(buffer),
            useWorkerFetch: false,
        }).promise;
        const count = document.numPages;
        await document.destroy();
        return count;
    } catch {
        throw new ValidationError('PDF sumber tidak dapat dibaca atau rusak.');
    }
}

function sourceLocatorFingerprint(
    blobUrl: string | null | undefined,
    generation?: string | null,
): string | null {
    if (!blobUrl) return null;
    const immutableIdentity = generation ? `${blobUrl}#generation=${generation}` : blobUrl;
    return createHash('sha256').update(immutableIdentity, 'utf8').digest('hex');
}

/**
 * Validate that a private object locator is bound specifically to this rule
 * set. This rejects public/signed URLs, encoded separators, and cross-rule-set
 * substitution for both the legacy Blob store and Cloud Storage.
 */
export function assertRegulatorySourceBlobLocator(ruleSetId: string, candidate: string): string {
    if (candidate.startsWith('gs://')) {
        try {
            const parsed = parseGcsLocator(candidate);
            const segments = parsed.objectName.split('/');
            if (
                segments.length !== 3
                || segments[0] !== 'regulatory-sources'
                || segments[1] !== ruleSetId.toLowerCase()
                || !segments[2]
                || /[\\/\u0000-\u001f\u007f]/.test(segments[2])
            ) {
                throw new Error('Unexpected regulatory namespace');
            }
            return toGcsLocator(parsed.bucket, parsed.objectName);
        } catch {
            throw new ValidationError('Locator Cloud Storage PDF sumber tidak valid atau tidak terikat pada versi aturan ini.');
        }
    }

    let url: URL;
    try {
        url = new URL(candidate);
    } catch {
        throw new ValidationError('Locator Blob PDF sumber tidak valid.');
    }
    if (
        url.protocol !== 'https:'
        || !url.hostname.endsWith('.private.blob.vercel-storage.com')
        || url.username
        || url.password
        || url.port
        || url.search
        || url.hash
    ) {
        throw new ValidationError('PDF sumber harus berada pada penyimpanan privat tanpa URL akses sementara.');
    }
    if (/%2f|%5c|%2e/i.test(url.pathname)) {
        throw new ValidationError('Path Blob PDF sumber mengandung encoding yang tidak diizinkan.');
    }
    const rawSegments = url.pathname.split('/');
    if (rawSegments.length !== 4 || rawSegments[0] !== '') {
        throw new ValidationError('Path Blob PDF sumber tidak sesuai namespace regulasi.');
    }
    let folder: string;
    let boundRuleSetId: string;
    let objectName: string;
    try {
        [, folder, boundRuleSetId, objectName] = rawSegments.map(decodeURIComponent);
    } catch {
        throw new ValidationError('Path Blob PDF sumber tidak dapat dibaca.');
    }
    if (
        folder !== 'regulatory-sources'
        || boundRuleSetId !== ruleSetId.toLowerCase()
        || !objectName
        || objectName === '.'
        || objectName === '..'
        || /[\\/\u0000-\u001f\u007f]/.test(objectName)
    ) {
        throw new ValidationError('Blob PDF sumber tidak terikat pada versi aturan ini.');
    }
    return url.href;
}

export function assertRegulatorySourceObjectGeneration(
    blobUrl: string,
    generation: string | null | undefined,
): string | undefined {
    if (blobUrl.startsWith('gs://')) {
        if (!generation || !/^\d+$/.test(generation)) {
            throw new ValidationError('Generasi immutable PDF sumber Cloud Storage tidak tersedia.');
        }
        return generation;
    }
    if (generation) {
        throw new ValidationError('Generasi Cloud Storage tidak boleh dipasang pada sumber non-GCS.');
    }
    return undefined;
}

function safeRegulatorySourceFileName(originalName: string): string {
    const normalized = originalName
        .normalize('NFKC')
        .replace(/[\\/\u0000-\u001f\u007f]/g, '_')
        .replace(/\.{2,}/g, '.')
        .trim();
    const withExtension = normalized.toLowerCase().endsWith('.pdf')
        ? normalized
        : `${normalized || 'source-document'}.pdf`;
    return withExtension.slice(-240);
}

async function readLimitedStream(stream: NodeJS.ReadableStream, maximumBytes: number): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stream as AsyncIterable<Buffer | Uint8Array | string>) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += bytes.length;
        if (total > maximumBytes) {
            if (typeof (stream as any).destroy === 'function') (stream as any).destroy();
            throw new ValidationError('PDF sumber melebihi batas 50 MB.');
        }
        chunks.push(bytes);
    }
    return Buffer.concat(chunks, total);
}

async function inspectSourcePdf(
    buffer: Buffer,
    declaredSize: number,
): Promise<{ sha256: string; pageCount: number }> {
    if (declaredSize <= 0 || declaredSize !== buffer.length) {
        throw new ValidationError('Ukuran dokumen sumber tidak valid.');
    }
    if (declaredSize > REGULATORY_SOURCE_MAX_BYTES) {
        throw new ValidationError('PDF sumber melebihi batas 50 MB.');
    }
    if (!buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
        throw new ValidationError('Dokumen sumber harus berupa PDF dengan signature yang valid.');
    }
    const [sha256, pageCount] = await Promise.all([
        Promise.resolve(createHash('sha256').update(buffer).digest('hex')),
        pdfPageCount(buffer),
    ]);
    return { sha256, pageCount };
}

/**
 * Resolve an internal private-object locator, retrieve the exact object bytes,
 * and derive every piece of source evidence on the server. This is shared by
 * direct uploads and explicit source reuse so neither path can trust a hash,
 * page count, MIME type, or size supplied by a client or inherited blindly.
 */
async function retrieveAndInspectSourceBlob(
    ruleSetId: string,
    candidateUrl: string,
    candidateGeneration?: string | null,
): Promise<Omit<VerifiedSourceDocument, 'originalName'>> {
    const blobUrl = assertRegulatorySourceBlobLocator(ruleSetId, candidateUrl);
    const objectGeneration = assertRegulatorySourceObjectGeneration(blobUrl, candidateGeneration);
    const metadata = await blobStorageService.getFile(blobUrl, { generation: objectGeneration });
    if (!metadata) throw new ValidationError('Objek private Blob PDF sumber tidak ditemukan.');
    const canonicalMetadataUrl = assertRegulatorySourceBlobLocator(ruleSetId, metadata.url);
    if (canonicalMetadataUrl !== blobUrl) {
        throw new ValidationError('Locator Blob tidak sama dengan objek canonical pada penyimpanan.');
    }
    if (objectGeneration && metadata.generation !== objectGeneration) {
        throw new ValidationError('Metadata PDF sumber berasal dari generasi Cloud Storage yang berbeda.');
    }
    if (metadata.mimeType !== 'application/pdf') {
        throw new ValidationError('Content-Type objek sumber harus application/pdf.');
    }
    if (!Number.isInteger(metadata.size) || Number(metadata.size) <= 0) {
        throw new ValidationError('Ukuran objek private Blob tidak valid.');
    }
    if (Number(metadata.size) > REGULATORY_SOURCE_MAX_BYTES) {
        throw new ValidationError('PDF sumber melebihi batas 50 MB.');
    }

    const downloaded = await blobStorageService.downloadFile(blobUrl, {
        generation: objectGeneration,
        throwOnError: true,
    });
    if (!downloaded) throw new ValidationError('Byte PDF sumber tidak dapat diambil dari private Blob.');
    if (downloaded.mimeType !== 'application/pdf') {
        if (typeof (downloaded.stream as any).destroy === 'function') downloaded.stream.destroy();
        throw new ValidationError('Content-Type byte PDF sumber tidak sesuai metadata.');
    }
    const buffer = await readLimitedStream(downloaded.stream, REGULATORY_SOURCE_MAX_BYTES);
    if (buffer.length !== metadata.size) {
        throw new ValidationError('Ukuran byte unduhan berbeda dari metadata private Blob.');
    }
    const { sha256, pageCount } = await inspectSourcePdf(buffer, buffer.length);
    return {
        sha256,
        sizeBytes: buffer.length,
        pageCount,
        blobUrl,
        objectGeneration: objectGeneration || null,
    };
}

function governanceContext(
    actorId?: string,
    context: Omit<GovernanceAuditContext, 'actorId'> = {},
): GovernanceAuditContext {
    return { ...context, actorId };
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

    /**
     * Retrieve a verified source PDF for an authenticated application route.
     * The private locator never leaves this service; callers receive only the
     * stream and safe response metadata.
     */
    async getSourceDocumentStream(id: string) {
        const [ruleSet] = await db
            .select()
            .from(regulatoryRuleSets)
            .where(eq(regulatoryRuleSets.id, id))
            .limit(1);
        if (!ruleSet) throw new NotFoundError('Versi aturan');
        if (!ruleSet.sourceDocumentBlobUrl) {
            const baseline = [KLASIFIKASI_RULE_SET_2018_ID, JRA_RULE_SET_2020_ID].includes(ruleSet.id);
            throw new ConflictError(baseline
                ? 'PDF sumber baseline lama belum dimigrasikan ke private Blob; auditor belum dapat melihat bitstream.'
                : 'PDF sumber belum disimpan pada private Blob untuk versi aturan ini.');
        }
        if (!ruleSet.sourceDocumentSha256 || !ruleSet.sourceDocumentVerifiedAt) {
            throw new ConflictError('PDF sumber belum memiliki bukti verifikasi server yang lengkap.');
        }

        const blobUrl = assertRegulatorySourceBlobLocator(id, ruleSet.sourceDocumentBlobUrl);
        const objectGeneration = assertRegulatorySourceObjectGeneration(
            blobUrl,
            ruleSet.sourceDocumentObjectGeneration,
        );
        const metadata = await blobStorageService.getFile(blobUrl, { generation: objectGeneration });
        if (!metadata) throw new ConflictError('PDF sumber tidak lagi tersedia pada private Blob.');
        if (
            assertRegulatorySourceBlobLocator(id, metadata.url) !== blobUrl
            || (objectGeneration && metadata.generation !== objectGeneration)
            || metadata.mimeType !== 'application/pdf'
            || !Number.isInteger(metadata.size)
            || Number(metadata.size) <= 0
            || Number(metadata.size) > REGULATORY_SOURCE_MAX_BYTES
            || (Number.isInteger(ruleSet.sourceDocumentSizeBytes)
                && metadata.size !== ruleSet.sourceDocumentSizeBytes)
        ) {
            throw new ConflictError('Metadata PDF private Blob tidak sama dengan bukti sumber terverifikasi.');
        }

        const downloaded = await blobStorageService.downloadFile(blobUrl, {
            generation: objectGeneration,
            throwOnError: true,
        });
        if (!downloaded) throw new ConflictError('Byte PDF sumber tidak dapat diambil dari private Blob.');
        if (downloaded.mimeType !== 'application/pdf') {
            if (typeof (downloaded.stream as any).destroy === 'function') downloaded.stream.destroy();
            throw new ConflictError('Content-Type PDF sumber berubah dari bukti yang diverifikasi.');
        }
        return {
            stream: downloaded.stream,
            fileName: safeRegulatorySourceFileName(
                ruleSet.sourceDocumentName
                || `${ruleSet.instrumentType}-${ruleSet.version}.pdf`,
            ),
            sizeBytes: Number(metadata.size),
        };
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

    private async assertStoredSourceAvailable(ruleSet: RegulatoryRuleSet): Promise<void> {
        if ([KLASIFIKASI_RULE_SET_2018_ID, JRA_RULE_SET_2020_ID].includes(ruleSet.id)) return;
        if (!ruleSet.sourceDocumentBlobUrl) {
            throw new ConflictError('Byte PDF sumber belum disimpan pada private Blob.');
        }
        const blobUrl = assertRegulatorySourceBlobLocator(ruleSet.id, ruleSet.sourceDocumentBlobUrl);
        const objectGeneration = assertRegulatorySourceObjectGeneration(
            blobUrl,
            ruleSet.sourceDocumentObjectGeneration,
        );
        const metadata = await blobStorageService.getFile(blobUrl, { generation: objectGeneration });
        if (!metadata) throw new ConflictError('Byte PDF sumber tidak lagi tersedia pada private Blob.');
        if (
            assertRegulatorySourceBlobLocator(ruleSet.id, metadata.url) !== blobUrl
            || (objectGeneration && metadata.generation !== objectGeneration)
            || metadata.mimeType !== 'application/pdf'
            || metadata.size !== ruleSet.sourceDocumentSizeBytes
        ) {
            throw new ConflictError('Metadata byte PDF sumber berubah dari bukti yang telah diverifikasi.');
        }
    }

    private async isMaterialContributor(executor: any, ruleSetId: string, actorId: string) {
        const [event] = await executor.select({ id: regulatoryRuleEvents.id })
            .from(regulatoryRuleEvents)
            .where(and(
                eq(regulatoryRuleEvents.ruleSetId, ruleSetId),
                eq(regulatoryRuleEvents.actorId, actorId),
                or(
                    inArray(regulatoryRuleEvents.entityType, ['item', 'source_document', 'manifest', 'impact']),
                    eq(regulatoryRuleEvents.action, 'clone'),
                ),
            ))
            .limit(1);
        return Boolean(event);
    }

    async cloneActive(
        instrumentType: RegulatoryInstrumentType,
        input: CloneActiveRuleSetInput,
        actorId?: string,
        auditContext: Omit<GovernanceAuditContext, 'actorId'> = {},
    ) {
        let copiedSourceBlobUrl: string | null = null;
        let copiedSourceGeneration: string | null = null;
        let copiedSourceEvidence: Omit<VerifiedSourceDocument, 'originalName'> | null = null;
        let copiedSourceWrite: FinalObjectWrite | null = null;
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
                const reuseVerifiedSource = input.reuseVerifiedSource === true;
                if (reuseVerifiedSource && (
                    input.sourceDocumentName !== undefined
                    || input.sourceDocumentSha256 !== undefined
                    || input.sourceUrl !== undefined
                )) {
                    throw new ValidationError(
                        'Metadata sumber tidak boleh diubah ketika memakai ulang PDF terverifikasi.',
                    );
                }
                if (reuseVerifiedSource && !actorId) {
                    throw new ValidationError(
                        'Aktor wajib tercatat untuk memverifikasi ulang salinan PDF sumber.',
                    );
                }
                if (reuseVerifiedSource && (
                    !active.sourceDocumentSha256
                    || !active.sourceDocumentBlobUrl
                    || active.sourceDocumentMimeType !== 'application/pdf'
                    || !Number.isInteger(active.sourceDocumentSizeBytes)
                    || Number(active.sourceDocumentSizeBytes) <= 0
                    || !Number.isInteger(active.sourceDocumentPageCount)
                    || Number(active.sourceDocumentPageCount) <= 0
                    || !active.sourceDocumentVerifiedAt
                )) {
                    throw new ConflictError(
                        'PDF versi aktif tidak memiliki bukti verifikasi server yang lengkap dan tidak dapat dipakai ulang.',
                    );
                }
                const draftId = randomUUID();
                if (reuseVerifiedSource) {
                    assertRegulatorySourceBlobLocator(active.id, active.sourceDocumentBlobUrl!);
                    const activeSourceGeneration = assertRegulatorySourceObjectGeneration(
                        active.sourceDocumentBlobUrl!,
                        active.sourceDocumentObjectGeneration,
                    );
                    copiedSourceWrite = await durableFinalObjectService.copy(draftId, {
                        sourceUrl: active.sourceDocumentBlobUrl!,
                        sourceGeneration: activeSourceGeneration,
                        folder: `regulatory-sources/${draftId}`,
                        fileName: safeRegulatorySourceFileName(active.sourceDocumentName || 'source-document.pdf'),
                        mimeType: 'application/pdf',
                    });
                    const copied = copiedSourceWrite.stored;
                    copiedSourceBlobUrl = copied.url;
                    copiedSourceGeneration = copied.generation || null;
                    copiedSourceBlobUrl = assertRegulatorySourceBlobLocator(draftId, copiedSourceBlobUrl);
                    copiedSourceEvidence = await retrieveAndInspectSourceBlob(
                        draftId,
                        copiedSourceBlobUrl,
                        copiedSourceGeneration,
                    );
                    if (
                        copiedSourceEvidence.sizeBytes !== active.sourceDocumentSizeBytes
                        || copiedSourceEvidence.pageCount !== active.sourceDocumentPageCount
                        || copiedSourceEvidence.sha256 !== String(active.sourceDocumentSha256).toLowerCase()
                    ) {
                        throw new ValidationError(
                            'Salinan PDF sumber berbeda dari SHA-256, jumlah halaman, atau ukuran sumber terverifikasi.',
                        );
                    }
                }
                const copiedSourceVerifiedAt = copiedSourceEvidence ? new Date() : null;
                const [draft] = await tx
                    .insert(regulatoryRuleSets)
                    .values({
                        id: draftId,
                        instrumentType,
                        version: input.version,
                        name: input.name ?? active.name,
                        legalBasis: input.legalBasis ?? active.legalBasis,
                        regulationNumber: input.regulationNumber ?? active.regulationNumber,
                        sourceDocumentName: reuseVerifiedSource
                            ? active.sourceDocumentName
                            : input.sourceDocumentName ?? null,
                        sourceDocumentSha256: reuseVerifiedSource
                            ? copiedSourceEvidence!.sha256
                            : input.sourceDocumentSha256 ?? null,
                        sourceDocumentBlobUrl: copiedSourceBlobUrl,
                        sourceDocumentObjectGeneration: copiedSourceEvidence?.objectGeneration ?? null,
                        sourceDocumentMimeType: reuseVerifiedSource ? active.sourceDocumentMimeType : null,
                        sourceDocumentSizeBytes: reuseVerifiedSource ? copiedSourceEvidence!.sizeBytes : null,
                        sourceDocumentPageCount: reuseVerifiedSource ? copiedSourceEvidence!.pageCount : null,
                        sourceDocumentVerifiedAt: copiedSourceVerifiedAt,
                        sourceDocumentVerifiedBy: reuseVerifiedSource ? actorId : null,
                        sourceUrl: reuseVerifiedSource ? active.sourceUrl : input.sourceUrl ?? null,
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

                await appendRegulatoryEvents(tx, [{
                    ruleSetId: draft.id,
                    instrumentType,
                    entityType: 'rule_set',
                    action: 'clone',
                    before: { sourceRuleSetId: active.id, sourceVersion: active.version },
                    after: {
                        version: draft.version,
                        status: draft.status,
                        itemCount: sourceItems.length,
                        sourceDocumentServerVerified: reuseVerifiedSource,
                        verifiedSourceReuseExplicit: reuseVerifiedSource,
                    },
                    reason: input.changeSummary || 'Membuat edisi kerja dari aturan aktif.',
                }], governanceContext(actorId, auditContext));

                if (copiedSourceWrite) {
                    await durableFinalObjectService.markReferenced(tx, copiedSourceWrite);
                }

                return {
                    ruleSet: presentRuleSet(draft),
                    clonedFrom: presentRuleSet(active),
                    itemCount: sourceItems.length,
                };
            });
        } catch (error) {
            await durableFinalObjectService.compensate(copiedSourceWrite, error);
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
        if (!['draft', 'submitted', 'reviewed', 'approved'].includes(ruleSet.status)) {
            throw new ConflictError('Hanya versi dalam proses tata kelola yang dapat divalidasi untuk publikasi.');
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
        applyGovernanceReadinessChecks(report, ruleSet, items);
        if (ruleSet.sourceDocumentBlobUrl) {
            try {
                await this.assertStoredSourceAvailable(ruleSet);
            } catch (error) {
                addIssue(
                    report.errors,
                    'source_bitstream_unavailable',
                    error instanceof Error ? error.message : 'Byte PDF sumber tidak dapat diverifikasi pada penyimpanan.',
                );
                report.valid = false;
            }
        }
        return report;
    }

    async replaceDraftItems(
        id: string,
        input: ImportRegulatoryRuleItemsInput,
        actorId?: string,
        auditContext: Omit<GovernanceAuditContext, 'actorId'> = {},
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
            const previousItems = await this.getItems(tx, ruleSet);
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

            await tx.update(regulatoryRuleSets).set({
                completenessManifestSha256: null,
                completenessVerifiedAt: null,
                completenessVerifiedBy: null,
                impactReport: null,
                impactReportSha256: null,
                impactReportGeneratedAt: null,
                impactReportGeneratedBy: null,
                updatedAt: new Date(),
            }).where(and(
                eq(regulatoryRuleSets.id, id),
                eq(regulatoryRuleSets.status, 'draft'),
            ));

            const previousByIdentity = new Map(previousItems.map((item) => [ruleIdentity(instrumentType, item), item]));
            const nextByIdentity = new Map(items.map((item) => [ruleIdentity(instrumentType, item), item]));
            const events: RegulatoryEventInput[] = [];
            for (const [identity, afterItem] of nextByIdentity) {
                const beforeItem = previousByIdentity.get(identity);
                const before = beforeItem ? comparableItem(instrumentType, beforeItem) : null;
                const after = comparableItem(instrumentType, afterItem);
                if (before && stableJson(before) === stableJson(after)) continue;
                events.push({
                    ruleSetId: id,
                    instrumentType,
                    entityType: 'item',
                    itemId: beforeItem?.id ?? null,
                    itemCode: String(afterItem.kode),
                    action: beforeItem ? 'update' : 'create',
                    before,
                    after,
                    reason: auditContext.reason || 'Impor manifest master aturan.',
                });
            }
            for (const [identity, beforeItem] of previousByIdentity) {
                if (nextByIdentity.has(identity)) continue;
                events.push({
                    ruleSetId: id,
                    instrumentType,
                    entityType: 'item',
                    itemId: beforeItem.id ?? null,
                    itemCode: String(beforeItem.kode),
                    action: 'remove',
                    before: comparableItem(instrumentType, beforeItem),
                    after: null,
                    reason: auditContext.reason || 'Butir tidak terdapat dalam manifest pengganti.',
                });
            }
            if (events.length === 0) {
                events.push({
                    ruleSetId: id,
                    instrumentType,
                    entityType: 'rule_set',
                    action: 'import_verified_no_change',
                    before: { itemCount: previousItems.length },
                    after: { itemCount: items.length, contentHash: report.contentHash },
                });
            }
            await appendRegulatoryEvents(tx, events, governanceContext(actorId, auditContext));

            return {
                ruleSet: presentRuleSet(ruleSet),
                imported: items.length,
                validation: report,
            };
        });
    }

    async assertSourceDocumentUploadAllowed(id: string): Promise<void> {
        const [ruleSet] = await db.select({ status: regulatoryRuleSets.status })
            .from(regulatoryRuleSets).where(eq(regulatoryRuleSets.id, id)).limit(1);
        if (!ruleSet) throw new NotFoundError('Versi aturan');
        if (ruleSet.status !== 'draft') {
            throw new ConflictError('PDF sumber hanya dapat diunggah ketika versi berstatus draft.');
        }
    }

    private async persistVerifiedSourceDocument(
        id: string,
        source: VerifiedSourceDocument,
        actorId?: string,
        auditContext: Omit<GovernanceAuditContext, 'actorId'> = {},
        action = 'server_verify_private_blob',
        clientBlobClaim?: ClaimClientBlobUpload,
    ) {
        assertRegulatorySourceObjectGeneration(source.blobUrl, source.objectGeneration);
        return db.transaction(async (tx: any) => {
            const [ruleSet] = await tx.select().from(regulatoryRuleSets)
                .where(eq(regulatoryRuleSets.id, id)).limit(1).for('update');
            if (!ruleSet) throw new NotFoundError('Versi aturan');
            if (ruleSet.status !== 'draft') {
                throw new ConflictError('Dokumen sumber hanya dapat diganti ketika versi berstatus draft.');
            }
            const before = {
                name: ruleSet.sourceDocumentName,
                sha256: ruleSet.sourceDocumentSha256,
                sizeBytes: ruleSet.sourceDocumentSizeBytes,
                pageCount: ruleSet.sourceDocumentPageCount,
                verifiedAt: ruleSet.sourceDocumentVerifiedAt,
                stored: Boolean(ruleSet.sourceDocumentBlobUrl),
                storageLocatorFingerprint: sourceLocatorFingerprint(
                    ruleSet.sourceDocumentBlobUrl,
                    ruleSet.sourceDocumentObjectGeneration,
                ),
            };
            const now = new Date();
            const [updated] = await tx.update(regulatoryRuleSets).set({
                sourceDocumentName: source.originalName,
                sourceDocumentSha256: source.sha256,
                sourceDocumentBlobUrl: source.blobUrl,
                sourceDocumentObjectGeneration: source.objectGeneration,
                sourceDocumentMimeType: 'application/pdf',
                sourceDocumentSizeBytes: source.sizeBytes,
                sourceDocumentPageCount: source.pageCount,
                // Hashing and PDF parsing are ingest evidence, not a malware
                // verdict. The scanner sets this timestamp only after ClamAV
                // returns clean and the exact-generation fixity baseline still
                // matches.
                sourceDocumentVerifiedAt: null,
                sourceDocumentVerifiedBy: actorId || null,
                completenessManifest: null,
                completenessManifestSha256: null,
                completenessVerifiedAt: null,
                completenessVerifiedBy: null,
                impactReport: null,
                impactReportSha256: null,
                impactReportGeneratedAt: null,
                impactReportGeneratedBy: null,
                updatedAt: now,
            }).where(and(
                eq(regulatoryRuleSets.id, id),
                eq(regulatoryRuleSets.status, 'draft'),
            )).returning();
            if (!updated) throw new ConflictError('Status draft berubah saat dokumen diverifikasi.');

            await tx.insert(fileAttachments).values({
                entityId: id,
                entityType: 'regulatory_rule_set',
                fileName: source.originalName,
                fileUrl: source.blobUrl,
                objectGeneration: source.objectGeneration,
                mimeType: 'application/pdf',
                sizeBytes: source.sizeBytes,
                sha256: source.sha256,
                storageAccess: 'private',
                uploadedBy: actorId || null,
                integrityStatus: 'baseline_recorded',
                malwareScanStatus: 'not_scanned',
            });

            if (clientBlobClaim) {
                await clientBlobUploadService.claimWithExecutor(
                    tx,
                    clientBlobClaim,
                    'regulatory_rule_set',
                    id,
                );
            }

            const after = {
                name: source.originalName,
                sha256: source.sha256,
                sizeBytes: source.sizeBytes,
                pageCount: source.pageCount,
                verifiedAt: null,
                malwareScanStatus: 'not_scanned',
                stored: true,
                storageProvider: source.blobUrl.startsWith('gs://')
                    ? 'gcs-private'
                    : 'vercel-private-blob',
                storageLocatorFingerprint: sourceLocatorFingerprint(
                    source.blobUrl,
                    source.objectGeneration,
                ),
            };
            await appendRegulatoryEvents(tx, [{
                ruleSetId: id,
                instrumentType: ruleSet.instrumentType as RegulatoryInstrumentType,
                entityType: 'source_document',
                action,
                before,
                after,
                reason: auditContext.reason || 'Byte PDF private object diunduh, di-hash, lalu dikarantina menunggu ClamAV dan verifikasi fixity.',
            }], governanceContext(actorId, auditContext));
            return {
                ruleSet: presentRuleSet(updated),
                sourceDocument: after,
            };
        });
    }

    /**
     * Small-file fallback.  The server still retains the exact accepted bytes
     * in private Blob before committing their verification evidence.
     */
    async verifySourceDocument(
        id: string,
        file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
        actorId?: string,
        auditContext: Omit<GovernanceAuditContext, 'actorId'> = {},
    ) {
        if (file.mimetype !== 'application/pdf') {
            throw new ValidationError('Dokumen sumber harus berformat PDF.');
        }
        await this.assertSourceDocumentUploadAllowed(id);
        const { sha256, pageCount } = await inspectSourcePdf(file.buffer, file.size);
        const originalName = safeRegulatorySourceFileName(file.originalname);
        const stored = await blobStorageService.uploadUntrustedFile({
            fileName: originalName,
            mimeType: 'application/pdf',
            buffer: file.buffer,
            folder: `regulatory-sources/${id.toLowerCase()}`,
        });
        let blobUrl = stored.url;
        try {
            blobUrl = assertRegulatorySourceBlobLocator(id, blobUrl);
            return await this.persistVerifiedSourceDocument(id, {
                originalName,
                sha256,
                sizeBytes: file.size,
                pageCount,
                blobUrl,
                objectGeneration: assertRegulatorySourceObjectGeneration(blobUrl, stored.generation) ?? null,
            }, actorId, auditContext, 'server_upload_verify_private_blob');
        } catch (error) {
            if (blobUrl.startsWith('gs://')) {
                await blobStorageService.deleteFileGeneration(blobUrl, stored.generation);
            } else {
                await blobStorageService.deleteFile(blobUrl);
            }
            throw error;
        }
    }

    /**
     * Large-file path: a tightly scoped client token uploads directly to Blob;
     * the application then independently retrieves and verifies those bytes.
     */
    async verifySourceDocumentFromBlob(
        id: string,
        input: VerifyRegulatorySourceBlobInput,
        actorId?: string,
        auditContext: Omit<GovernanceAuditContext, 'actorId'> = {},
    ) {
        if (!actorId) {
            throw new ValidationError('Aktor wajib tercatat untuk mengklaim unggahan Blob langsung.');
        }
        await this.assertSourceDocumentUploadAllowed(id);
        const claim = {
            blobUrl: input.blobUrl,
            purpose: 'regulatory_source' as const,
            uploadedBy: actorId,
        };
        const lease = await clientBlobUploadService.preAuthorizeClaim(claim, 10 * 60 * 1000);
        const verified = await retrieveAndInspectSourceBlob(
            id,
            input.blobUrl,
            lease.objectGeneration,
        );
        return this.persistVerifiedSourceDocument(id, {
            originalName: safeRegulatorySourceFileName(input.originalFileName),
            ...verified,
        }, actorId, auditContext, 'server_retrieve_verify_private_blob', claim);
    }

    async verifyCompletenessManifest(
        id: string,
        manifest: RegulatoryCompletenessManifestInput,
        actorId?: string,
        auditContext: Omit<GovernanceAuditContext, 'actorId'> = {},
    ) {
        return db.transaction(async (tx: any) => {
            const [ruleSet] = await tx.select().from(regulatoryRuleSets)
                .where(eq(regulatoryRuleSets.id, id)).limit(1).for('update');
            if (!ruleSet) throw new NotFoundError('Versi aturan');
            if (ruleSet.status !== 'draft') {
                throw new ConflictError('Manifest hanya dapat diverifikasi ketika versi berstatus draft.');
            }
            const items = await this.getItems(tx, ruleSet);
            const report = validateRegulatoryRuleItems(
                ruleSet.instrumentType as RegulatoryInstrumentType,
                items,
            );
            const now = new Date();
            const manifestHash = regulatoryEvidenceHash(manifest);
            const candidate = {
                ...ruleSet,
                completenessManifest: manifest,
                completenessManifestSha256: manifestHash,
                completenessVerifiedAt: now,
                completenessVerifiedBy: actorId || null,
            } as RegulatoryRuleSet;
            applyGovernanceReadinessChecks(report, candidate, items, false);
            // An impact report is generated only after this step. The remaining
            // governance errors make the manifest unfit for attestation.
            if (!report.valid) throw new RegulatoryRuleSetValidationError(report);

            const [updated] = await tx.update(regulatoryRuleSets).set({
                completenessManifest: manifest,
                completenessManifestSha256: manifestHash,
                completenessVerifiedAt: now,
                completenessVerifiedBy: actorId || null,
                impactReport: null,
                impactReportSha256: null,
                impactReportGeneratedAt: null,
                impactReportGeneratedBy: null,
                updatedAt: now,
            }).where(and(
                eq(regulatoryRuleSets.id, id),
                eq(regulatoryRuleSets.status, 'draft'),
            )).returning();
            if (!updated) throw new ConflictError('Status draft berubah saat manifest diverifikasi.');

            await appendRegulatoryEvents(tx, [{
                ruleSetId: id,
                instrumentType: ruleSet.instrumentType as RegulatoryInstrumentType,
                entityType: 'manifest',
                action: 'verify',
                before: ruleSet.completenessManifest as Record<string, unknown> | null,
                after: manifest,
                reason: manifest.verificationStatement,
            }], governanceContext(actorId, auditContext));
            return { ruleSet: presentRuleSet(updated), validation: report };
        });
    }

    async generateImpactReport(
        id: string,
        actorId?: string,
        auditContext: Omit<GovernanceAuditContext, 'actorId'> = {},
    ) {
        return db.transaction(async (tx: any) => {
            const [candidate] = await tx.select().from(regulatoryRuleSets)
                .where(eq(regulatoryRuleSets.id, id)).limit(1).for('update');
            if (!candidate) throw new NotFoundError('Versi aturan');
            if (candidate.status !== 'draft') {
                throw new ConflictError('Laporan dampak hanya dapat dibuat ketika versi berstatus draft.');
            }
            const instrumentType = candidate.instrumentType as RegulatoryInstrumentType;
            const candidateItems = await this.getItems(tx, candidate);
            const validation = validateRegulatoryRuleItems(instrumentType, candidateItems);
            applyGovernanceReadinessChecks(validation, candidate, candidateItems, false);
            if (!validation.valid) throw new RegulatoryRuleSetValidationError(validation);

            let predecessor: RegulatoryRuleSet | null = null;
            let predecessorItems: RuleItem[] = [];
            if (candidate.supersedesId) {
                [predecessor] = await tx.select().from(regulatoryRuleSets)
                    .where(eq(regulatoryRuleSets.id, candidate.supersedesId)).limit(1).for('share');
                if (!predecessor) throw new NotFoundError('Versi aturan yang digantikan');
                predecessorItems = await this.getItems(tx, predecessor);
            }
            const diff = buildRegulatoryDiff(instrumentType, candidateItems, predecessorItems);
            const affectedIds = [...diff.changed, ...diff.removed]
                .map(({ itemId }) => itemId)
                .filter((value): value is number => Number.isInteger(value));
            let archiveImpact = {
                usingPredecessor: 0,
                affectedByChangedOrRemovedRules: 0,
                operationalAffected: 0,
                legalHoldAffected: 0,
                snapshotReferences: 0,
            };
            if (predecessor) {
                const ruleSetColumn = instrumentType === 'klasifikasi'
                    ? arsip.klasifikasiRuleSetId
                    : arsip.jraRuleSetId;
                const itemColumn = instrumentType === 'klasifikasi'
                    ? arsip.klasifikasiArsipId
                    : arsip.jraItemId;
                const affectedCondition = affectedIds.length > 0
                    ? inArray(itemColumn, affectedIds)
                    : sql`false`;
                const [counts] = await tx.select({
                    usingPredecessor: sql<number>`count(*)::int`,
                    affectedByChangedOrRemovedRules: sql<number>`count(*) filter (where ${affectedCondition})::int`,
                    operationalAffected: sql<number>`count(*) filter (where ${affectedCondition} and ${arsip.disposalStatus} = 'active')::int`,
                    legalHoldAffected: sql<number>`count(*) filter (where ${affectedCondition} and ${arsip.legalHold} = true)::int`,
                }).from(arsip).where(eq(ruleSetColumn, predecessor.id));
                const snapshotRuleSetColumn = instrumentType === 'klasifikasi'
                    ? arsipRuleSnapshots.klasifikasiRuleSetId
                    : arsipRuleSnapshots.jraRuleSetId;
                const [snapshotCounts] = await tx.select({
                    count: sql<number>`count(*)::int`,
                }).from(arsipRuleSnapshots).where(eq(snapshotRuleSetColumn, predecessor.id));
                archiveImpact = {
                    usingPredecessor: Number(counts?.usingPredecessor || 0),
                    affectedByChangedOrRemovedRules: Number(counts?.affectedByChangedOrRemovedRules || 0),
                    operationalAffected: Number(counts?.operationalAffected || 0),
                    legalHoldAffected: Number(counts?.legalHoldAffected || 0),
                    snapshotReferences: Number(snapshotCounts?.count || 0),
                };
            }
            const report: RuleSetImpactReport = {
                schemaVersion: 1,
                instrumentType,
                candidateRuleSetId: candidate.id,
                predecessorRuleSetId: predecessor?.id || null,
                candidateContentHash: validation.contentHash,
                predecessorContentHash: predecessor
                    ? deterministicRegulatoryContentHash(instrumentType, predecessorItems)
                    : null,
                diff,
                archiveImpact,
            };
            const hash = regulatoryEvidenceHash(report);
            const now = new Date();
            const [updated] = await tx.update(regulatoryRuleSets).set({
                impactReport: report,
                impactReportSha256: hash,
                impactReportGeneratedAt: now,
                impactReportGeneratedBy: actorId || null,
                updatedAt: now,
            }).where(and(
                eq(regulatoryRuleSets.id, id),
                eq(regulatoryRuleSets.status, 'draft'),
            )).returning();
            if (!updated) throw new ConflictError('Status draft berubah saat laporan dampak dibuat.');
            await appendRegulatoryEvents(tx, [{
                ruleSetId: id,
                instrumentType,
                entityType: 'impact',
                action: 'generate',
                before: candidate.impactReport as Record<string, unknown> | null,
                after: {
                    reportHash: hash,
                    added: diff.added.length,
                    removed: diff.removed.length,
                    changed: diff.changed.length,
                    unchanged: diff.unchangedCount,
                    ...archiveImpact,
                },
                reason: auditContext.reason || 'Diff dan analisis dampak dibuat dari data persisten.',
            }], governanceContext(actorId, auditContext));
            return { ruleSet: presentRuleSet(updated), report, reportHash: hash };
        });
    }

    async submit(
        id: string,
        actorId: string,
        note: string,
        auditContext: Omit<GovernanceAuditContext, 'actorId'> = {},
    ) {
        return db.transaction(async (tx: any) => {
            const [candidate] = await tx.select().from(regulatoryRuleSets)
                .where(eq(regulatoryRuleSets.id, id)).limit(1).for('update');
            if (!candidate) throw new NotFoundError('Versi aturan');
            if (candidate.status !== 'draft') throw new ConflictError('Hanya draft yang dapat diajukan.');
            const items = await this.getItems(tx, candidate);
            const report = validateRegulatoryRuleItems(
                candidate.instrumentType as RegulatoryInstrumentType,
                items,
            );
            applyDeclaredCompletenessChecks(report, candidate.metadata);
            applyGovernanceReadinessChecks(report, candidate, items);
            if (!report.valid) throw new RegulatoryRuleSetValidationError(report);
            await this.assertStoredSourceAvailable(candidate);
            // Seal every item while the parent is still a mutable draft. Once
            // submitted, the database trigger freezes the item collection and
            // activation may only verify (never repair) these digests.
            for (const item of items) {
                const itemHash = deterministicRegulatoryContentHash(
                    candidate.instrumentType as RegulatoryInstrumentType,
                    [item],
                );
                if (item.contentHash === itemHash) continue;
                if (candidate.instrumentType === 'klasifikasi') {
                    await tx.update(klasifikasiArsip).set({
                        contentHash: itemHash,
                        updatedAt: new Date(),
                    }).where(and(
                        eq(klasifikasiArsip.id, item.id),
                        eq(klasifikasiArsip.ruleSetId, candidate.id),
                    ));
                } else {
                    await tx.update(jadwalRetensiArsip).set({
                        contentHash: itemHash,
                        updatedAt: new Date(),
                    }).where(and(
                        eq(jadwalRetensiArsip.id, item.id),
                        eq(jadwalRetensiArsip.ruleSetId, candidate.id),
                    ));
                }
            }
            const now = new Date();
            const publicationMetadata = {
                ...asJsonObject(candidate.metadata),
                contentHash: report.contentHash,
                contentHashAlgorithm: 'sha256',
                contentSchemaVersion: 1,
                contentItemCount: report.stats.total,
                validatedAt: now.toISOString(),
            };
            const [submitted] = await tx.update(regulatoryRuleSets).set({
                status: 'submitted',
                metadata: publicationMetadata,
                submittedAt: now,
                submittedBy: actorId,
                submissionNote: note,
                reviewedAt: null,
                reviewedBy: null,
                reviewNote: null,
                approvedAt: null,
                approvedBy: null,
                approvalNote: null,
                updatedAt: now,
            }).where(and(eq(regulatoryRuleSets.id, id), eq(regulatoryRuleSets.status, 'draft'))).returning();
            if (!submitted) throw new ConflictError('Status draft berubah saat pengajuan.');
            await appendRegulatoryEvents(tx, [{
                ruleSetId: id,
                instrumentType: candidate.instrumentType as RegulatoryInstrumentType,
                entityType: 'rule_set',
                action: 'submit',
                before: { status: 'draft' },
                after: { status: 'submitted', contentHash: report.contentHash },
                reason: note,
            }], governanceContext(actorId, auditContext));
            return { ruleSet: presentRuleSet(submitted), validation: report };
        });
    }

    async review(
        id: string,
        actorId: string,
        note: string,
        auditContext: Omit<GovernanceAuditContext, 'actorId'> = {},
    ) {
        return db.transaction(async (tx: any) => {
            const [candidate] = await tx.select().from(regulatoryRuleSets)
                .where(eq(regulatoryRuleSets.id, id)).limit(1).for('update');
            if (!candidate) throw new NotFoundError('Versi aturan');
            if (candidate.status !== 'submitted') throw new ConflictError('Versi harus berstatus submitted untuk ditelaah.');
            if (
                actorId === candidate.submittedBy
                || actorId === candidate.createdBy
                || await this.isMaterialContributor(tx, id, actorId)
            ) {
                throw new ConflictError('Penyusun/pengaju tidak boleh menelaah versinya sendiri.');
            }
            const now = new Date();
            const [reviewed] = await tx.update(regulatoryRuleSets).set({
                status: 'reviewed', reviewedAt: now, reviewedBy: actorId, reviewNote: note, updatedAt: now,
            }).where(and(eq(regulatoryRuleSets.id, id), eq(regulatoryRuleSets.status, 'submitted'))).returning();
            if (!reviewed) throw new ConflictError('Status berubah saat penelaahan.');
            await appendRegulatoryEvents(tx, [{
                ruleSetId: id,
                instrumentType: candidate.instrumentType as RegulatoryInstrumentType,
                entityType: 'rule_set',
                action: 'review',
                before: { status: 'submitted' },
                after: { status: 'reviewed' },
                reason: note,
            }], governanceContext(actorId, auditContext));
            return presentRuleSet(reviewed);
        });
    }

    async approve(
        id: string,
        actorId: string,
        note: string,
        auditContext: Omit<GovernanceAuditContext, 'actorId'> = {},
    ) {
        return db.transaction(async (tx: any) => {
            const [candidate] = await tx.select().from(regulatoryRuleSets)
                .where(eq(regulatoryRuleSets.id, id)).limit(1).for('update');
            if (!candidate) throw new NotFoundError('Versi aturan');
            if (candidate.status !== 'reviewed') throw new ConflictError('Versi harus berstatus reviewed untuk disetujui.');
            if (
                [candidate.createdBy, candidate.submittedBy, candidate.reviewedBy].includes(actorId)
                || await this.isMaterialContributor(tx, id, actorId)
            ) {
                throw new ConflictError('Penyusun, pengaju, dan penelaah tidak boleh menyetujui versi yang sama.');
            }
            const now = new Date();
            const [approved] = await tx.update(regulatoryRuleSets).set({
                status: 'approved', approvedAt: now, approvedBy: actorId, approvalNote: note, updatedAt: now,
            }).where(and(eq(regulatoryRuleSets.id, id), eq(regulatoryRuleSets.status, 'reviewed'))).returning();
            if (!approved) throw new ConflictError('Status berubah saat persetujuan.');
            await appendRegulatoryEvents(tx, [{
                ruleSetId: id,
                instrumentType: candidate.instrumentType as RegulatoryInstrumentType,
                entityType: 'rule_set',
                action: 'approve',
                before: { status: 'reviewed', reviewedBy: candidate.reviewedBy },
                after: { status: 'approved' },
                reason: note,
            }], governanceContext(actorId, auditContext));
            return presentRuleSet(approved);
        });
    }

    async returnToDraft(
        id: string,
        actorId: string,
        note: string,
        auditContext: Omit<GovernanceAuditContext, 'actorId'> = {},
    ) {
        return db.transaction(async (tx: any) => {
            const [candidate] = await tx.select().from(regulatoryRuleSets)
                .where(eq(regulatoryRuleSets.id, id)).limit(1).for('update');
            if (!candidate) throw new NotFoundError('Versi aturan');
            if (!['submitted', 'reviewed', 'approved'].includes(candidate.status)) {
                throw new ConflictError('Hanya versi yang sedang ditelaah/disetujui yang dapat dikembalikan.');
            }
            const previousStatus = candidate.status;
            const now = new Date();
            const [draft] = await tx.update(regulatoryRuleSets).set({
                status: 'draft',
                submittedAt: null,
                submittedBy: null,
                submissionNote: null,
                reviewedAt: null,
                reviewedBy: null,
                reviewNote: null,
                approvedAt: null,
                approvedBy: null,
                approvalNote: null,
                updatedAt: now,
            }).where(and(eq(regulatoryRuleSets.id, id), eq(regulatoryRuleSets.status, previousStatus))).returning();
            if (!draft) throw new ConflictError('Status berubah saat pengembalian ke draft.');
            await appendRegulatoryEvents(tx, [{
                ruleSetId: id,
                instrumentType: candidate.instrumentType as RegulatoryInstrumentType,
                entityType: 'rule_set',
                action: 'return_to_draft',
                before: {
                    status: previousStatus,
                    submittedBy: candidate.submittedBy,
                    reviewedBy: candidate.reviewedBy,
                    approvedBy: candidate.approvedBy,
                },
                after: { status: 'draft' },
                reason: note,
            }], governanceContext(actorId, auditContext));
            return presentRuleSet(draft);
        });
    }

    async listEvents(id: string, page = 1, limit = 50) {
        await this.getById(id);
        const offset = (page - 1) * limit;
        const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
            .from(regulatoryRuleEvents).where(eq(regulatoryRuleEvents.ruleSetId, id));
        const data = await db.select().from(regulatoryRuleEvents)
            .where(eq(regulatoryRuleEvents.ruleSetId, id))
            .orderBy(desc(regulatoryRuleEvents.createdAt), desc(regulatoryRuleEvents.id))
            .limit(limit).offset(offset);
        return {
            data,
            pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
        };
    }

    async verifyEventIntegrity(id: string) {
        await this.getById(id);
        const events = await db.select().from(regulatoryRuleEvents)
            .where(eq(regulatoryRuleEvents.ruleSetId, id))
            .orderBy(asc(regulatoryRuleEvents.createdAt), asc(regulatoryRuleEvents.id));
        return verifyRegulatoryEventChain(events);
    }

    async activate(
        id: string,
        actorId?: string,
        auditContext: Omit<GovernanceAuditContext, 'actorId'> = {},
    ) {
        try {
            return await db.transaction(async (tx: any) => {
                const [candidate] = await tx
                    .select()
                    .from(regulatoryRuleSets)
                    .where(eq(regulatoryRuleSets.id, id))
                    .limit(1)
                    .for('update');
                if (!candidate) throw new NotFoundError('Versi aturan');
                const bootstrapBaseline = !actorId
                    && [KLASIFIKASI_RULE_SET_2018_ID, JRA_RULE_SET_2020_ID].includes(candidate.id)
                    && candidate.status === 'draft';
                if (candidate.status !== 'approved' && !bootstrapBaseline) {
                    if (['active', 'superseded', 'withdrawn'].includes(candidate.status)) {
                        throw new ConflictError('Versi yang sudah dipublikasikan bersifat immutable.');
                    }
                    throw new ConflictError('Versi harus melalui submitted, reviewed, dan approved sebelum aktivasi.');
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
                applyGovernanceReadinessChecks(report, candidate, items, !bootstrapBaseline);
                if (!report.valid) throw new RegulatoryRuleSetValidationError(report);
                if (!bootstrapBaseline) await this.assertStoredSourceAvailable(candidate);
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
                    if (!bootstrapBaseline) {
                        throw new ConflictError(
                            `Hash butir ${item.kode} berubah setelah persetujuan. Aktivasi dibatalkan.`,
                        );
                    }
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

                if (!bootstrapBaseline) {
                    const impact = asJsonObject(candidate.impactReport);
                    if ((impact.predecessorRuleSetId ?? null) !== (current?.id ?? null)) {
                        throw new ConflictError('Laporan dampak tidak lagi menunjuk versi aktif terkini. Buat ulang laporan.');
                    }
                    if (current) {
                        const currentItems = await this.getItems(tx, current);
                        const currentHash = deterministicRegulatoryContentHash(instrumentType, currentItems);
                        if (impact.predecessorContentHash !== currentHash) {
                            throw new ConflictError('Isi versi aktif berubah dari basis laporan dampak. Aktivasi dibatalkan.');
                        }
                    }
                }

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
                    await appendRegulatoryEvents(tx, [{
                        ruleSetId: current.id,
                        instrumentType,
                        entityType: 'rule_set',
                        action: 'supersede',
                        before: { status: 'active', effectiveTo: current.effectiveTo },
                        after: { status: 'superseded', effectiveTo: updatedCurrent.effectiveTo, supersededById: candidate.id },
                        reason: auditContext.reason || candidate.approvalNote || 'Digantikan oleh edisi yang telah disetujui.',
                    }], governanceContext(actorId, auditContext));
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
                    validatedAt: asJsonObject(candidate.metadata).validatedAt || now.toISOString(),
                };
                const [activated] = await tx
                    .update(regulatoryRuleSets)
                    .set({
                        status: 'active',
                        effectiveTo: null,
                        metadata,
                        publishedAt: now,
                        publishedBy: actorId || candidate.approvedBy || null,
                        updatedAt: now,
                    })
                    .where(and(
                        eq(regulatoryRuleSets.id, candidate.id),
                        eq(regulatoryRuleSets.status, bootstrapBaseline ? 'draft' : 'approved'),
                    ))
                    .returning();
                if (!activated) {
                    throw new ConflictError('Status persetujuan berubah selama proses aktivasi.');
                }

                await appendRegulatoryEvents(tx, [{
                    ruleSetId: candidate.id,
                    instrumentType,
                    entityType: 'rule_set',
                    action: bootstrapBaseline ? 'bootstrap_activate' : 'activate',
                    before: { status: candidate.status },
                    after: {
                        status: 'active',
                        contentHash: report.contentHash,
                        effectiveFrom: candidate.effectiveFrom,
                        publishedBy: actorId || candidate.approvedBy || null,
                    },
                    reason: auditContext.reason || candidate.approvalNote || 'Edisi disetujui diaktifkan.',
                }], governanceContext(actorId, auditContext));

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
