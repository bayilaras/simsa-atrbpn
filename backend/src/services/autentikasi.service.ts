import { db } from '../config/database.js';
import { autentikasi } from '../db/schema/autentikasi.js';
import { arsipElektronik } from '../db/schema/arsip-elektronik.js';
import { fileAttachments } from '../db/schema/file-attachments.js';
import { eq, desc, ilike, and, gte, lte, inArray, isNull, sql } from 'drizzle-orm';
import { CreateAutentikasi, QueryAutentikasi } from '../validators/schemas.js';
import PDFDocument from 'pdfkit';
import crypto from 'node:crypto';
import { blobStorageService } from './blob-storage.service.js';
import { auditLogService, type CriticalAuditContext } from './audit-log.service.js';
import { Readable } from 'node:stream';
import { requireImmutableObjectGeneration } from '../storage/locator.js';
import {
    durableFinalObjectService,
    type FinalObjectWrite,
} from './durable-final-object.service.js';

function withoutPrivateLocator<T extends Record<string, any>>(record: T) {
    const {
        fileLampiran,
        fileLampiranObjectGeneration: _fileLampiranObjectGeneration,
        fileLampiranSha256: _fileLampiranSha256,
        fileLampiranSizeBytes: _fileLampiranSizeBytes,
        ...safe
    } = record;
    return { ...safe, hasPdf: Boolean(fileLampiran) };
}

export class AutentikasiService {
    async create(
        data: CreateAutentikasi & { userId: string },
        auditContext: CriticalAuditContext,
    ) {
        let finalWrite: FinalObjectWrite | null = null;
        try {
            return await db.transaction(async (tx: any) => {
                const uniqueItemIds = [...new Set(data.itemArsipIds)];
                if (uniqueItemIds.length !== data.itemArsipIds.length) {
                    throw new Error('Item arsip autentikasi tidak boleh duplikat');
                }

                const [newAutentikasi] = await tx.insert(autentikasi).values({
                    nomorBeritaAcara: data.nomorBeritaAcara,
                    tanggalAutentikasi: data.tanggalAutentikasi,
                    kegiatan: data.kegiatan,
                    dilakukanOleh: data.userId,
                    jabatanPenandaTangan: data.jabatanPenandaTangan,
                    tempatDilakukan: data.tempatDilakukan,
                    jumlahArsip: uniqueItemIds.length,
                }).returning();
                if (!newAutentikasi) throw new Error('Autentikasi gagal dibuat');

                const eligibleItems = await tx.select({ id: arsipElektronik.id })
                    .from(arsipElektronik)
                    .innerJoin(fileAttachments, eq(fileAttachments.id, arsipElektronik.fileAttachmentId))
                    .where(and(
                        inArray(arsipElektronik.id, uniqueItemIds),
                        isNull(arsipElektronik.autentikasiId),
                        eq(arsipElektronik.statusVerifikasi, 'verified'),
                        eq(arsipElektronik.immutable, true),
                        eq(fileAttachments.storageAccess, 'private'),
                        eq(fileAttachments.integrityStatus, 'verified'),
                        eq(fileAttachments.malwareScanStatus, 'clean'),
                    ))
                    .for('update');
                if (eligibleItems.length !== uniqueItemIds.length) {
                    throw new Error(
                        'Arsip harus terverifikasi, immutable, bersih dari malware, dan lolos pemeriksaan integritas',
                    );
                }

                const linkedItems = await tx.update(arsipElektronik)
                    .set({ autentikasiId: newAutentikasi.id, updatedAt: new Date() })
                    .where(and(
                        inArray(arsipElektronik.id, uniqueItemIds),
                        isNull(arsipElektronik.autentikasiId),
                        eq(arsipElektronik.statusVerifikasi, 'verified'),
                        eq(arsipElektronik.immutable, true),
                    ))
                    .returning({ id: arsipElektronik.id });
                if (linkedItems.length !== uniqueItemIds.length) {
                    throw new Error('Sebagian item arsip tidak ditemukan atau sudah diautentikasi');
                }

                const pdfBuffer = await this.generateBeritaAcaraPdfBuffer(newAutentikasi.id, tx);
                const fileName = this.pdfFileName(newAutentikasi.nomorBeritaAcara);
                finalWrite = await durableFinalObjectService.upload(newAutentikasi.id, {
                    fileName,
                    mimeType: 'application/pdf',
                    buffer: pdfBuffer,
                    folder: 'autentikasi',
                });
                const stored = finalWrite.stored;
                const uploadedObjectGeneration = requireImmutableObjectGeneration(
                    stored.url,
                    stored.generation,
                );

                const [updated] = await tx.update(autentikasi)
                    .set({
                        fileLampiran: stored.url,
                        fileLampiranObjectGeneration: uploadedObjectGeneration,
                        fileLampiranSha256: crypto.createHash('sha256').update(pdfBuffer).digest('hex'),
                        fileLampiranSizeBytes: pdfBuffer.length,
                        updatedAt: new Date(),
                    })
                    .where(eq(autentikasi.id, newAutentikasi.id))
                    .returning();
                if (!updated) throw new Error('Locator PDF autentikasi gagal direkam');

                const safeResult = withoutPrivateLocator(updated);
                await auditLogService.logActionOrThrow({
                    ...auditContext,
                    action: 'create',
                    entityType: 'autentikasi',
                    entityId: updated.id,
                    changes: { after: safeResult },
                }, tx);

                // This update is committed atomically with the domain row. If
                // anything above rolls back, the pre-write reservation stays
                // eligible for the isolated final-cleanup principal.
                await durableFinalObjectService.markReferenced(tx, finalWrite);

                return safeResult;
            });
        } catch (error) {
            await durableFinalObjectService.compensate(finalWrite, error);
            throw error;
        }
    }

