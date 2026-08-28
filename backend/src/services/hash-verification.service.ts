import { and, eq } from 'drizzle-orm';
import crypto from 'node:crypto';
import { db } from '../config/database';
import { arsipElektronik } from '../db/schema/arsip-elektronik';

export class HashVerificationService {
    /**
     * Verify an uploaded file against the database records based on its hash.
     * Dictionary:
     * - "Authentic": Hash matches a record in DB.
     * - "Unknown": Hash does not match any record.
     */
    /** Verify an in-memory upload without creating a process-local web file. */
    static async verifyUploadedBuffer(buffer: Buffer) {
        const hash = crypto.createHash('sha256').update(buffer).digest('hex');
        return this.verifyHash(hash);
    }

    private static async verifyHash(hash: string) {
        const record = await db.query.arsipElektronik.findFirst({
            where: and(
                eq(arsipElektronik.hashSHA256, hash),
                eq(arsipElektronik.statusVerifikasi, 'verified'),
                eq(arsipElektronik.immutable, true),
            ),
            with: {
                arsip: true,
                autentikasi: true,
                fileAttachment: true,
            },
        });

        const attachment = record?.fileAttachment;
        const isEligible = Boolean(
            record
            && record.statusVerifikasi === 'verified'
            && record.immutable
            && attachment?.fileUrl
            && attachment.sha256 === hash
            && attachment.storageAccess === 'private'
            && attachment.integrityStatus === 'verified'
            && attachment.malwareScanStatus === 'clean',
        );

        if (record && isEligible) {
            return {
                status: 'AUTHENTIC',
                message: 'Arsip ditemukan dan integritas terjamin.',
                data: {
                    arsipId: record.arsipId,
                    nomorBerkas: record.arsip.nomorBerkas,
                    uraian: record.arsip.uraianBerkas,
                    tanggalUpload: record.createdAt,
                    autentikasi: record.autentikasi ? {
                        nomor: record.autentikasi.nomorBeritaAcara,
                        tanggal: record.autentikasi.tanggalAutentikasi,
                    } : null,
                },
            };
        }

        if (record) {
            return {
                status: 'NOT_VERIFIED',
                message: 'Arsip belum memenuhi seluruh pemeriksaan integritas dan keamanan.',
            };
        }

        return {
            status: 'UNKNOWN',
            message: 'Arsip tidak ditemukan dalam database atau telah dimodifikasi.',
            hash,
        };
    }
}
