import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { db } from '../config/database.js';
import {
  JRA_RULE_SET_2020_ID,
  jadwalRetensiArsip,
  regulatoryRuleSets,
} from './schema/index.js';
import jraSeedJson from './data/jra-atr-bpn-8-2020.json';
import {
  deterministicRegulatoryContentHash,
  regulatoryRuleSetService,
  validateRegulatoryRuleItems,
} from '../services/regulatory-rule-set.service.js';
import { REGULATORY_SEED_LOCK, withRegulatorySeedLock } from './regulatory-seed-lock.js';

type JraSeedRecord = {
  kode: string;
  uraian: string;
  retensiAktif: string | null;
  retensiInaktif: string | null;
  keterangan: string | null;
  kategori: string;
  parentKode: string | null;
  tipe: string;
  level: number;
  isActive: boolean;
  isSelectable: boolean;
  activeMonths: number | null;
  inactiveMonths: number | null;
  calculationMode: string;
  dispositionCode: string;
  triggerGuidance: string | null;
  sourcePage: number;
};

type JraSeedAsset = {
  schemaVersion: number;
  instrumentType: string;
  regulationVersion: string;
  identifierSemantics: string;
  source: { documentName: string; sha256: string; totalPdfPages: number };
  expectedCounts: {
    rules: number;
    hierarchyNodes: number;
    records: number;
    selectable: number;
    byDisposition: Record<string, number>;
    byCalculationMode: Record<string, number>;
  };
  records: JraSeedRecord[];
  contentSha256: string;
};

const jraSeed = jraSeedJson as unknown as JraSeedAsset;

function recordsSha256(records: JraSeedRecord[]): string {
  return createHash('sha256').update(JSON.stringify(records), 'utf8').digest('hex');
}

function groupedLeafCount(field: 'dispositionCode' | 'calculationMode') {
  const leaves = jraSeed.records.filter((record) => record.isSelectable);
  return Object.fromEntries(
    Object.keys(field === 'dispositionCode'
      ? jraSeed.expectedCounts.byDisposition
      : jraSeed.expectedCounts.byCalculationMode)
      .map((value) => [value, leaves.filter((record) => record[field] === value).length]),
  );
}

function assertCompleteSeedAsset() {
  const selectableCount = jraSeed.records.filter((record) => record.isSelectable).length;
  const hierarchyCount = jraSeed.records.length - selectableCount;
  if (
    jraSeed.instrumentType !== 'jra'
    || jraSeed.regulationVersion !== 'ATR-BPN-8-2020'
    || jraSeed.records.length !== jraSeed.expectedCounts.records
    || selectableCount !== jraSeed.expectedCounts.rules
    || selectableCount !== jraSeed.expectedCounts.selectable
    || hierarchyCount !== jraSeed.expectedCounts.hierarchyNodes
    || JSON.stringify(groupedLeafCount('dispositionCode')) !== JSON.stringify(jraSeed.expectedCounts.byDisposition)
    || JSON.stringify(groupedLeafCount('calculationMode')) !== JSON.stringify(jraSeed.expectedCounts.byCalculationMode)
  ) {
    throw new Error('Asset JRA 2020 tidak lengkap atau jumlah aturan/hasil akhir tidak sesuai manifest.');
  }
  if (recordsSha256(jraSeed.records) !== jraSeed.contentSha256) {
    throw new Error('Integritas asset seed JRA 2020 gagal diverifikasi.');
  }
}

