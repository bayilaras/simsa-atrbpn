import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_CLASSIFICATION_SHA256 = '9964954acae6bf9dfb2c1aaf55dea473a21b3aff6f78d6a47c2698c4c4550f6f';
const EXPECTED_JRA_SHA256 = '322f741d7585b1a703171f3ba1587e879610597d0d93d0d997111c0e6ba03b30';
const EXPECTED_CLASSIFICATION_COUNT = 842;
const EXPECTED_JRA_RULE_COUNT = 391;

function argument(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

function sha256(value) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizedScope(scope) {
    const scopes = {
        KEMENTERIAN: 'kementerian',
        KANTOR_WILAYAH: 'kanwil',
        KANTOR_PERTANAHAN: 'kantah',
    };
    const result = scopes[scope];
    if (!result) throw new Error(`Unknown classification scope: ${scope}`);
    return result;
}

function buildClassificationAsset(source) {
    if (!Array.isArray(source.records) || source.records.length !== EXPECTED_CLASSIFICATION_COUNT) {
        throw new Error(`Expected ${EXPECTED_CLASSIFICATION_COUNT} classification rows, received ${source.records?.length}.`);
    }
    if (String(source.source?.sha256 || '').toLowerCase() !== EXPECTED_CLASSIFICATION_SHA256) {
        throw new Error('Classification source SHA-256 does not match bn687-2018.pdf.');
    }

    const byId = new Map(source.records.map((record) => [record.id, record]));
    const childCount = new Map();
    for (const record of source.records) {
        if (record.parent_id) childCount.set(record.parent_id, (childCount.get(record.parent_id) || 0) + 1);
    }

    const rootTitle = (record) => {
        let current = record;
        const visited = new Set();
        while (current.parent_id) {
            if (visited.has(current.id)) throw new Error(`Classification hierarchy cycle at ${current.id}.`);
            visited.add(current.id);
            current = byId.get(current.parent_id);
            if (!current) throw new Error(`Missing classification parent ${record.parent_id}.`);
        }
        return current.title;
    };

    const records = source.records.map((record) => {
        const parent = record.parent_id ? byId.get(record.parent_id) : null;
        if (record.parent_id && !parent) throw new Error(`Missing classification parent ${record.parent_id}.`);
        return {
            sourceRecordKey: record.id,
            sourceCode: record.source_code,
            kode: record.full_code,
            organizationalScope: normalizedScope(record.scope),
            jenis: record.title,
            keterangan: record.description || null,
            kategori: rootTitle(record),
            parentKode: parent?.full_code || null,
            tipe: record.classification_type.toLowerCase(),
            level: record.level - 1,
            isActive: true,
            isSelectable: !childCount.has(record.id),
            sourcePage: record.source_page_start,
        };
    });

    const scopeCounts = Object.fromEntries(
        [...new Set(records.map((record) => record.organizationalScope))]
            .sort()
            .map((scope) => [scope, records.filter((record) => record.organizationalScope === scope).length]),
    );
    const selectableCount = records.filter((record) => record.isSelectable).length;
    if (selectableCount !== 620) throw new Error(`Expected 620 selectable classification leaves, received ${selectableCount}.`);

    return {
        schemaVersion: 1,
        instrumentType: 'klasifikasi',
        regulationVersion: 'ATR-BPN-10-2018',
        source: {
            documentName: 'bn687-2018.pdf',
            sha256: EXPECTED_CLASSIFICATION_SHA256,
            totalPdfPages: source.source.total_pdf_pages,
            regulationPages: source.source.regulation_pages,
            appendixPages: source.source.appendix_pages,
            extractionMethod: source.source.extraction_method,
        },
        expectedCounts: {
            records: EXPECTED_CLASSIFICATION_COUNT,
            selectable: 620,
            byScope: scopeCounts,
        },
        records,
        contentSha256: sha256(records),
    };
}

function cleanText(value) {
    return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : null;
}

function technicalPrefix(rule) {
    const schedulePrefix = rule.schedule === 'fasilitatif' ? 'F' : 'S';
    return [schedulePrefix, rule.function.code, rule.subfunction?.code].filter(Boolean).join('.');
}

function buildJraAsset(source) {
    if (!Array.isArray(source.rules) || source.rules.length !== EXPECTED_JRA_RULE_COUNT) {
        throw new Error(`Expected ${EXPECTED_JRA_RULE_COUNT} JRA rules, received ${source.rules?.length}.`);
    }
    const functions = new Map();
    const subfunctions = new Map();
    const leaves = [];

    for (const rule of source.rules) {
        const prefix = technicalPrefix(rule);
        const functionCode = prefix.split('.').slice(0, 2).join('.');
        if (!functions.has(functionCode)) {
            functions.set(functionCode, {
                kode: functionCode,
                uraian: rule.function.title,
                retensiAktif: null,
                retensiInaktif: null,
                keterangan: null,
                kategori: rule.function.title,
                parentKode: null,
                tipe: rule.schedule,
                level: 0,
                isActive: true,
                isSelectable: false,
                activeMonths: null,
                inactiveMonths: null,
                calculationMode: 'manual',
                dispositionCode: 'manual_review',
                triggerGuidance: null,
                sourcePage: rule.function.page,
            });
        }

        if (rule.subfunction && !subfunctions.has(prefix)) {
            subfunctions.set(prefix, {
                kode: prefix,
                uraian: rule.subfunction.title,
                retensiAktif: null,
                retensiInaktif: null,
                keterangan: null,
                kategori: rule.function.title,
                parentKode: functionCode,
                tipe: rule.schedule,
                level: 1,
                isActive: true,
                isSelectable: false,
                activeMonths: null,
                inactiveMonths: null,
                calculationMode: 'manual',
                dispositionCode: 'manual_review',
                triggerGuidance: null,
                sourcePage: rule.subfunction.page,
            });
        }

        const stableOrdinal = rule.id.match(/(\d{4})$/)?.[1];
        if (!stableOrdinal) throw new Error(`JRA rule has no stable ordinal: ${rule.id}`);
        const rawDisposition = cleanText(rule.disposition.raw);
        const plainDisposition = rawDisposition?.toLowerCase();
        const dispositionCode = plainDisposition === 'musnah'
            ? 'musnah'
            : plainDisposition === 'permanen'
                ? 'permanen'
                : 'manual_review';
        const activeMonths = rule.active.mode === 'duration' && Number.isFinite(rule.active.years)
            ? rule.active.years * 12
            : null;
        const inactiveMonths = rule.inactive.mode === 'duration' && Number.isFinite(rule.inactive.years)
            ? rule.inactive.years * 12
            : null;
        const calculationMode = activeMonths !== null && inactiveMonths !== null
            ? 'duration'
            : 'manual';
        const triggerParts = [
            rule.active.trigger ? `Pemicu aktif: ${cleanText(rule.active.trigger)}` : null,
            rule.inactive.trigger ? `Pemicu inaktif: ${cleanText(rule.inactive.trigger)}` : null,
            `Rujukan sumber: halaman ${rule.pdf_page_start}${rule.pdf_page_end !== rule.pdf_page_start ? `-${rule.pdf_page_end}` : ''}, baris tabel ${rule.table_row}`,
            dispositionCode === 'manual_review' ? `Penilaian manual: ${rawDisposition}` : null,
        ].filter(Boolean);

        leaves.push({
            kode: `${prefix}.${stableOrdinal}`,
            uraian: rule.description_full.trim(),
            retensiAktif: cleanText(rule.active.raw),
            retensiInaktif: cleanText(rule.inactive.raw),
            keterangan: rawDisposition,
            kategori: rule.function.title,
            parentKode: rule.subfunction ? prefix : functionCode,
            tipe: rule.schedule,
            level: rule.subfunction ? 2 : 1,
            isActive: true,
            isSelectable: true,
            activeMonths,
            inactiveMonths,
            calculationMode,
            dispositionCode,
            triggerGuidance: triggerParts.join('; '),
            sourcePage: rule.pdf_page_start,
        });
    }

    const records = [...functions.values(), ...subfunctions.values(), ...leaves];
    const codes = new Set(records.map((record) => record.kode));
    if (codes.size !== records.length) throw new Error('Generated JRA technical identifiers are not unique.');
    if (leaves.length !== EXPECTED_JRA_RULE_COUNT) throw new Error('Generated JRA leaf count mismatch.');
    const byDisposition = Object.fromEntries(
        ['musnah', 'permanen', 'manual_review'].map((code) => [
            code,
            leaves.filter((record) => record.dispositionCode === code).length,
        ]),
    );
    const byCalculationMode = Object.fromEntries(
        ['duration', 'manual'].map((mode) => [
            mode,
            leaves.filter((record) => record.calculationMode === mode).length,
        ]),
    );

    return {
        schemaVersion: 1,
        instrumentType: 'jra',
        regulationVersion: 'ATR-BPN-8-2020',
        identifierSemantics: 'kode adalah identifier teknis aplikasi, bukan kode klasifikasi yang diterbitkan dalam lampiran JRA',
        source: {
            documentName: 'Permen ATR BPN Nomor 8 Tahun 2020 Tentang JRA.pdf',
            sha256: EXPECTED_JRA_SHA256,
            totalPdfPages: 75,
            articlesPages: source.regulation.articles_pages,
            fasilitatifTablePages: source.regulation.fasilitatif_table_pages,
            substantifTablePages: source.regulation.substantif_table_pages,
        },
        expectedCounts: {
            rules: EXPECTED_JRA_RULE_COUNT,
            hierarchyNodes: functions.size + subfunctions.size,
            records: records.length,
            selectable: leaves.length,
            byDisposition,
            byCalculationMode,
        },
        records,
        contentSha256: sha256(records),
    };
}

const classificationPath = argument('--classification');
const jraPath = argument('--jra');
if (!classificationPath || !jraPath) {
    throw new Error('Usage: node scripts/build-regulatory-seed-data.mjs --classification <json> --jra <json>');
}

const [classificationSource, jraSource] = await Promise.all([
    readFile(resolve(classificationPath), 'utf8').then(JSON.parse),
    readFile(resolve(jraPath), 'utf8').then(JSON.parse),
]);
const classificationAsset = buildClassificationAsset(classificationSource);
const jraAsset = buildJraAsset(jraSource);

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(scriptDir, '../src/db/data');
await mkdir(outputDir, { recursive: true });
await Promise.all([
    writeFile(resolve(outputDir, 'klasifikasi-atr-bpn-10-2018.json'), `${JSON.stringify(classificationAsset, null, 2)}\n`),
    writeFile(resolve(outputDir, 'jra-atr-bpn-8-2020.json'), `${JSON.stringify(jraAsset, null, 2)}\n`),
]);

console.log(JSON.stringify({
    classification: classificationAsset.expectedCounts,
    jra: jraAsset.expectedCounts,
}, null, 2));
