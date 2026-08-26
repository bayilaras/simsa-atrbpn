import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { db } from '../config/database';
import {
  KLASIFIKASI_RULE_SET_2018_ID,
  klasifikasiArsip,
  regulatoryRuleSets,
} from './schema';
import classificationSeedJson from './data/klasifikasi-atr-bpn-10-2018.json';
import {
  deterministicRegulatoryContentHash,
  regulatoryRuleSetService,
  validateRegulatoryRuleItems,
} from '../services/regulatory-rule-set.service';

type ClassificationSeedRecord = {
  sourceRecordKey: string;
  sourceCode: string;
  kode: string;
  organizationalScope: string;
  jenis: string;
  keterangan: string | null;
  kategori: string;
  parentKode: string | null;
  tipe: string;
  level: number;
  isActive: boolean;
  isSelectable: boolean;
  sourcePage: number;
};

type ClassificationSeedAsset = {
  schemaVersion: number;
  instrumentType: string;
  regulationVersion: string;
  source: { documentName: string; sha256: string; totalPdfPages: number };
  expectedCounts: {
    records: number;
    selectable: number;
    byScope: Record<string, number>;
  };
  records: ClassificationSeedRecord[];
  contentSha256: string;
};

const classificationSeed = classificationSeedJson as unknown as ClassificationSeedAsset;

function recordsSha256(records: ClassificationSeedRecord[]): string {
  return createHash('sha256').update(JSON.stringify(records), 'utf8').digest('hex');
}

function assertCompleteSeedAsset() {
  const scopeCounts = Object.fromEntries(
    Object.keys(classificationSeed.expectedCounts.byScope).map((scope) => [
      scope,
      classificationSeed.records.filter((record) => record.organizationalScope === scope).length,
    ]),
  );
  const selectableCount = classificationSeed.records.filter((record) => record.isSelectable).length;

  if (
    classificationSeed.instrumentType !== 'klasifikasi'
    || classificationSeed.regulationVersion !== 'ATR-BPN-10-2018'
    || classificationSeed.records.length !== classificationSeed.expectedCounts.records
    || selectableCount !== classificationSeed.expectedCounts.selectable
    || JSON.stringify(scopeCounts) !== JSON.stringify(classificationSeed.expectedCounts.byScope)
  ) {
    throw new Error('Asset klasifikasi 2018 tidak lengkap atau jumlah per lingkup tidak sesuai manifest.');
  }
  if (recordsSha256(classificationSeed.records) !== classificationSeed.contentSha256) {
    throw new Error('Integritas asset seed klasifikasi 2018 gagal diverifikasi.');
  }
}

export async function seedKlasifikasiArsip() {
  console.log('Seeding klasifikasi arsip lengkap Permen ATR/BPN 10/2018...');
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
      .where(eq(regulatoryRuleSets.id, KLASIFIKASI_RULE_SET_2018_ID))
      .limit(1)
      .for('update');

    if (!ruleSet) {
      throw new Error('Rule set klasifikasi 2018 belum tersedia. Jalankan migrasi database terlebih dahulu.');
    }
    if (String(ruleSet.sourceDocumentSha256 || '').toLowerCase() !== classificationSeed.source.sha256) {
      throw new Error('SHA-256 dokumen sumber rule set tidak cocok dengan asset klasifikasi 2018.');
    }
    if (ruleSet.status !== 'draft') {
      return { skipped: true as const, reason: `rule_set_${ruleSet.status}` };
    }

    const [otherActive] = await tx
      .select({ id: regulatoryRuleSets.id })
      .from(regulatoryRuleSets)
      .where(and(
        eq(regulatoryRuleSets.instrumentType, 'klasifikasi'),
        eq(regulatoryRuleSets.status, 'active'),
      ))
      .limit(1)
      .for('share');
    if (otherActive) return { skipped: true as const, reason: 'newer_version_active' };

    const items = classificationSeed.records.map((record) => {
      const normalized = {
        ...record,
        ruleSetId: KLASIFIKASI_RULE_SET_2018_ID,
      };
      return {
        ...normalized,
        contentHash: deterministicRegulatoryContentHash('klasifikasi', [normalized]),
      };
    });

    await tx
      .delete(klasifikasiArsip)
      .where(eq(klasifikasiArsip.ruleSetId, KLASIFIKASI_RULE_SET_2018_ID));
    const batchSize = 100;
    for (let offset = 0; offset < items.length; offset += batchSize) {
      await tx.insert(klasifikasiArsip).values(items.slice(offset, offset + batchSize));
      console.log(`  Inserted ${Math.min(offset + batchSize, items.length)}/${items.length} records`);
    }

    const currentMetadata = ruleSet.metadata && typeof ruleSet.metadata === 'object'
      && !Array.isArray(ruleSet.metadata) ? ruleSet.metadata : {};
    await tx.update(regulatoryRuleSets).set({
      metadata: {
        ...currentMetadata,
        seedAssetSchemaVersion: classificationSeed.schemaVersion,
        seedAssetContentSha256: classificationSeed.contentSha256,
        expectedItemCount: classificationSeed.expectedCounts.records,
        expectedSelectableCount: classificationSeed.expectedCounts.selectable,
        organizationalScopeCounts: classificationSeed.expectedCounts.byScope,
      },
      updatedAt: new Date(),
    }).where(and(
      eq(regulatoryRuleSets.id, KLASIFIKASI_RULE_SET_2018_ID),
      eq(regulatoryRuleSets.status, 'draft'),
    ));

    return { skipped: false as const, items };
  });

  if (prepared.skipped) {
    console.log(`  Katalog tidak diubah (${prepared.reason}); edisi terbit tetap immutable.`);
    return { status: 'skipped' as const, reason: prepared.reason };
  }

  const expectedValidation = validateRegulatoryRuleItems('klasifikasi', prepared.items);
  const validation = await regulatoryRuleSetService.validateDraft(KLASIFIKASI_RULE_SET_2018_ID);
  if (!expectedValidation.valid
    || !validation.valid
    || validation.contentHash !== expectedValidation.contentHash
    || validation.stats.total !== classificationSeed.expectedCounts.records
    || validation.stats.selectable !== classificationSeed.expectedCounts.selectable) {
    console.warn('  Draft tersimpan tetapi tidak diaktifkan karena validasi data persisten gagal.', validation.errors);
    return { status: 'draft' as const, validation };
  }

  await regulatoryRuleSetService.activate(KLASIFIKASI_RULE_SET_2018_ID);
  console.log(`Klasifikasi 2018 diaktifkan: ${validation.stats.total} butir, ${validation.stats.selectable} dapat dipilih.`);
  return { status: 'activated' as const, validation };
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  seedKlasifikasiArsip()
    .then(() => process.exit(0))
    .catch((error) => { console.error(error); process.exit(1); });
}
