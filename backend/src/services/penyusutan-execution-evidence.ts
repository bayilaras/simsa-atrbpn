import { createHash } from 'node:crypto';
import { destructionExecutionEvidenceSchema } from '../validators/penyusutan-evidence.schemas';
import { ValidationError } from '../utils/errors';
import { isFileReleased } from './file-release-policy';
import { isAllowedForRecordUnit } from './record-access.service';

export function parseDestructionEvidence(input: unknown) {
    const parsed = destructionExecutionEvidenceSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError('Bukti pelaksanaan pemusnahan belum lengkap atau tidak valid.');
    return parsed.data;
}

export function destructionDocumentIds(input: ReturnType<typeof parseDestructionEvidence>) {
    return [...new Set([input.beritaAcaraAttachmentId, input.decisionAttachmentId,
        input.executionProofAttachmentId, ...input.witnesses.map(w => w.authorityAttachmentId)])];
}

/** Validates stored evidence, not the legal validity/content of a signed paper. */
export function buildDestructionEvidenceSnapshot(options: {
    input: ReturnType<typeof parseDestructionEvidence>;
    batch: { id: string; unitKerjaId: string; tanggalPersetujuan?: string | null };
    archiveIds: string[];
    executorId: string;
    attachments: Array<any>;
    witnesses: Array<any>;
    now?: Date;
}) {
    const { input, batch, archiveIds, executorId, attachments, witnesses } = options;
    const now = options.now || new Date();
    const performedAt = new Date(input.performedAt);
    if (!batch.tanggalPersetujuan
        || performedAt > now
        || performedAt < new Date(`${batch.tanggalPersetujuan}T00:00:00+07:00`)) {
        throw new ValidationError('Waktu pelaksanaan harus sesudah persetujuan dan tidak boleh di masa depan.');
    }
    const documents = new Map(attachments.map(attachment => [attachment.id, attachment]));
    const snapshotDocument = (id: string) => {
        const attachment = documents.get(id);
        if (!attachment || attachment.entityType !== 'arsip' || !archiveIds.includes(attachment.entityId)
            || !isFileReleased(attachment) || !attachment.lastFixityCheckAt
            || !(attachment.fileUrl || attachment.driveFileId)) {
            throw new ValidationError('Bukti harus berupa lampiran arsip dalam batch, privat, bersih malware, dan terverifikasi integritasnya.');
        }
        return { attachmentId: id, arsipId: attachment.entityId, fileName: attachment.fileName,
            sizeBytes: attachment.sizeBytes ?? null, mimeType: attachment.mimeType || null,
            sha256: attachment.sha256, objectGeneration: attachment.objectGeneration || null,
            lastFixityCheckAt: new Date(attachment.lastFixityCheckAt).toISOString() };
    };
    const witnessRecords = input.witnesses.map(witness => {
        const record = witnesses.find(item => item.id === witness.userId);
        if (!record?.isActive || !record.name?.trim() || record.id === executorId
            || !isAllowedForRecordUnit(record, batch.unitKerjaId)) {
            throw new ValidationError('Saksi harus aktif, berwenang pada unit, dan berbeda dari pencatat pelaksanaan.');
        }
        return { userId: record.id, name: record.name, nip: record.nip || null,
            jabatan: record.jabatan || null, role: record.role,
            authorityDocument: snapshotDocument(witness.authorityAttachmentId) };
    });
    const snapshot = {
        schemaVersion: 1,
        batchId: batch.id,
        archiveIds: [...archiveIds].sort(),
        performedAt: performedAt.toISOString(),
        recordedAt: now.toISOString(),
        recordedBy: executorId,
        method: input.method,
        copiesStatement: input.copiesStatement,
        documents: { beritaAcara: snapshotDocument(input.beritaAcaraAttachmentId),
            decision: snapshotDocument(input.decisionAttachmentId),
            executionProof: snapshotDocument(input.executionProofAttachmentId) },
        witnesses: witnessRecords,
        verificationScope: 'controlled_evidence_and_internal_actor_checks',
    };
    return { snapshot, sha256: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex') };
}