async function seedJadwalRetensiArsipUnlocked() {
  console.log('Seeding JRA lengkap Permen ATR/BPN 8/2020...');
  assertCompleteSeedAsset();

  const prepared = await db.transaction(async (tx: any) => {
    const [ruleSet] = await tx
      .select({
        id: regulatoryRuleSets.id,
        status: regulatoryRuleSets.status,
        sourceDocumentSha256: regulatoryRuleSets.sourceDocumentSha256,
        metadata: regulatoryRuleSets.metadata,
      })
      .from(regulatoryRuleSets)
      .where(eq(regulatoryRuleSets.id, JRA_RULE_SET_2020_ID))
      .limit(1)
      .for('update');

    if (!ruleSet) {
      throw new Error('Rule set JRA 2020 belum tersedia. Jalankan migrasi database terlebih dahulu.');
    }
    if (String(ruleSet.sourceDocumentSha256 || '').toLowerCase() !== jraSeed.source.sha256) {
      throw new Error('SHA-256 dokumen sumber rule set tidak cocok dengan asset JRA 2020.');
    }
    if (ruleSet.status !== 'draft') {
      return { skipped: true as const, reason: `rule_set_${ruleSet.status}` };
    }

    const [otherActive] = await tx
      .select({ id: regulatoryRuleSets.id })
      .from(regulatoryRuleSets)
      .where(and(
        eq(regulatoryRuleSets.instrumentType, 'jra'),
        eq(regulatoryRuleSets.status, 'active'),
      ))
      .limit(1)
      .for('share');
    if (otherActive) return { skipped: true as const, reason: 'newer_version_active' };

    const items = jraSeed.records.map((record) => {
      const normalized = {
        ...record,
        ruleSetId: JRA_RULE_SET_2020_ID,
      };
      return {
        ...normalized,
        contentHash: deterministicRegulatoryContentHash('jra', [normalized]),
      };
    });

    await tx
      .delete(jadwalRetensiArsip)
      .where(eq(jadwalRetensiArsip.ruleSetId, JRA_RULE_SET_2020_ID));
    const batchSize = 100;
    for (let offset = 0; offset < items.length; offset += batchSize) {
      await tx.insert(jadwalRetensiArsip).values(items.slice(offset, offset + batchSize));
      console.log(`  Inserted ${Math.min(offset + batchSize, items.length)}/${items.length} records`);
    }

    const currentMetadata = ruleSet.metadata && typeof ruleSet.metadata === 'object'
      && !Array.isArray(ruleSet.metadata) ? ruleSet.metadata : {};
    await tx.update(regulatoryRuleSets).set({
      metadata: {
        ...currentMetadata,
        seedAssetSchemaVersion: jraSeed.schemaVersion,
        seedAssetContentSha256: jraSeed.contentSha256,
        expectedItemCount: jraSeed.expectedCounts.records,
        expectedSelectableCount: jraSeed.expectedCounts.selectable,
        legalRetentionRuleCount: jraSeed.expectedCounts.rules,
        expectedHierarchyNodeCount: jraSeed.expectedCounts.hierarchyNodes,
        identifierSemantics: jraSeed.identifierSemantics,
        dispositionCounts: jraSeed.expectedCounts.byDisposition,
        calculationModeCounts: jraSeed.expectedCounts.byCalculationMode,
      },
      updatedAt: new Date(),
    }).where(and(
      eq(regulatoryRuleSets.id, JRA_RULE_SET_2020_ID),
      eq(regulatoryRuleSets.status, 'draft'),
    ));

    return { skipped: false as const, items };
  });

  if (prepared.skipped) {
    console.log(`  Jadwal tidak diubah (${prepared.reason}); edisi terbit tetap immutable.`);
    return { status: 'skipped' as const, reason: prepared.reason };
  }

  const expectedValidation = validateRegulatoryRuleItems('jra', prepared.items);
  // Persist a baseline impact report before invoking the shared validator.
  // Bootstrap activation remains actor-less, while the report proves that the
  // validated database contents match the initial all-added edition.
  await regulatoryRuleSetService.generateImpactReport(JRA_RULE_SET_2020_ID);
  const validation = await regulatoryRuleSetService.validateDraft(JRA_RULE_SET_2020_ID);
  if (!expectedValidation.valid
    || !validation.valid
    || validation.contentHash !== expectedValidation.contentHash
    || validation.stats.total !== jraSeed.expectedCounts.records
    || validation.stats.selectable !== jraSeed.expectedCounts.selectable) {
    console.warn('  Draft tersimpan tetapi tidak diaktifkan karena validasi data persisten gagal.', validation.errors);
    return { status: 'draft' as const, validation };
  }

  await regulatoryRuleSetService.activate(JRA_RULE_SET_2020_ID);
  console.log(`JRA 2020 diaktifkan: ${jraSeed.expectedCounts.rules} aturan retensi legal dan ${jraSeed.expectedCounts.hierarchyNodes} simpul navigasi.`);
  return { status: 'activated' as const, validation };
}

export async function seedJadwalRetensiArsip() {
  return withRegulatorySeedLock(
    REGULATORY_SEED_LOCK.jra,
    seedJadwalRetensiArsipUnlocked,
  );
}

const isMain = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  seedJadwalRetensiArsip()
    .then(() => process.exit(0))
    .catch((error) => { console.error(error); process.exit(1); });
}
