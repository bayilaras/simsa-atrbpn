import { db } from '../config/database.js';
import { autentikasi, NewAutentikasi } from '../db/schema/autentikasi.js';
import { arsipElektronik } from '../db/schema/arsip-elektronik.js';
import { users } from '../db/schema/users.js';
import { eq, desc, ilike, and, gte, lte, inArray, sql } from 'drizzle-orm';
import { CreateAutentikasi, QueryAutentikasi } from '../validators/schemas.js';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

export class AutentikasiService {
    async create(data: CreateAutentikasi & { userId: string }) {
        return await db.transaction(async (tx: any) => {
            // 1. Create Autentikasi Record
            const [newAutentikasi] = await tx.insert(autentikasi).values({
                nomorBeritaAcara: data.nomorBeritaAcara,
                tanggalAutentikasi: data.tanggalAutentikasi,
                kegiatan: data.kegiatan,
                dilakukanOleh: data.userId,
                jabatanPenandaTangan: data.jabatanPenandaTangan,
                tempatDilakukan: data.tempatDilakukan,
                jumlahArsip: data.itemArsipIds.length,
            }).returning();

            // 2. Update Arsip Elektronik items
            await tx.update(arsipElektronik)
                .set({ autentikasiId: newAutentikasi.id })
                .where(inArray(arsipElektronik.id, data.itemArsipIds));

            // 3. Generate PDF
            const pdfPath = await this.generateBeritaAcaraPdf(newAutentikasi.id, tx as any);

            // 4. Update record with file path
            const [updated] = await tx.update(autentikasi)
                .set({ fileLampiran: pdfPath })
                .where(eq(autentikasi.id, newAutentikasi.id))
                .returning();

            return updated;
        });
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
            data,
            total: Number(countResult.count),
            page,
            totalPages: Math.ceil(Number(countResult.count) / limit),
        };
    }

    async findById(id: string) {
        return await db.query.autentikasi.findFirst({
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
    }

    async generateBeritaAcaraPdf(id: string, tx: any = db): Promise<string> {
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

        // Ensure directory exists
        const uploadDir = path.join(process.cwd(), 'uploads', 'autentikasi');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        const fileName = `BA_Autentikasi_${data.nomorBeritaAcara.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
        const filePath = path.join(uploadDir, fileName);
        const relativePath = `/uploads/autentikasi/${fileName}`;

        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);

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

        return new Promise((resolve, reject) => {
            stream.on('finish', () => resolve(relativePath));
            stream.on('error', reject);
        });
    }
}

export const autentikasiService = new AutentikasiService();
