import { and, desc, eq } from 'drizzle-orm';
import { db } from '../config/database.js';
import {
    approvalRequests,
    approvalSteps,
    digitalSignatures,
    suratKeluar,
} from '../db/schema/index.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/errors.js';
import {
    scopedRecordByIdWhere,
    type RecordUnitScope,
} from '../utils/record-unit-scope.js';
import {
    assertApproverMandate,
    type ApprovalActor,
} from './approval.service.js';

const SIGNING_NOT_OPERATIONAL =
    'Penandatanganan elektronik belum operasional. Integrasi PSrE/BSrE tersertifikasi harus dikonfigurasi sebelum dokumen dapat ditandatangani.';

export class SignatureService {
    async sign(
        suratId: string,
        actor: ApprovalActor,
        unitScope: RecordUnitScope,
        passphrase: string,
    ): Promise<never> {
        if (!passphrase) throw new ValidationError('Passphrase wajib diisi.');

        // Validate mandate and workflow state under row locks. No signature or
        // surat state is written until a real PSrE/BSrE adapter exists.
        await db.transaction(async (tx) => {
            const [surat] = await tx
                .select()
                .from(suratKeluar)
                .where(and(
                    scopedRecordByIdWhere(suratKeluar.id, suratId, suratKeluar.unitKerjaId, unitScope),
                    eq(suratKeluar.isArchived, false),
                    eq(suratKeluar.isDeleted, false),
                ))
                .limit(1)
                .for('update');

            if (!surat) throw new NotFoundError('Surat keluar');
            assertApproverMandate(actor, surat.unitKerjaId);
            if (surat.isSigned || surat.approvalStatus === 'signed') {
                throw new ConflictError('Surat sudah ditandatangani.');
            }
            if (surat.approvalStatus !== 'approved') {
                throw new ConflictError('Surat harus disetujui sebelum ditandatangani.');
            }

            const [request] = await tx
                .select()
                .from(approvalRequests)
                .where(and(
                    eq(approvalRequests.entityType, 'surat_keluar'),
                    eq(approvalRequests.entityId, suratId),
                    eq(approvalRequests.status, 'approved'),
                ))
                .orderBy(desc(approvalRequests.updatedAt))
                .limit(1)
                .for('update');

            if (!request) throw new ConflictError('Alur persetujuan final tidak ditemukan.');
            if (!request.requesterId || request.requesterId === actor.id) {
                throw new ForbiddenError('Pembuat/pengaju surat tidak boleh menandatangani suratnya sendiri.');
            }

            const [finalStep] = await tx
                .select()
                .from(approvalSteps)
                .where(and(
                    eq(approvalSteps.requestId, request.id),
                    eq(approvalSteps.stepOrder, request.currentStepOrder),
                    eq(approvalSteps.status, 'approved'),
                ))
                .limit(1)
                .for('update');

            if (!finalStep || finalStep.approverId !== actor.id) {
                throw new ForbiddenError('Hanya penyetuju terakhir yang berwenang menandatangani surat.');
            }
        });

        // A simulated hash/QR is not an electronic signature and must never be
        // persisted or reported as valid, including in non-production builds.
        throw new AppError(SIGNING_NOT_OPERATIONAL, 501);
    }

    async verify(signatureId: string) {
        const [signature] = await db
            .select()
            .from(digitalSignatures)
            .where(eq(digitalSignatures.id, signatureId))
            .limit(1);

        if (!signature) return null;

        const isLegacySimulation =
            signature.certificateId?.startsWith('MOCK-CERT-') === true
            || signature.signatureValue?.startsWith('MOCK-SIG-') === true;

        return {
            id: signature.id,
            entityType: signature.entityType,
            entityId: signature.entityId,
            signerId: signature.signerId,
            signedAt: signature.signedAt,
            isValid: false,
            verificationStatus: isLegacySimulation ? 'simulation_not_valid' : 'not_verified_by_psre',
            message: isLegacySimulation
                ? 'Artefak tanda tangan simulasi tidak sah dan tidak dapat dipakai sebagai bukti autentikasi.'
                : 'Keabsahan tanda tangan belum dapat dinyatakan tanpa verifikasi PSrE/BSrE.',
        };
    }
}

export const signatureService = new SignatureService();
