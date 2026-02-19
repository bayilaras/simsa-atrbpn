import { db } from '../config/database';
import { digitalSignatures, suratKeluar, approvalRequests, approvalHistory } from '../db/schema';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';

export class SignatureService {
    // Simulate signing process
    async sign(suratId: string, signerId: string, passphrase: string) {
        // In real world: Validate passphrase against BSrE/PSrE API
        if (!passphrase) throw new Error('Passphrase required');

        return await db.transaction(async (tx) => {
            // 1. Get Surat
            const [surat] = await tx.select().from(suratKeluar).where(eq(suratKeluar.id, suratId)).limit(1);
            if (!surat) throw new Error('Surat not found');
            if (surat.isSigned) throw new Error('Surat already signed');

            // 2. Generate Mock Signature Data
            const signatureId = crypto.randomUUID();
            const timestamp = new Date();
            const documentHash = crypto.createHash('sha256').update(suratId + timestamp.toISOString()).digest('hex');

            // Mock visual QR content (e.g. verify URL)
            const verifyUrl = process.env.APP_URL ? `${process.env.APP_URL}/verify/${signatureId}` : `http://localhost:5173/verify/${signatureId}`;

            // 3. Create Signature Record
            const [signature] = await tx.insert(digitalSignatures).values({
                id: signatureId,
                entityType: 'surat_keluar',
                entityId: suratId,
                signerId: signerId,
                certificateId: 'MOCK-CERT-' + Date.now(), // Mock Cert ID
                signedAt: timestamp,
                qrCodeContent: verifyUrl,
                documentHash: documentHash,
                signatureValue: 'MOCK-SIG-' + crypto.randomBytes(16).toString('hex'),
                isValid: true,
                visualPage: 1, // Default to first page
                visualX: 100,
                visualY: 100,
            }).returning();

            // 4. Update Surat Status
            await tx.update(suratKeluar).set({
                isSigned: true,
                signedAt: timestamp,
                approvalStatus: 'signed', // Final status
                updatedAt: timestamp,
            }).where(eq(suratKeluar.id, suratId));

            // 5. Update Approval Request if exists (mark as completed/signed)
            const [request] = await tx.select().from(approvalRequests).where(eq(approvalRequests.entityId, suratId)).limit(1);
            if (request) {
                await tx.update(approvalRequests).set({ status: 'signed', updatedAt: timestamp }).where(eq(approvalRequests.id, request.id));

                // Log to history
                await tx.insert(approvalHistory).values({
                    requestId: request.id,
                    userId: signerId,
                    action: 'SIGN',
                    notes: 'Dokumen ditandatangani secara elektronik',
                });
            }

            return signature;
        });
    }

    async verify(signatureId: string) {
        const [signature] = await db.select().from(digitalSignatures).where(eq(digitalSignatures.id, signatureId)).limit(1);
        return signature;
    }
}

export const signatureService = new SignatureService();
