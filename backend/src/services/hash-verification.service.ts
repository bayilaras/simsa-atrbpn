import { eq } from 'drizzle-orm';
import { db } from '../config/database';
import { arsipElektronik } from '../db/schema/arsip-elektronik';
import { calculateFileHash } from '../utils/hash.utils';
import { unlink } from 'fs/promises';
import { createLogger } from '../utils/logger';

const log = createLogger('HashVerificationService');

export class HashVerificationService {
    /**
     * Verify an uploaded file against the database records based on its hash.
     * Dictionary:
     * - "Authentic": Hash matches a record in DB.
     * - "Unknown": Hash does not match any record.
     */
    static async verifyUploadedFile(filePath: string) {
        try {
            const hash = await calculateFileHash(filePath);

            // Clean up the temp file after hashing
            await unlink(filePath).catch(err => log.error({ err }, 'Failed to clean up temp file'));

            // Find record with this hash
            const record = await db.query.arsipElektronik.findFirst({
                where: eq(arsipElektronik.hashSHA256, hash),
                with: {
                    arsip: true,
                    autentikasi: true
                }
            });

            if (record) {
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
                            tanggal: record.autentikasi.tanggalAutentikasi
                        } : null
                    }
                };
            } else {
                return {
                    status: 'UNKNOWN',
                    message: 'Arsip tidak ditemukan dalam database atau telah dimodifikasi.',
                    hash: hash
                };
            }
        } catch (error) {
            // Ensure cleanup if error occurs
            await unlink(filePath).catch(() => { });
            throw error;
        }
    }
}