    async findAll(query: QueryAutentikasi) {
        const { page = 1, limit = 20, search, tanggalDari, tanggalSampai } = query;
        const offset = (page - 1) * limit;

        const whereClause = and(
            search ? ilike(autentikasi.nomorBeritaAcara, `%${search}%`) : undefined,
            tanggalDari ? gte(autentikasi.tanggalAutentikasi, tanggalDari) : undefined,
            tanggalSampai ? lte(autentikasi.tanggalAutentikasi, tanggalSampai) : undefined,
        );

        const data = await db.query.autentikasi.findMany({
            where: whereClause,
            with: {
                petugas: {
                    columns: {
                        id: true,
                        name: true,
                        nip: true,
                        jabatan: true,
                    }
                }
            },
            limit,
            offset,
            orderBy: [desc(autentikasi.createdAt)],
        });

        const [countResult] = await db.select({ count: sql<number>`count(*)` })
            .from(autentikasi)
            .where(whereClause);

        return {
            data: data.map(item => withoutPrivateLocator(item)),
            total: Number(countResult.count),
            page,
            totalPages: Math.ceil(Number(countResult.count) / limit),
        };
    }

    async findById(id: string) {
        const result = await db.query.autentikasi.findFirst({
            where: eq(autentikasi.id, id),
            with: {
                petugas: {
                    columns: {
                        id: true,
                        name: true,
                        nip: true,
                        jabatan: true,
                    }
                },
                itemArsip: {
                    with: {
                        arsip: true
                    }
                }
            }
        });
        return result ? withoutPrivateLocator(result) : null;
    }

    async getPdfStream(id: string, auditContext: CriticalAuditContext) {
        const [record] = await db.select({
            locator: autentikasi.fileLampiran,
            objectGeneration: autentikasi.fileLampiranObjectGeneration,
            expectedSha256: autentikasi.fileLampiranSha256,
            expectedSizeBytes: autentikasi.fileLampiranSizeBytes,
            nomorBeritaAcara: autentikasi.nomorBeritaAcara,
        })
            .from(autentikasi)
            .where(eq(autentikasi.id, id))
            .limit(1);
        if (!record?.locator || !record.expectedSha256 || !record.expectedSizeBytes) return null;

        const objectGeneration = requireImmutableObjectGeneration(
            record.locator,
            record.objectGeneration,
        );
        const download = await blobStorageService.downloadFile(record.locator, {
            generation: objectGeneration || undefined,
        });
        if (!download) return null;
        if (download.mimeType !== 'application/pdf') {
            throw new Error('Stored autentikasi object is not a PDF');
        }
        const chunks: Buffer[] = [];
        let total = 0;
        for await (const chunk of download.stream) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            total += bytes.length;
            if (total > record.expectedSizeBytes) {
                throw new Error('Stored autentikasi PDF size mismatch');
            }
            chunks.push(bytes);
        }
        const buffer = Buffer.concat(chunks);
        const actualSha256 = crypto.createHash('sha256').update(buffer).digest('hex');
        if (buffer.length !== record.expectedSizeBytes || actualSha256 !== record.expectedSha256) {
            throw new Error('Stored autentikasi PDF integrity mismatch');
        }

