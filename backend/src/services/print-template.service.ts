import PDFDocument from 'pdfkit';
import { penyusutanService } from './penyusutan.service';
import { NO_RECORD_UNIT_ACCESS, type RecordUnitScope } from '../utils/record-unit-scope';

/**
 * Print Template Service
 * Generates official PDF templates following Permen ATRBPN 2/2026 formats
 */
class PrintTemplateService {
    private readonly FONT_SIZE = { title: 14, subtitle: 11, body: 9, small: 8 };
    private readonly MARGIN = { top: 50, bottom: 50, left: 50, right: 50 };

    // ==================== FORMULIR 4: DAFTAR ARSIP AKTIF ====================

    async generateDaftarArsipAktif(
        unitKerjaId: string,
        tahun?: number,
        securityClassifications?: string[] | null,
    ): Promise<Buffer> {
        const data = await penyusutanService.generateDaftarArsipAktif(
            unitKerjaId,
            tahun,
            securityClassifications,
        );
        const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: this.MARGIN.left });
        const buffers: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => buffers.push(chunk));

        // Header
        doc.fontSize(this.FONT_SIZE.title).font('Helvetica-Bold')
            .text('DAFTAR ARSIP AKTIF', { align: 'center' });
        doc.fontSize(this.FONT_SIZE.subtitle).font('Helvetica')
            .text(`KEMENTERIAN AGRARIA DAN TATA RUANG/BADAN PERTANAHAN NASIONAL`, { align: 'center' });
        doc.moveDown(0.5);
        doc.fontSize(this.FONT_SIZE.body)
            .text(`Unit Pengolah: ${data.unitKerjaId}`)
            .text(`Tahun: ${data.tahun}`)
            .text(`Tanggal Cetak: ${data.tanggalCetak}`);
        doc.moveDown();

        // Table header
        const cols = [
            { header: 'No', width: 25 },
            { header: 'No. Berkas', width: 55 },
            { header: 'Kode Klas.', width: 55 },
            { header: 'Uraian Berkas', width: 130 },
            { header: 'Kurun Waktu', width: 60 },
            { header: 'Jml', width: 25 },
            { header: 'No. Item', width: 45 },
            { header: 'Tgl. Arsip', width: 55 },
            { header: 'Tk. Perk.', width: 45 },
            { header: 'Lokasi', width: 60 },
            { header: 'Kls. Keamanan', width: 55 },
            { header: 'Keterangan', width: 80 },
        ];

        let x = this.MARGIN.left;
        const startY = doc.y;

        doc.fontSize(this.FONT_SIZE.small).font('Helvetica-Bold');
        cols.forEach(col => {
            doc.rect(x, startY, col.width, 20).stroke();
            doc.text(col.header, x + 2, startY + 3, { width: col.width - 4, align: 'center' });
            x += col.width;
        });

        doc.font('Helvetica').fontSize(this.FONT_SIZE.small);
        let y = startY + 20;

        for (const item of data.daftarArsip) {
            if (y > 500) {
                doc.addPage();
                y = this.MARGIN.top;
            }

            x = this.MARGIN.left;
            const rowHeight = 18;
            const values = [
                String(item.no), item.nomorBerkas, item.kodeKlasifikasi,
                item.uraianBerkas, item.kurunWaktu, String(item.jumlah),
                item.nomorItem, item.tanggalArsip, item.tingkatPerkembangan,
                item.lokasiSimpan, item.klasifikasiKeamanan, item.keterangan,
            ];

            cols.forEach((col, i) => {
                doc.rect(x, y, col.width, rowHeight).stroke();
                doc.text(values[i] || '-', x + 2, y + 3, {
                    width: col.width - 4,
                    height: rowHeight - 4,
                    ellipsis: true,
                });
                x += col.width;
            });

            y += rowHeight;
        }

        // Footer
        doc.moveDown(2);
        const footerY = y + 30;
        doc.fontSize(this.FONT_SIZE.body);
        doc.text(`Total Berkas: ${data.totalBerkas}`, this.MARGIN.left, footerY);
        doc.moveDown(2);

        // Signature block
        const sigY = footerY + 40;
        doc.text(`${data.tanggalCetak}`, 500, sigY);
        doc.text('Pimpinan Unit Pengolah,', 500, sigY + 15);
        doc.moveDown(4);
        doc.text('____________________', 500, sigY + 70);
        doc.text('NIP.', 500, sigY + 85);

        doc.end();
        return new Promise(resolve => {
            doc.on('end', () => resolve(Buffer.concat(buffers)));
        });
    }

    // ==================== FORMULIR 6: DAFTAR ARSIP INAKTIF ====================

    async generateDaftarArsipInaktif(
        unitKerjaId: string,
        tahun?: number,
        securityClassifications?: string[] | null,
    ): Promise<Buffer> {
        const data = await penyusutanService.generateDaftarArsipInaktif(
            unitKerjaId,
            tahun,
            securityClassifications,
        );
        const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: this.MARGIN.left });
        const buffers: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => buffers.push(chunk));

        doc.fontSize(this.FONT_SIZE.title).font('Helvetica-Bold')
            .text('DAFTAR ARSIP INAKTIF', { align: 'center' });
        doc.fontSize(this.FONT_SIZE.subtitle).font('Helvetica')
            .text('KEMENTERIAN AGRARIA DAN TATA RUANG/BADAN PERTANAHAN NASIONAL', { align: 'center' });
        doc.moveDown(0.5);
        doc.fontSize(this.FONT_SIZE.body)
            .text(`Unit Pengolah: ${data.unitKerjaId}`)
            .text(`Tahun: ${data.tahun}`)
            .text(`Tanggal Cetak: ${data.tanggalCetak}`);
        doc.moveDown();

        const cols = [
            { header: 'No', width: 25 },
            { header: 'No. Arsip', width: 50 },
            { header: 'Kode Klas.', width: 55 },
            { header: 'Uraian Informasi Arsip', width: 130 },
            { header: 'Kurun Waktu', width: 55 },
            { header: 'Jml', width: 25 },
            { header: 'Tk. Perk.', width: 45 },
            { header: 'Lokasi', width: 60 },
            { header: 'Kls. Keamanan', width: 55 },
            { header: 'Jangka Simpan', width: 60 },
            { header: 'Nasib Akhir', width: 50 },
            { header: 'Ket.', width: 60 },
        ];

        let x = this.MARGIN.left;
        const startY = doc.y;

        doc.fontSize(this.FONT_SIZE.small).font('Helvetica-Bold');
        cols.forEach(col => {
            doc.rect(x, startY, col.width, 20).stroke();
            doc.text(col.header, x + 2, startY + 3, { width: col.width - 4, align: 'center' });
            x += col.width;
        });

        doc.font('Helvetica').fontSize(this.FONT_SIZE.small);
        let y = startY + 20;

        for (const item of data.daftarArsip) {
            if (y > 500) { doc.addPage(); y = this.MARGIN.top; }

            x = this.MARGIN.left;
            const rowHeight = 18;
            const values = [
                String(item.no), item.nomorArsip, item.kodeKlasifikasi,
                item.uraianInformasiArsip, item.kurunWaktu, String(item.jumlah),
                item.tingkatPerkembangan, item.lokasiSimpan, item.klasifikasiKeamanan,
                item.jangkaSimpan, item.nasibAkhir, item.keterangan,
            ];

            cols.forEach((col, i) => {
                doc.rect(x, y, col.width, rowHeight).stroke();
                doc.text(values[i] || '-', x + 2, y + 3, {
                    width: col.width - 4, height: rowHeight - 4, ellipsis: true,
                });
                x += col.width;
            });
            y += rowHeight;
        }

        const footerY = y + 30;
        doc.fontSize(this.FONT_SIZE.body);
        doc.text(`Total Berkas: ${data.totalBerkas}`, this.MARGIN.left, footerY);

        const sigY = footerY + 40;
        doc.text('Mengetahui,', this.MARGIN.left, sigY);
        doc.text('Pimpinan Unit Kearsipan,', this.MARGIN.left, sigY + 15);
        doc.text('____________________', this.MARGIN.left, sigY + 70);
        doc.text('NIP.', this.MARGIN.left, sigY + 85);

        doc.text(`${data.tanggalCetak}`, 500, sigY);
        doc.text('Pimpinan Unit Pengolah,', 500, sigY + 15);
        doc.text('____________________', 500, sigY + 70);
        doc.text('NIP.', 500, sigY + 85);

        doc.end();
        return new Promise(resolve => {
            doc.on('end', () => resolve(Buffer.concat(buffers)));
        });
    }

    // ==================== FORMULIR 16: DAFTAR ARSIP USUL MUSNAH ====================

    async generateDaftarUsulMusnah(
        penyusutanId: string,
        unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS,
        securityClassifications?: string[] | null,
    ): Promise<Buffer> {
        const batch = await penyusutanService.findById(
            penyusutanId,
            unitScope,
            securityClassifications,
        );
        if (!batch) throw new Error('Batch not found');

        const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: this.MARGIN.left });
        const buffers: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => buffers.push(chunk));

        doc.fontSize(this.FONT_SIZE.title).font('Helvetica-Bold')
            .text('DAFTAR ARSIP USUL MUSNAH', { align: 'center' });
        doc.fontSize(this.FONT_SIZE.subtitle).font('Helvetica')
            .text('KEMENTERIAN AGRARIA DAN TATA RUANG/BADAN PERTANAHAN NASIONAL', { align: 'center' });
        doc.moveDown(0.5);
        doc.fontSize(this.FONT_SIZE.body)
            .text(`Nomor: ${batch.nomorBA || '-'}`)
            .text(`Unit Kerja: ${batch.unitKerjaId}`)
            .text(`Tanggal Usul: ${batch.tanggalUsul || '-'}`);
        doc.moveDown();

        const cols = [
            { header: 'No', width: 25 },
            { header: 'Kode Klas.', width: 55 },
            { header: 'Jenis Arsip', width: 130 },
            { header: 'Kurun Waktu', width: 60 },
            { header: 'Jumlah', width: 40 },
            { header: 'Tk. Perk.', width: 45 },
            { header: 'JRA', width: 50 },
            { header: 'Retensi Aktif', width: 55 },
            { header: 'Retensi Inaktif', width: 55 },
            { header: 'Ket.', width: 80 },
        ];

        this.drawItemTable(doc, cols, batch.items, batch);
        this.addSignatureBlock(doc, doc.y + 30, batch);

        doc.end();
        return new Promise(resolve => {
            doc.on('end', () => resolve(Buffer.concat(buffers)));
        });
    }

    // ==================== FORMULIR 14: DAFTAR ARSIP USUL PINDAH ====================

    async generateDaftarUsulPindah(
        penyusutanId: string,
        unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS,
        securityClassifications?: string[] | null,
    ): Promise<Buffer> {
        const batch = await penyusutanService.findById(
            penyusutanId,
            unitScope,
            securityClassifications,
        );
        if (!batch) throw new Error('Batch not found');

        const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: this.MARGIN.left });
        const buffers: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => buffers.push(chunk));

        doc.fontSize(this.FONT_SIZE.title).font('Helvetica-Bold')
            .text('DAFTAR ARSIP USUL PINDAH', { align: 'center' });
        doc.fontSize(this.FONT_SIZE.subtitle).font('Helvetica')
            .text('KEMENTERIAN AGRARIA DAN TATA RUANG/BADAN PERTANAHAN NASIONAL', { align: 'center' });
        doc.moveDown(0.5);
        doc.fontSize(this.FONT_SIZE.body)
            .text(`Nomor: ${batch.nomorBA || '-'}`)
            .text(`Unit Pengolah: ${batch.unitKerjaId}`)
            .text(`Tanggal Usul: ${batch.tanggalUsul || '-'}`);
        doc.moveDown();

        const cols = [
            { header: 'No', width: 25 },
            { header: 'Kode Klas.', width: 55 },
            { header: 'Jenis Arsip', width: 130 },
            { header: 'Kurun Waktu', width: 60 },
            { header: 'Jumlah', width: 40 },
            { header: 'Tk. Perk.', width: 45 },
            { header: 'JRA', width: 50 },
            { header: 'Retensi Aktif', width: 55 },
            { header: 'Retensi Inaktif', width: 55 },
            { header: 'Ket.', width: 80 },
        ];

        this.drawItemTable(doc, cols, batch.items, batch);

        // Signature: Yang Menyerahkan dan Yang Menerima
        const sigY = doc.y + 30;
        doc.fontSize(this.FONT_SIZE.body);
        doc.text('Yang Menyerahkan,', this.MARGIN.left, sigY);
        doc.text('Pimpinan Unit Pengolah', this.MARGIN.left, sigY + 15);
        doc.text('____________________', this.MARGIN.left, sigY + 70);
        doc.text('NIP. ________________', this.MARGIN.left, sigY + 85);

        doc.text('Yang Menerima,', 350, sigY);
        doc.text('Pimpinan Unit Kearsipan', 350, sigY + 15);
        doc.text('____________________', 350, sigY + 70);
        doc.text('NIP. ________________', 350, sigY + 85);

        doc.end();
        return new Promise(resolve => {
            doc.on('end', () => resolve(Buffer.concat(buffers)));
        });
    }

    // ==================== FORMULIR 17: DAFTAR ARSIP USUL SERAH ====================

    async generateDaftarUsulSerah(
        penyusutanId: string,
        unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS,
        securityClassifications?: string[] | null,
    ): Promise<Buffer> {
        const batch = await penyusutanService.findById(
            penyusutanId,
            unitScope,
            securityClassifications,
        );
        if (!batch) throw new Error('Batch not found');

        const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: this.MARGIN.left });
        const buffers: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => buffers.push(chunk));

        doc.fontSize(this.FONT_SIZE.title).font('Helvetica-Bold')
            .text('DAFTAR ARSIP USUL SERAH', { align: 'center' });
        doc.fontSize(this.FONT_SIZE.subtitle).font('Helvetica')
            .text('KEMENTERIAN AGRARIA DAN TATA RUANG/BADAN PERTANAHAN NASIONAL', { align: 'center' });
        doc.moveDown(0.5);
        doc.fontSize(this.FONT_SIZE.body)
            .text(`Nomor: ${batch.nomorBA || '-'}`)
            .text(`Unit Kerja: ${batch.unitKerjaId}`)
            .text(`Tanggal Usul: ${batch.tanggalUsul || '-'}`);
        doc.moveDown();

        const cols = [
            { header: 'No', width: 25 },
            { header: 'Kode Klas.', width: 55 },
            { header: 'Jenis Arsip', width: 130 },
            { header: 'Kurun Waktu', width: 60 },
            { header: 'Jumlah', width: 40 },
            { header: 'Tk. Perk.', width: 45 },
            { header: 'JRA', width: 50 },
            { header: 'Retensi Aktif', width: 55 },
            { header: 'Retensi Inaktif', width: 55 },
            { header: 'Ket.', width: 80 },
        ];

        this.drawItemTable(doc, cols, batch.items, batch);

        // Signature: Yang Menyerahkan dan Lembaga Kearsipan
        const sigY = doc.y + 30;
        doc.fontSize(this.FONT_SIZE.body);
        doc.text('Yang Menyerahkan,', this.MARGIN.left, sigY);
        doc.text('Pimpinan Unit Kearsipan', this.MARGIN.left, sigY + 15);
        doc.text('____________________', this.MARGIN.left, sigY + 70);
        doc.text('NIP. ________________', this.MARGIN.left, sigY + 85);

        doc.text('Yang Menerima,', 350, sigY);
        doc.text('Lembaga Kearsipan', 350, sigY + 15);
        doc.text('____________________', 350, sigY + 70);
        doc.text('NIP. ________________', 350, sigY + 85);

        doc.end();
        return new Promise(resolve => {
            doc.on('end', () => resolve(Buffer.concat(buffers)));
        });
    }

    // ==================== BERITA ACARA PEMINDAHAN (Formulir 15) ====================

    async generateBeritaAcaraPemindahan(
        penyusutanId: string,
        unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS,
        securityClassifications?: string[] | null,
    ): Promise<Buffer> {
        const batch = await penyusutanService.findById(
            penyusutanId,
            unitScope,
            securityClassifications,
        );
        if (!batch) throw new Error('Batch not found');

        const doc = new PDFDocument({ size: 'A4', layout: 'portrait', margin: this.MARGIN.left });
        const buffers: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => buffers.push(chunk));

        this.addKopSurat(doc);

        // Title
        doc.fontSize(this.FONT_SIZE.title).font('Helvetica-Bold')
            .text('BERITA ACARA PEMINDAHAN ARSIP', { align: 'center' });
        doc.fontSize(this.FONT_SIZE.subtitle).font('Helvetica-Bold')
            .text(`Nomor: ${batch.nomorBA || '...........................'}`, { align: 'center' });
        doc.moveDown();

        // Body
        const tanggal = this.formatTanggal(batch);
        doc.fontSize(10).font('Helvetica');
        doc.text(`Pada hari ini, ${tanggal}, kami yang bertanda tangan di bawah ini:`);
        doc.moveDown(0.5);
        doc.text(`    Unit Pengolah  : ${batch.unitKerjaId}`);
        doc.text(`    Unit Kearsipan : _________________________`);
        doc.moveDown();

        doc.text('Telah melakukan pemindahan arsip dari Unit Pengolah ke Unit Kearsipan, sesuai dengan ketentuan Jadwal Retensi Arsip (JRA) yang berlaku. Arsip yang dipindahkan telah melewati masa retensi aktif dan memenuhi persyaratan untuk dipindahkan ke Unit Kearsipan.');
        doc.moveDown();
        doc.text('Adapun arsip yang dipindahkan adalah sebagaimana daftar terlampir, dengan rincian sebagai berikut:');
        doc.moveDown();

        doc.font('Helvetica-Bold');
        doc.text(`Total Berkas   : ${batch.totalBerkas}`);
        doc.text(`Total Volume   : ${batch.totalVolume || '-'}`);
        doc.moveDown();

        // Items table
        this.drawBeritaAcaraTable(doc, batch.items);

        // Closing
        doc.moveDown(2);
        doc.fontSize(10).font('Helvetica');
        doc.text('Demikian Berita Acara Pemindahan Arsip ini dibuat dengan sebenarnya untuk dapat dipergunakan sebagaimana mestinya.');
        doc.moveDown();

        if (batch.catatanPanitia) {
            doc.text(`Catatan: ${batch.catatanPanitia}`);
            doc.moveDown();
        }

        // Signatures: Yang Menyerahkan & Yang Menerima
        const sigY = doc.y + 20;
        doc.fontSize(this.FONT_SIZE.body);
        doc.text('Yang Menyerahkan,', this.MARGIN.left, sigY);
        doc.text('Pimpinan Unit Pengolah', this.MARGIN.left, sigY + 15);
        doc.text('____________________', this.MARGIN.left, sigY + 70);
        doc.text('NIP. ________________', this.MARGIN.left, sigY + 85);

        doc.text('Yang Menerima,', 350, sigY);
        doc.text('Pimpinan Unit Kearsipan', 350, sigY + 15);
        doc.text('____________________', 350, sigY + 70);
        doc.text('NIP. ________________', 350, sigY + 85);

        doc.end();
        return new Promise(resolve => {
            doc.on('end', () => resolve(Buffer.concat(buffers)));
        });
    }

    // ==================== BERITA ACARA PEMUSNAHAN (Formulir 18) ====================

    async generateBeritaAcaraPemusnahan(
        penyusutanId: string,
        unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS,
        securityClassifications?: string[] | null,
    ): Promise<Buffer> {
        const batch = await penyusutanService.findById(
            penyusutanId,
            unitScope,
            securityClassifications,
        );
        if (!batch) throw new Error('Batch not found');

        const doc = new PDFDocument({ size: 'A4', layout: 'portrait', margin: this.MARGIN.left });
        const buffers: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => buffers.push(chunk));

        this.addKopSurat(doc);

        doc.fontSize(this.FONT_SIZE.title).font('Helvetica-Bold')
            .text('BERITA ACARA PEMUSNAHAN ARSIP', { align: 'center' });
        doc.fontSize(this.FONT_SIZE.subtitle).font('Helvetica-Bold')
            .text(`Nomor: ${batch.nomorBA || '...........................'}`, { align: 'center' });
        doc.moveDown();

        const tanggal = this.formatTanggal(batch);
        doc.fontSize(10).font('Helvetica');
        doc.text(`Pada hari ini, ${tanggal}, bertempat di Kantor Kementerian ATR/BPN, kami yang bertanda tangan di bawah ini:`);
        doc.moveDown(0.5);
        doc.text(`    Unit Kerja : ${batch.unitKerjaId}`);
        doc.moveDown();

        doc.text('Berdasarkan pertimbangan panitia penilai penyusutan arsip, telah dilakukan pemusnahan terhadap arsip yang telah melampaui masa retensinya dan berketerangan musnah berdasarkan Jadwal Retensi Arsip (JRA) yang berlaku.');
        doc.moveDown();

        doc.text('Pemusnahan arsip dilakukan dengan cara:');
        doc.moveDown(0.3);
        doc.text('    □  Dibakar');
        doc.text('    □  Dicacah');
        doc.text('    □  Dilebur');
        doc.text('    □  Lainnya: _______________');
        doc.moveDown();

        doc.text('Adapun arsip yang dimusnahkan adalah sebagai berikut:');
        doc.moveDown();

        doc.font('Helvetica-Bold');
        doc.text(`Total Berkas   : ${batch.totalBerkas}`);
        doc.text(`Total Volume   : ${batch.totalVolume || '-'}`);
        doc.moveDown();

        // Items table
        this.drawBeritaAcaraTable(doc, batch.items);

        // Closing
        doc.moveDown(2);
        doc.fontSize(10).font('Helvetica');
        doc.text('Demikian Berita Acara Pemusnahan Arsip ini dibuat dengan sebenarnya untuk dapat dipergunakan sebagaimana mestinya.');
        doc.moveDown();

        if (batch.catatanPanitia) {
            doc.text(`Catatan Panitia: ${batch.catatanPanitia}`);
            doc.moveDown();
        }

        // Signatures: Mengetahui, Ketua Tim, Pelaksana (3 columns)
        const sigY = doc.y + 20;
        doc.fontSize(this.FONT_SIZE.body);

        doc.text('Mengetahui,', this.MARGIN.left, sigY);
        doc.text('Pimpinan Unit Kerja', this.MARGIN.left, sigY + 15);
        doc.text('____________________', this.MARGIN.left, sigY + 70);
        doc.text('NIP. ________________', this.MARGIN.left, sigY + 85);

        doc.text('Ketua Tim', 220, sigY);
        doc.text('Penilai Arsip', 220, sigY + 15);
        doc.text('____________________', 220, sigY + 70);
        doc.text('NIP. ________________', 220, sigY + 85);

        doc.text('Pelaksana', 400, sigY);
        doc.text('Pemusnahan', 400, sigY + 15);
        doc.text('____________________', 400, sigY + 70);
        doc.text('NIP. ________________', 400, sigY + 85);

        doc.end();
        return new Promise(resolve => {
            doc.on('end', () => resolve(Buffer.concat(buffers)));
        });
    }

    // ==================== BERITA ACARA ALIH MEDIA ====================

    async generateBeritaAcaraAlihMedia(
        penyusutanId: string,
        unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS,
        securityClassifications?: string[] | null,
    ): Promise<Buffer> {
        const batch = await penyusutanService.findById(
            penyusutanId,
            unitScope,
            securityClassifications,
        );
        if (!batch) throw new Error('Batch not found');

        const doc = new PDFDocument({ size: 'A4', layout: 'portrait', margin: this.MARGIN.left });
        const buffers: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => buffers.push(chunk));

        this.addKopSurat(doc);

        doc.fontSize(this.FONT_SIZE.title).font('Helvetica-Bold')
            .text('BERITA ACARA ALIH MEDIA ARSIP', { align: 'center' });
        doc.fontSize(this.FONT_SIZE.subtitle).font('Helvetica-Bold')
            .text(`Nomor: ${batch.nomorBA || '...........................'}`, { align: 'center' });
        doc.moveDown();

        const tanggal = this.formatTanggal(batch);
        doc.fontSize(10).font('Helvetica');
        doc.text(`Pada hari ini, ${tanggal}, kami yang bertanda tangan di bawah ini:`);
        doc.moveDown(0.5);
        doc.text(`    Unit Kerja : ${batch.unitKerjaId}`);
        doc.moveDown();

        doc.text('Telah melakukan alih media terhadap arsip dari bentuk media asal ke bentuk media tujuan, sesuai dengan ketentuan peraturan perundang-undangan yang berlaku. Proses alih media dilaksanakan dengan memperhatikan keautentikan, keutuhan, keamanan, dan keselamatan informasi arsip.');
        doc.moveDown();

        doc.text('Alih media dilakukan:');
        doc.moveDown(0.3);
        doc.text('    Media Asal   : □ Kertas  □ Mikrofilm  □ Media Lainnya: _________');
        doc.text('    Media Tujuan : □ Digital (PDF/A)  □ Mikrofilm  □ Media Lainnya: _________');
        doc.text('    Resolusi     : ___________ DPI');
        doc.text('    Format File  : □ PDF/A  □ TIFF  □ JPEG  □ Lainnya: _________');
        doc.moveDown();

        doc.text('Adapun arsip yang telah dialih-mediakan adalah sebagai berikut:');
        doc.moveDown();

        doc.font('Helvetica-Bold');
        doc.text(`Total Berkas   : ${batch.totalBerkas}`);
        doc.text(`Total Volume   : ${batch.totalVolume || '-'}`);
        doc.moveDown();

        // Items table with additional columns for alih media
        const cols = [
            { header: 'No', width: 25 },
            { header: 'Kode Klasifikasi', width: 70 },
            { header: 'Uraian Arsip', width: 150 },
            { header: 'Kurun Waktu', width: 65 },
            { header: 'Jumlah', width: 35 },
            { header: 'Media Asal', width: 55 },
            { header: 'Media Tujuan', width: 55 },
            { header: 'Ket.', width: 45 },
        ];

        let x = this.MARGIN.left;
        const startY = doc.y;

        doc.fontSize(this.FONT_SIZE.small).font('Helvetica-Bold');
        cols.forEach(col => {
            doc.rect(x, startY, col.width, 18).stroke();
            doc.text(col.header, x + 2, startY + 3, { width: col.width - 4, align: 'center' });
            x += col.width;
        });

        doc.font('Helvetica').fontSize(this.FONT_SIZE.small);
        let y = startY + 18;

        for (const item of batch.items) {
            if (y > 700) { doc.addPage(); y = this.MARGIN.top; }

            x = this.MARGIN.left;
            const rowHeight = 16;
            const a = item.arsip;
            const values = [
                String(item.nomorUrut || '-'),
                a?.kodeKlasifikasi || '-',
                a?.uraianBerkas || a?.uraianItem || '-',
                a?.kurunWaktu || '-',
                String(a?.jumlah || 1),
                'Kertas',
                'Digital',
                item.keterangan || a?.keterangan || '-',
            ];

            cols.forEach((col, i) => {
                doc.rect(x, y, col.width, rowHeight).stroke();
                doc.text(values[i], x + 2, y + 2, {
                    width: col.width - 4, height: rowHeight - 4, ellipsis: true,
                });
                x += col.width;
            });
            y += rowHeight;
        }

        // Closing
        doc.moveDown(2);
        doc.fontSize(10).font('Helvetica');
        doc.text('Hasil alih media telah diverifikasi dan dinyatakan sesuai dengan arsip asli. Demikian Berita Acara Alih Media Arsip ini dibuat dengan sebenarnya untuk dapat dipergunakan sebagaimana mestinya.');
        doc.moveDown();

        if (batch.catatanPanitia) {
            doc.text(`Catatan: ${batch.catatanPanitia}`);
            doc.moveDown();
        }

        // Signatures: Mengetahui & Pelaksana Alih Media
        const sigY = doc.y + 20;
        doc.fontSize(this.FONT_SIZE.body);
        doc.text('Mengetahui,', this.MARGIN.left, sigY);
        doc.text('Pimpinan Unit Kearsipan', this.MARGIN.left, sigY + 15);
        doc.text('____________________', this.MARGIN.left, sigY + 70);
        doc.text('NIP. ________________', this.MARGIN.left, sigY + 85);

        doc.text('Pelaksana Alih Media,', 350, sigY);
        doc.text('Arsiparis/Pengelola Arsip', 350, sigY + 15);
        doc.text('____________________', 350, sigY + 70);
        doc.text('NIP. ________________', 350, sigY + 85);

        doc.end();
        return new Promise(resolve => {
            doc.on('end', () => resolve(Buffer.concat(buffers)));
        });
    }

    // ==================== BERITA ACARA PENYERAHAN (Formulir 17) ====================

    async generateBeritaAcaraPenyerahan(
        penyusutanId: string,
        unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS,
        securityClassifications?: string[] | null,
    ): Promise<Buffer> {
        const batch = await penyusutanService.findById(
            penyusutanId,
            unitScope,
            securityClassifications,
        );
        if (!batch) throw new Error('Batch not found');

        const doc = new PDFDocument({ size: 'A4', layout: 'portrait', margin: this.MARGIN.left });
        const buffers: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => buffers.push(chunk));

        this.addKopSurat(doc);

        doc.fontSize(this.FONT_SIZE.title).font('Helvetica-Bold')
            .text('BERITA ACARA PENYERAHAN ARSIP STATIS', { align: 'center' });
        doc.fontSize(this.FONT_SIZE.subtitle).font('Helvetica-Bold')
            .text(`Nomor: ${batch.nomorBA || '...........................'}`, { align: 'center' });
        doc.moveDown();

        const tanggal = this.formatTanggal(batch);
        doc.fontSize(10).font('Helvetica');
        doc.text(`Pada hari ini, ${tanggal}, kami yang bertanda tangan di bawah ini:`);
        doc.moveDown(0.5);

        doc.text('PIHAK PERTAMA (Yang Menyerahkan):');
        doc.text(`    Unit Kerja : ${batch.unitKerjaId}`);
        doc.text('    Kementerian Agraria dan Tata Ruang/Badan Pertanahan Nasional');
        doc.moveDown(0.5);

        doc.text('PIHAK KEDUA (Yang Menerima):');
        doc.text('    Arsip Nasional Republik Indonesia (ANRI)');
        doc.text('    Jl. Ampera Raya No. 7, Cilandak, Jakarta Selatan');
        doc.moveDown();

        doc.text('Telah dilakukan penyerahan arsip statis dari Pihak Pertama kepada Pihak Kedua, sesuai dengan ketentuan peraturan perundang-undangan yang berlaku mengenai kearsipan. Arsip yang diserahkan telah memenuhi kriteria sebagai arsip statis yang memiliki nilai guna kesejarahan.');
        doc.moveDown();

        doc.text('Adapun arsip yang diserahkan adalah sebagai berikut:');
        doc.moveDown();

        doc.font('Helvetica-Bold');
        doc.text(`Total Berkas   : ${batch.totalBerkas}`);
        doc.text(`Total Volume   : ${batch.totalVolume || '-'}`);
        doc.moveDown();

        // Items table
        this.drawBeritaAcaraTable(doc, batch.items);

        // Closing
        doc.moveDown(2);
        doc.fontSize(10).font('Helvetica');
        doc.text('Demikian Berita Acara Penyerahan Arsip Statis ini dibuat dalam rangkap 2 (dua) bermeterai cukup, masing-masing mempunyai kekuatan hukum yang sama, untuk dapat dipergunakan sebagaimana mestinya.');
        doc.moveDown();

        if (batch.catatanPanitia) {
            doc.text(`Catatan: ${batch.catatanPanitia}`);
            doc.moveDown();
        }

        // Signatures: Pihak Pertama & Pihak Kedua
        const sigY = doc.y + 20;
        doc.fontSize(this.FONT_SIZE.body);
        doc.text('PIHAK PERTAMA,', this.MARGIN.left, sigY);
        doc.text('Yang Menyerahkan', this.MARGIN.left, sigY + 12);
        doc.text('Pimpinan Unit Kearsipan', this.MARGIN.left, sigY + 24);
        doc.text('____________________', this.MARGIN.left, sigY + 80);
        doc.text('NIP. ________________', this.MARGIN.left, sigY + 95);

        doc.text('PIHAK KEDUA,', 350, sigY);
        doc.text('Yang Menerima', 350, sigY + 12);
        doc.text('Kepala ANRI/Pejabat Berwenang', 350, sigY + 24);
        doc.text('____________________', 350, sigY + 80);
        doc.text('NIP. ________________', 350, sigY + 95);

        doc.end();
        return new Promise(resolve => {
            doc.on('end', () => resolve(Buffer.concat(buffers)));
        });
    }

    // ==================== BACKWARD-COMPATIBLE DISPATCHER ====================

    /**
     * Generic Berita Acara generator - dispatches to type-specific methods
     * Kept for backward compatibility with existing route
     */
    async generateBeritaAcara(
        penyusutanId: string,
        unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS,
        securityClassifications?: string[] | null,
    ): Promise<Buffer> {
        const batch = await penyusutanService.findById(
            penyusutanId,
            unitScope,
            securityClassifications,
        );
        if (!batch) throw new Error('Batch not found');

        switch (batch.jenisPenyusutan) {
            case 'pemindahan':
                return this.generateBeritaAcaraPemindahan(penyusutanId, unitScope, securityClassifications);
            case 'pemusnahan':
                return this.generateBeritaAcaraPemusnahan(penyusutanId, unitScope, securityClassifications);
            case 'alih_media':
                return this.generateBeritaAcaraAlihMedia(penyusutanId, unitScope, securityClassifications);
            case 'penyerahan':
                return this.generateBeritaAcaraPenyerahan(penyusutanId, unitScope, securityClassifications);
            default:
                return this.generateBeritaAcaraPemindahan(penyusutanId, unitScope, securityClassifications);
        }
    }

    // ==================== SURAT PERMOHONAN ARSIP STATIS (Formulir 24) ====================

    async generateSuratPermohonanPenyerahan(
        penyusutanId: string,
        unitScope: RecordUnitScope = NO_RECORD_UNIT_ACCESS,
        securityClassifications?: string[] | null,
    ): Promise<Buffer> {
        const batch = await penyusutanService.findById(
            penyusutanId,
            unitScope,
            securityClassifications,
        );
        if (!batch) throw new Error('Batch not found');

        const doc = new PDFDocument({ size: 'A4', layout: 'portrait', margin: this.MARGIN.left });
        const buffers: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => buffers.push(chunk));

        this.addKopSurat(doc);

        const tanggal = this.formatTanggal(batch);
        const nomor = batch.nomorBA ? batch.nomorBA.replace('BA', 'SP') : '...........................'; // Generate provisional number

        // Date and Location (Right aligned)
        doc.fontSize(this.FONT_SIZE.body).font('Helvetica');
        doc.text(`Jakarta, ${tanggal}`, { align: 'right' });
        doc.moveDown();

        // Header block
        const startY = doc.y;
        doc.text(`Nomor     : ${nomor}`);
        doc.text(`Sifat     : Biasa`);
        doc.text(`Lampiran  : 1 (satu) berkas`);
        doc.text(`Hal       : Penyerahan Arsip Statis`);
        doc.moveDown(2);

        // Recipient
        doc.text('Yth. Kepala Arsip Nasional Republik Indonesia');
        doc.text('di Jakarta');
        doc.moveDown(2);

        // Body
        doc.text('Sesuai dengan Jadwal Retensi Arsip (JRA) dan berdasarkan penilaian kembali arsip, dengan ini kami sampaikan bahwa arsip-arsip sebagaimana terlampir telah dinilai sebagai arsip statis dan telah habis masa retensinya di unit kerja kami.', { align: 'justify' });
        doc.moveDown();

        doc.text('Sehubungan dengan hal tersebut, kami mengajukan permohonan untuk menyerahkan arsip statis tersebut kepada Arsip Nasional Republik Indonesia (ANRI) sesuai dengan ketentuan peraturan perundang-undangan yang berlaku.', { align: 'justify' });
        doc.moveDown();

        doc.text('Demikian surat permohonan ini kami sampaikan, atas perhatian dan kerjasamanya diucapkan terima kasih.', { align: 'justify' });
        doc.moveDown(3);

        // Signature
        const sigX = 350;
        doc.text('Pimpinan Unit Kerja,', sigX, doc.y);
        doc.moveDown(4);
        doc.text('____________________', sigX, doc.y);
        doc.text('NIP. ________________', sigX, doc.y);

        doc.end();
        return new Promise(resolve => {
            doc.on('end', () => resolve(Buffer.concat(buffers)));
        });
    }

    // ==================== SHARED HELPERS ====================

    /**
     * Add KOP SURAT header
     */
    private addKopSurat(doc: PDFKit.PDFDocument) {
        doc.fontSize(this.FONT_SIZE.subtitle).font('Helvetica-Bold')
            .text('KEMENTERIAN AGRARIA DAN TATA RUANG/', { align: 'center' })
            .text('BADAN PERTANAHAN NASIONAL', { align: 'center' });
        doc.moveDown(0.5);
    }

    /**
     * Format tanggal from batch data
     */
    private formatTanggal(batch: any): string {
        return batch.tanggalPelaksanaan || batch.tanggalPersetujuan ||
            new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    }

    /**
     * Draw standard items table for daftar usul templates
     */
    private drawItemTable(doc: PDFKit.PDFDocument, cols: Array<{ header: string; width: number }>, items: any[], batch: any) {
        let x = this.MARGIN.left;
        const startY = doc.y;

        doc.fontSize(this.FONT_SIZE.small).font('Helvetica-Bold');
        cols.forEach(col => {
            doc.rect(x, startY, col.width, 20).stroke();
            doc.text(col.header, x + 2, startY + 3, { width: col.width - 4, align: 'center' });
            x += col.width;
        });

        doc.font('Helvetica').fontSize(this.FONT_SIZE.small);
        let y = startY + 20;

        for (const item of items) {
            if (y > 500) { doc.addPage(); y = this.MARGIN.top; }

            x = this.MARGIN.left;
            const rowHeight = 18;
            const a = item.arsip;
            const values = [
                String(item.nomorUrut || '-'),
                a?.kodeKlasifikasi || '-',
                a?.uraianBerkas || a?.uraianItem || '-',
                a?.kurunWaktu || '-',
                String(a?.jumlah || 1),
                a?.tingkatPerkembangan || '-',
                a?.jraKode || '-',
                a?.retensiAktif || '-',
                a?.retensiInaktif || '-',
                item.keterangan || a?.keterangan || '-',
            ];

            cols.forEach((col, i) => {
                doc.rect(x, y, col.width, rowHeight).stroke();
                doc.text(values[i], x + 2, y + 3, {
                    width: col.width - 4, height: rowHeight - 4, ellipsis: true,
                });
                x += col.width;
            });
            y += rowHeight;
        }

        // Footer with total
        const footerY = y + 20;
        doc.fontSize(this.FONT_SIZE.body);
        doc.text(`Total Berkas: ${batch.totalBerkas}`, this.MARGIN.left, footerY);
    }

    /**
     * Draw standard berita acara items table (portrait layout)
     */
    private drawBeritaAcaraTable(doc: PDFKit.PDFDocument, items: any[]) {
        const cols = [
            { header: 'No', width: 25 },
            { header: 'Kode Klasifikasi', width: 80 },
            { header: 'Uraian Arsip', width: 180 },
            { header: 'Kurun Waktu', width: 70 },
            { header: 'Jumlah', width: 40 },
            { header: 'Ket.', width: 100 },
        ];

        let x = this.MARGIN.left;
        const startY = doc.y;

        doc.fontSize(this.FONT_SIZE.small).font('Helvetica-Bold');
        cols.forEach(col => {
            doc.rect(x, startY, col.width, 18).stroke();
            doc.text(col.header, x + 2, startY + 3, { width: col.width - 4, align: 'center' });
            x += col.width;
        });

        doc.font('Helvetica').fontSize(this.FONT_SIZE.small);
        let y = startY + 18;

        for (const item of items) {
            if (y > 700) { doc.addPage(); y = this.MARGIN.top; }

            x = this.MARGIN.left;
            const rowHeight = 16;
            const a = item.arsip;
            const values = [
                String(item.nomorUrut || '-'),
                a?.kodeKlasifikasi || '-',
                a?.uraianBerkas || a?.uraianItem || '-',
                a?.kurunWaktu || '-',
                String(a?.jumlah || 1),
                item.keterangan || a?.keterangan || '-',
            ];

            cols.forEach((col, i) => {
                doc.rect(x, y, col.width, rowHeight).stroke();
                doc.text(values[i], x + 2, y + 2, {
                    width: col.width - 4, height: rowHeight - 4, ellipsis: true,
                });
                x += col.width;
            });
            y += rowHeight;
        }
    }

    /**
     * Add standard signature block to document
     */
    private addSignatureBlock(doc: PDFKit.PDFDocument, startY: number, batch: any) {
        doc.fontSize(this.FONT_SIZE.body);

        // Left signature
        doc.text('Mengetahui,', this.MARGIN.left, startY);
        doc.text('Kepala Sub Bagian Tata Usaha', this.MARGIN.left, startY + 15);
        doc.text('____________________', this.MARGIN.left, startY + 70);
        doc.text('NIP. ________________', this.MARGIN.left, startY + 85);

        // Right signature
        const tanggal = this.formatTanggal(batch);
        doc.text(tanggal, 350, startY);
        doc.text('Arsiparis/Pengelola Arsip', 350, startY + 15);
        doc.text('____________________', 350, startY + 70);
        doc.text('NIP. ________________', 350, startY + 85);
    }

    // ==================== ARSIP VITAL & TERJAGA ====================

    async generateDaftarArsipVital(
        unitKerjaId: string,
        securityClassifications?: string[] | null,
    ): Promise<Buffer> {
        // Fetch data
        const { data } = await import('./arsip-vital.service').then(m => m.arsipVitalService.findAll({
            unitKerjaId,
            limit: 1000,
            securityClassifications,
        }));

        const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: this.MARGIN.left });
        const buffers: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => buffers.push(chunk));

        // Header
        this.addHeader(doc, 'DAFTAR ARSIP VITAL');
        doc.fontSize(this.FONT_SIZE.body)
            .text(`Unit Kerja: ${unitKerjaId}`) // In real app, fetch unit name
            .text(`Tanggal Cetak: ${new Date().toLocaleDateString('id-ID')}`);
        doc.moveDown();

        // Table
        const cols = [
            { header: 'No', width: 30 },
            { header: 'No. Berkas', width: 70 },
            { header: 'Kode Klas.', width: 60 },
            { header: 'Uraian Informasi', width: 170 },
            { header: 'Kurun Waktu', width: 70 },
            { header: 'Media', width: 60 },
            { header: 'Lokasi Simpan', width: 80 },
            { header: 'Ket.', width: 60 },
        ];

        let y = doc.y;
        this.drawTableHeaders(doc, cols, y, this.MARGIN.left);
        y += 20;

        doc.font('Helvetica').fontSize(this.FONT_SIZE.small);
        data.forEach((item, index) => {
            if (y > 500) { doc.addPage(); y = this.MARGIN.top; this.drawTableHeaders(doc, cols, y, this.MARGIN.left); y += 20; }
            const values = [
                String(index + 1),
                item.nomorBerkas || '-',
                item.kodeKlasifikasi || '-',
                item.uraianBerkas || '-',
                item.kurunWaktu || '-', // Need to ensure these fields exist in join
                'Kertas', // Default or fetch
                item.lokasiBackup || '-',
                item.kategoriVital || '-'
            ];
            this.drawTableRow(doc, cols, values, y, this.MARGIN.left);
            y += 18; // Row height
        });

        // Footer / Signature
        doc.moveDown(2);
        this.addSignature(doc, 'Pimpinan Unit Kearsipan', y + 30);

        doc.end();
        return new Promise(resolve => {
            doc.on('end', () => resolve(Buffer.concat(buffers)));
        });
    }

    async generateDaftarArsipTerjaga(
        unitKerjaId: string,
        securityClassifications?: string[] | null,
    ): Promise<Buffer> {
        // Fetch data
        const { data } = await import('./arsip-terjaga.service').then(m => m.arsipTerjagaService.findAll({
            unitKerjaId,
            limit: 1000,
            securityClassifications,
        }));

        const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: this.MARGIN.left });
        const buffers: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => buffers.push(chunk));

        // Header
        this.addHeader(doc, 'DAFTAR ARSIP TERJAGA');
        doc.fontSize(this.FONT_SIZE.body)
            .text(`Unit Kerja: ${unitKerjaId}`)
            .text(`Tanggal Cetak: ${new Date().toLocaleDateString('id-ID')}`);
        doc.moveDown();

        // Table
        const cols = [
            { header: 'No', width: 30 },
            { header: 'No. Berkas', width: 70 },
            { header: 'Kode Klas.', width: 60 },
            { header: 'Uraian Informasi', width: 170 },
            { header: 'Kurun Waktu', width: 70 },
            { header: 'Pencipta', width: 80 },
            { header: 'Kondisi', width: 60 },
            { header: 'Ket.', width: 60 },
        ];

        let y = doc.y;
        this.drawTableHeaders(doc, cols, y, this.MARGIN.left);
        y += 20;

        doc.font('Helvetica').fontSize(this.FONT_SIZE.small);
        data.forEach((item, index) => {
            if (y > 500) { doc.addPage(); y = this.MARGIN.top; this.drawTableHeaders(doc, cols, y, this.MARGIN.left); y += 20; }
            const values = [
                String(index + 1),
                item.nomorBerkas || '-',
                item.kodeKlasifikasi || '-',
                item.uraianBerkas || '-',
                item.kurunWaktu || '-',
                'ATR/BPN', // Default
                'Baik',
                item.kategoriTerjaga || '-'
            ];
            this.drawTableRow(doc, cols, values, y, this.MARGIN.left);
            y += 18;
        });

        doc.moveDown(2);
        this.addSignature(doc, 'Pimpinan Unit Kearsipan', y + 30);

        doc.end();
        return new Promise(resolve => {
            doc.on('end', () => resolve(Buffer.concat(buffers)));
        });
    }

    // Helpers (assuming they don't exist, I'll check file content or add them inline/private if needed, but keeping it simple)
    // Actually, I should use the existing private methods if valid, or just implement inline as above. 
    // The previous code had inline drawing. I'll stick to that style or minimal duplication.

    private addHeader(doc: PDFKit.PDFDocument, title: string) {
        doc.fontSize(this.FONT_SIZE.title).font('Helvetica-Bold').text(title, { align: 'center' });
        doc.fontSize(this.FONT_SIZE.subtitle).font('Helvetica').text('KEMENTERIAN AGRARIA DAN TATA RUANG/BADAN PERTANAHAN NASIONAL', { align: 'center' });
        doc.moveDown(0.5);
    }

    private drawTableHeaders(doc: PDFKit.PDFDocument, cols: any[], y: number, startX: number) {
        doc.fontSize(this.FONT_SIZE.small).font('Helvetica-Bold');
        let x = startX;
        cols.forEach(col => {
            doc.rect(x, y, col.width, 20).stroke();
            doc.text(col.header, x + 2, y + 5, { width: col.width - 4, align: 'center' });
            x += col.width;
        });
    }

    private drawTableRow(doc: PDFKit.PDFDocument, cols: any[], values: string[], y: number, startX: number) {
        let x = startX;
        const rowHeight = 18;
        cols.forEach((col, i) => {
            doc.rect(x, y, col.width, rowHeight).stroke();
            doc.text(values[i], x + 2, y + 4, { width: col.width - 4, height: rowHeight - 4, ellipsis: true });
            x += col.width;
        });
    }

    private addSignature(doc: PDFKit.PDFDocument, role: string, y: number) {
        const x = 500;
        doc.text(`Jakarta, ${new Date().toLocaleDateString('id-ID')}`, x, y);
        doc.text(role + ',', x, y + 15);
        doc.moveDown(4);
        doc.text('____________________', x, doc.y + 40);
    }
}

export const printTemplateService = new PrintTemplateService();