        await auditLogService.logActionOrThrow({
            ...auditContext,
            action: 'download',
            entityType: 'autentikasi',
            entityId: id,
            changes: {
                sha256: actualSha256,
                sizeBytes: buffer.length,
            },
        });
        return {
            stream: Readable.from([buffer]),
            mimeType: 'application/pdf',
            fileName: this.pdfFileName(record.nomorBeritaAcara),
        };
    }

    async generateBeritaAcaraPdfBuffer(id: string, tx: any = db): Promise<Buffer> {
        const data = await tx.query.autentikasi.findFirst({
            where: eq(autentikasi.id, id),
            with: {
                petugas: true,
                itemArsip: {
                    with: {
                        arsip: true
                    }
                }
            }
        });

        if (!data) throw new Error('Autentikasi not found');

        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        const chunks: Buffer[] = [];
        const completed = new Promise<Buffer>((resolve, reject) => {
            doc.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);
        });

        // --- PDF CONTENT START ---

        // KOP SURAT (Simple Text for now, ideally Image)
        doc.font('Helvetica-Bold').fontSize(14).text('KEMENTERIAN AGRARIA DAN TATA RUANG/', { align: 'center' });
        doc.text('BADAN PERTANAHAN NASIONAL', { align: 'center' });
        doc.fontSize(12).text(data.tempatDilakukan || 'KANTOR PERTANAHAN', { align: 'center' });
        doc.moveDown();
        doc.lineWidth(2).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
        doc.moveDown(2);

        // JUDUL
        doc.font('Helvetica-Bold').fontSize(12).text('BERITA ACARA', { align: 'center' });
        doc.text('AUTENTIKASI ARSIP HASIL ALIH MEDIA', { align: 'center' });
        doc.font('Helvetica').fontSize(10).text(`Nomor: ${data.nomorBeritaAcara}`, { align: 'center' });
        doc.moveDown(2);

        // BODY
        const tanggal = new Date(data.tanggalAutentikasi).toLocaleDateString('id-ID', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
        });

        doc.font('Helvetica').fontSize(11).text('Pada hari ini ', { continued: true })
            .font('Helvetica-Bold').text(tanggal)
            .font('Helvetica').text(', bertempat di ')
            .font('Helvetica-Bold').text(data.tempatDilakukan || 'Kantor Pertanahan')
            .font('Helvetica').text(', telah dilakukan autentikasi arsip hasil alih media (digitalisasi) sebagaimana tercantum dalam daftar terlampir.');

        doc.moveDown();
        doc.text('Pelaksanaan autentikasi ini dilakukan untuk menjamin bahwa arsip hasil alih media tersebut sesuai dengan aslinya.');

        doc.moveDown(2);

        // SIGNATURES
        doc.text('Demikian Berita Acara ini dibuat untuk dipergunakan sebagaimana mestinya.', { align: 'justify' });
        doc.moveDown(3);

        const signatureY = doc.y;

        // Left side (Petugas)
        doc.text('Dibuat oleh,', 50, signatureY, { align: 'left', width: 200 });
        doc.text(data.petugas?.jabatan || 'Arsiparis', 50, signatureY + 15, { align: 'left', width: 200 });
        doc.moveDown(4);
        doc.text(`(${data.petugas?.name || '.........................'})`, 50, doc.y, { align: 'left', width: 200 });
        doc.text(`NIP. ${data.petugas?.nip || '.........................'}`, 50, doc.y + 15, { align: 'left', width: 200 });

        // Right side (Pejabat - Manual/Placeholder for now as we only have one user in schema)
        // Usually, known via 'jabatanPenandaTangan' or similar
        doc.text('Mengetahui,', 300, signatureY, { align: 'center', width: 240 });
        doc.text(data.jabatanPenandaTangan || 'Kepala Kantor', 300, signatureY + 15, { align: 'center', width: 240 });
        doc.moveDown(4);
        doc.text('( ....................................... )', 300, doc.y, { align: 'center', width: 240 });

        // --- LAMPIRAN (LIST ARSIP) ---
        doc.addPage();
        doc.font('Helvetica-Bold').fontSize(12).text('DAFTAR ARSIP HASIL ALIH MEDIA', { align: 'center' });
        doc.fontSize(10).text(`Lampiran Berita Acara Nomor: ${data.nomorBeritaAcara}`, { align: 'center' });
        doc.moveDown(2);

        // Table Header
        const tableTop = doc.y;
        const colNo = 40;
        const colKode = 80; // Kode Klasifikasi / No Berkas
        const colUraian = 200;
        const colTahun = 450;
        const colKet = 500;

        doc.fontSize(10).text('No', 50, tableTop);
        doc.text('Nomor Berkas', 80, tableTop);
        doc.text('Uraian Arsip', 200, tableTop);
        doc.text('Tahun', 450, tableTop);
        doc.lineWidth(1).moveTo(50, tableTop + 15).lineTo(545, tableTop + 15).stroke();

        let y = tableTop + 20;
        data.itemArsip.forEach((item: any, index: number) => {
            if (y > 750) {
                doc.addPage();
                y = 50;
            }
            const arsip = item.arsip; // joined data

            doc.font('Helvetica').fontSize(10);
            doc.text(`${index + 1}`, 50, y);
            doc.text(arsip?.nomorBerkas || '-', 80, y);
            doc.text((arsip?.uraianBerkas || '-').substring(0, 50), 200, y, { width: 240 });
            doc.text(`${arsip?.tahun || '-'}`, 450, y);

            y += 20;
        });

        doc.end();
        return completed;
    }

    private pdfFileName(nomorBeritaAcara: string): string {
        const safeNumber = nomorBeritaAcara
            .normalize('NFKC')
            .replace(/[^a-zA-Z0-9._-]/g, '_')
            .replace(/_+/g, '_')
            .slice(0, 160);
        return `BA_Autentikasi_${safeNumber || 'arsip'}.pdf`;
    }
}

export const autentikasiService = new AutentikasiService();
