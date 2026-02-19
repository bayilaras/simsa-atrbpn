import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { suratMasukService, SuratMasukFilters } from './surat-masuk.service';
import { suratKeluarService, SuratKeluarFilters } from './surat-keluar.service';
import { arsipService, ArsipFilters } from './arsip.service';

export interface ExportOptions {
    format: 'excel' | 'pdf';
    type: 'surat-masuk' | 'surat-keluar' | 'arsip';
    formulirType?: 'formulir4' | 'formulir6'; // For arsip export
}

// ============================================
// Styling constants matching Permen ATRBPN 2/2026
// ============================================
const HEADER_FILL: ExcelJS.Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E3A5F' },
};
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
const TITLE_FONT: Partial<ExcelJS.Font> = { bold: true, size: 14, name: 'Arial' };
const SUBTITLE_FONT: Partial<ExcelJS.Font> = { bold: true, size: 10, name: 'Arial' };
const DATA_FONT: Partial<ExcelJS.Font> = { size: 9, name: 'Arial' };
const THIN_BORDER: Partial<ExcelJS.Borders> = {
    top: { style: 'thin' },
    left: { style: 'thin' },
    bottom: { style: 'thin' },
    right: { style: 'thin' },
};
const CENTER_ALIGN: Partial<ExcelJS.Alignment> = { horizontal: 'center', vertical: 'middle', wrapText: true };
const LEFT_ALIGN: Partial<ExcelJS.Alignment> = { horizontal: 'left', vertical: 'middle', wrapText: true };

export class ExportService {
    // ============== EXCEL EXPORTS ==============

    /**
     * Export Surat Masuk to Excel — format matches Google Spreadsheet structure
     * Columns: ID, No, Jenis Surat, Sifat Surat, Nomor Surat, Tanggal Surat,
     *          Perihal, Dari, Kepada, Status, Disposisi, Timestamp, Status Arsip
     */
    async generateExcelSuratMasuk(filters: SuratMasukFilters): Promise<Buffer> {
        const { data } = await suratMasukService.findAll({
            ...filters,
            page: 1,
            limit: 10000,
        });

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'SIMSA ATR/BPN';
        workbook.created = new Date();

        const worksheet = workbook.addWorksheet('Surat Masuk');

        // Title section
        worksheet.mergeCells('A1:M1');
        const titleCell = worksheet.getCell('A1');
        titleCell.value = 'DAFTAR SURAT MASUK';
        titleCell.font = TITLE_FONT;
        titleCell.alignment = CENTER_ALIGN;

        worksheet.mergeCells('A2:M2');
        const subtitleCell = worksheet.getCell('A2');
        subtitleCell.value = `Direktorat Jenderal Pengadaan Tanah dan Pengembangan Pertanahan — Tahun ${filters.tahun || 'Semua'}`;
        subtitleCell.font = { ...SUBTITLE_FONT, bold: false };
        subtitleCell.alignment = CENTER_ALIGN;

        // Header row at row 4
        const headerRow = 4;
        const headers = [
            'ID', 'No', 'Jenis Surat', 'Sifat Surat', 'Nomor Surat',
            'Tanggal Surat', 'Perihal', 'Dari', 'Kepada', 'Status',
            'Disposisi', 'Timestamp', 'Status Arsip'
        ];
        const colWidths = [20, 8, 18, 14, 28, 15, 40, 25, 25, 18, 25, 18, 14];

        headers.forEach((header, i) => {
            const cell = worksheet.getCell(headerRow, i + 1);
            cell.value = header;
            cell.font = HEADER_FONT;
            cell.fill = HEADER_FILL;
            cell.alignment = CENTER_ALIGN;
            cell.border = THIN_BORDER;
        });

        // Set column widths
        colWidths.forEach((width, i) => {
            worksheet.getColumn(i + 1).width = width;
        });

        worksheet.getRow(headerRow).height = 25;

        // Data rows
        data.forEach((item, index) => {
            const rowNum = headerRow + 1 + index;
            const rowData = [
                item.id || '',
                index + 1,
                item.jenisSurat || '',
                item.sifatSurat || '',
                item.nomorSurat || '',
                item.tanggalSurat || '',
                item.perihal || '',
                item.dari || '',
                item.kepada || '',
                item.status === 'sudah_dibalas' ? 'Sudah Dibalas' : 'Belum Dibalas',
                Array.isArray(item.disposisi) ? item.disposisi.join(', ') : (item.disposisi || ''),
                item.createdAt ? new Date(item.createdAt).toLocaleString('id-ID') : '',
                item.isArchived ? 'Diarsipkan' : 'Belum',
            ];

            rowData.forEach((val, i) => {
                const cell = worksheet.getCell(rowNum, i + 1);
                cell.value = val;
                cell.font = DATA_FONT;
                cell.border = THIN_BORDER;
                cell.alignment = i === 6 || i === 7 || i === 8 || i === 10 ? LEFT_ALIGN : CENTER_ALIGN;
            });
        });

        const buffer = await workbook.xlsx.writeBuffer();
        return Buffer.from(buffer);
    }

    /**
     * Export Surat Keluar to Excel — format matches Google Spreadsheet structure
     * Columns: ID, No Urut, Jenis Surat, Nomor Surat, Tanggal Surat,
     *          Perihal, Tujuan, Link Dokumen, Tanggal Input, Balasan Untuk,
     *          Klasifikasi Arsip, Klasifikasi Kode, Klasifikasi Jenis
     */
    async generateExcelSuratKeluar(filters: SuratKeluarFilters): Promise<Buffer> {
        const { data } = await suratKeluarService.findAll({
            ...filters,
            page: 1,
            limit: 10000,
        });

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'SIMSA ATR/BPN';
        workbook.created = new Date();

        const worksheet = workbook.addWorksheet('Surat Keluar');

        // Title section
        worksheet.mergeCells('A1:M1');
        const titleCell = worksheet.getCell('A1');
        titleCell.value = 'DAFTAR SURAT KELUAR';
        titleCell.font = TITLE_FONT;
        titleCell.alignment = CENTER_ALIGN;

        worksheet.mergeCells('A2:M2');
        const subtitleCell = worksheet.getCell('A2');
        subtitleCell.value = `Direktorat Jenderal Pengadaan Tanah dan Pengembangan Pertanahan — Tahun ${filters.tahun || 'Semua'}`;
        subtitleCell.font = { ...SUBTITLE_FONT, bold: false };
        subtitleCell.alignment = CENTER_ALIGN;

        // Header row at row 4
        const headerRow = 4;
        const headers = [
            'ID', 'No Urut', 'Jenis Surat', 'Nomor Surat', 'Tanggal Surat',
            'Perihal', 'Tujuan', 'Link Dokumen', 'Tanggal Input', 'Balasan Untuk',
            'Klasifikasi Arsip', 'Klasifikasi Kode', 'Klasifikasi Jenis'
        ];
        const colWidths = [20, 10, 18, 28, 15, 40, 25, 30, 18, 20, 28, 15, 15];

        headers.forEach((header, i) => {
            const cell = worksheet.getCell(headerRow, i + 1);
            cell.value = header;
            cell.font = HEADER_FONT;
            cell.fill = HEADER_FILL;
            cell.alignment = CENTER_ALIGN;
            cell.border = THIN_BORDER;
        });

        colWidths.forEach((width, i) => {
            worksheet.getColumn(i + 1).width = width;
        });
        worksheet.getRow(headerRow).height = 25;

        // Data rows
        data.forEach((item, index) => {
            const rowNum = headerRow + 1 + index;
            // Determine klasifikasi jenis
            let klasifikasiJenis = '';
            if (item.klasifikasiFasilitatif) klasifikasiJenis = 'fasilitatif';
            if (item.klasifikasiSubstantif) klasifikasiJenis = 'substantif';

            const rowData = [
                item.id || '',
                item.noUrut,
                item.naskahDinas || '',
                item.nomorSurat || '',
                item.tanggalSurat || '',
                item.perihal || '',
                item.kepada || '',
                item.linkDokumen || '',
                item.createdAt ? new Date(item.createdAt).toLocaleString('id-ID') : '',
                item.balasanUntuk || '',
                item.klasifikasiFasilitatif || item.klasifikasiSubstantif || '',
                item.klasifikasiFasilitatifKode || item.klasifikasiSubstantifKode || '',
                klasifikasiJenis,
            ];

            rowData.forEach((val, i) => {
                const cell = worksheet.getCell(rowNum, i + 1);
                cell.value = val;
                cell.font = DATA_FONT;
                cell.border = THIN_BORDER;
                cell.alignment = i === 5 || i === 6 || i === 7 || i === 10 ? LEFT_ALIGN : CENTER_ALIGN;
            });
        });

        const buffer = await workbook.xlsx.writeBuffer();
        return Buffer.from(buffer);
    }

    /**
     * Export Arsip to Excel — Formulir 4 (Daftar Arsip Aktif) per Permen ATRBPN 2/2026
     * 13 columns with multi-level header: No.Berkas, Kode Klasifikasi, Uraian Informasi Berkas,
     * Kurun Waktu Berkas, Jumlah Berkas, Item Arsip (No.Item, Uraian Informasi Arsip, Tanggal, Jml),
     * Tingkat Perkembangan, Lokasi Simpan, Tingkat Klasifikasi Keamanan & Akses, Ket.
     */
    async generateExcelArsip(filters: ArsipFilters, formulirType: string = 'formulir4'): Promise<Buffer> {
        const { data } = await arsipService.findAll({
            ...filters,
            page: 1,
            limit: 10000,
        });

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'SIMSA ATR/BPN';
        workbook.created = new Date();

        if (formulirType === 'formulir6') {
            return this.generateExcelArsipFormulir6(workbook, data, filters);
        }

        // Default: Formulir 4 - Daftar Arsip Aktif
        return this.generateExcelArsipFormulir4(workbook, data, filters);
    }

    /**
     * Formulir 4 — DAFTAR ARSIP AKTIF
     * Permen ATRBPN 2 Tahun 2026 Kearsipan
     */
    private async generateExcelArsipFormulir4(workbook: ExcelJS.Workbook, data: any[], filters: ArsipFilters): Promise<Buffer> {
        const worksheet = workbook.addWorksheet('Formulir 4 - Arsip Aktif', {
            pageSetup: { orientation: 'landscape', paperSize: 9 /* A4 */ },
        });

        // Title
        worksheet.mergeCells('A1:M1');
        const titleCell = worksheet.getCell('A1');
        titleCell.value = 'DAFTAR ARSIP AKTIF';
        titleCell.font = TITLE_FONT;
        titleCell.alignment = CENTER_ALIGN;

        // Unit Pengolah header
        worksheet.mergeCells('A3:B3');
        worksheet.getCell('A3').value = 'Unit Pengolah';
        worksheet.getCell('A3').font = SUBTITLE_FONT;
        worksheet.mergeCells('C3:F3');
        worksheet.getCell('C3').value = ': Direktorat Jenderal Pengadaan Tanah dan Pengembangan Pertanahan';
        worksheet.getCell('C3').font = { ...DATA_FONT, size: 10 };

        // Multi-level header — Row 5-6 (merged)
        const hRow1 = 5;
        const hRow2 = 6;

        // Columns that span 2 rows (rowSpan=2)
        const spanCols = [
            { col: 1, label: 'No.\nBerkas', width: 8 },
            { col: 2, label: 'Kode\nKlasifikasi', width: 14 },
            { col: 3, label: 'Uraian Informasi\nBerkas', width: 30 },
            { col: 4, label: 'Kurun Waktu\nBerkas', width: 14 },
            { col: 5, label: 'Jumlah\nBerkas', width: 10 },
        ];

        spanCols.forEach(({ col, label, width }) => {
            worksheet.mergeCells(hRow1, col, hRow2, col);
            const cell = worksheet.getCell(hRow1, col);
            cell.value = label;
            cell.font = HEADER_FONT;
            cell.fill = HEADER_FILL;
            cell.alignment = CENTER_ALIGN;
            cell.border = THIN_BORDER;
            worksheet.getColumn(col).width = width;
        });

        // "Item Arsip" merged header spanning cols 6-9 in row 5
        worksheet.mergeCells(hRow1, 6, hRow1, 9);
        const itemArsipCell = worksheet.getCell(hRow1, 6);
        itemArsipCell.value = 'Item Arsip';
        itemArsipCell.font = HEADER_FONT;
        itemArsipCell.fill = HEADER_FILL;
        itemArsipCell.alignment = CENTER_ALIGN;
        itemArsipCell.border = THIN_BORDER;

        // Sub-headers for Item Arsip in row 6
        const itemSubHeaders = [
            { col: 6, label: 'No.\nItem', width: 8 },
            { col: 7, label: 'Uraian Informasi\nArsip', width: 30 },
            { col: 8, label: 'Tanggal', width: 14 },
            { col: 9, label: 'Jml', width: 8 },
        ];

        itemSubHeaders.forEach(({ col, label, width }) => {
            const cell = worksheet.getCell(hRow2, col);
            cell.value = label;
            cell.font = HEADER_FONT;
            cell.fill = HEADER_FILL;
            cell.alignment = CENTER_ALIGN;
            cell.border = THIN_BORDER;
            worksheet.getColumn(col).width = width;
        });

        // Remaining columns that span 2 rows
        const remainingCols = [
            { col: 10, label: 'Tingkat\nPerkembangan', width: 14 },
            { col: 11, label: 'Lokasi\nSimpan', width: 16 },
            { col: 12, label: 'Tingkat Klasifikasi\nKeamanan & Akses', width: 18 },
            { col: 13, label: 'Ket.', width: 14 },
        ];

        remainingCols.forEach(({ col, label, width }) => {
            worksheet.mergeCells(hRow1, col, hRow2, col);
            const cell = worksheet.getCell(hRow1, col);
            cell.value = label;
            cell.font = HEADER_FONT;
            cell.fill = HEADER_FILL;
            cell.alignment = CENTER_ALIGN;
            cell.border = THIN_BORDER;
            worksheet.getColumn(col).width = width;
        });

        // Column numbering row (1)-(13)
        const numRow = hRow2 + 1;
        for (let i = 1; i <= 13; i++) {
            const cell = worksheet.getCell(numRow, i);
            cell.value = `(${i})`;
            cell.font = { ...DATA_FONT, italic: true, size: 8 };
            cell.alignment = CENTER_ALIGN;
            cell.border = THIN_BORDER;
        }

        // Set row heights
        worksheet.getRow(hRow1).height = 30;
        worksheet.getRow(hRow2).height = 30;

        // Data rows
        const startRow = numRow + 1;
        data.forEach((item, index) => {
            const rowNum = startRow + index;
            const lokasi = [item.lokasiFc, item.lokasiLaci, item.lokasiFolder].filter(Boolean).join('/');
            const rowData = [
                item.nomorBerkas || String(index + 1),
                item.kodeKlasifikasi || '',
                item.uraianBerkas || '',
                item.kurunWaktu || String(item.tahun),
                item.jumlah || 1,
                item.nomorItem || '',
                item.uraianItem || '',
                item.tanggalArsip || '',
                item.jumlah || 1,
                item.tingkatPerkembangan || '',
                lokasi || '',
                item.klasifikasiKeamanan || '',
                item.keterangan || '',
            ];

            rowData.forEach((val, i) => {
                const cell = worksheet.getCell(rowNum, i + 1);
                cell.value = val;
                cell.font = DATA_FONT;
                cell.border = THIN_BORDER;
                cell.alignment = i === 2 || i === 6 ? LEFT_ALIGN : CENTER_ALIGN;
            });
        });

        // Signature block
        const sigRow = startRow + data.length + 2;
        worksheet.mergeCells(sigRow, 9, sigRow, 13);
        worksheet.getCell(sigRow, 9).value = '........................................, ........................................';
        worksheet.getCell(sigRow, 9).alignment = CENTER_ALIGN;

        worksheet.mergeCells(sigRow + 1, 9, sigRow + 1, 13);
        worksheet.getCell(sigRow + 1, 9).value = 'Pimpinan Unit Pengolah';
        worksheet.getCell(sigRow + 1, 9).font = SUBTITLE_FONT;
        worksheet.getCell(sigRow + 1, 9).alignment = CENTER_ALIGN;

        worksheet.mergeCells(sigRow + 4, 9, sigRow + 4, 13);
        worksheet.getCell(sigRow + 4, 9).value = '(Nama Lengkap)';
        worksheet.getCell(sigRow + 4, 9).alignment = CENTER_ALIGN;
        worksheet.getCell(sigRow + 4, 9).font = { ...DATA_FONT, underline: true };

        worksheet.mergeCells(sigRow + 5, 9, sigRow + 5, 13);
        worksheet.getCell(sigRow + 5, 9).value = 'NIP ....................................';
        worksheet.getCell(sigRow + 5, 9).alignment = CENTER_ALIGN;

        // Formulir label
        const labelRow = sigRow + 7;
        worksheet.mergeCells(labelRow, 10, labelRow, 13);
        worksheet.getCell(labelRow, 10).value = 'Formulir 4. Daftar Arsip Aktif';
        worksheet.getCell(labelRow, 10).font = { ...DATA_FONT, italic: true, size: 8 };
        worksheet.getCell(labelRow, 10).alignment = { horizontal: 'right' };

        const buffer = await workbook.xlsx.writeBuffer();
        return Buffer.from(buffer);
    }

    /**
     * Formulir 6 — DAFTAR ARSIP INAKTIF (KERTAS)
     * Permen ATRBPN 2 Tahun 2026 Kearsipan
     * Columns: No, Kode Klasifikasi, Uraian Informasi Arsip/Berkas, Kurun Waktu,
     *          Tingkat Perkembangan, Jumlah, Lokasi Simpan, Keamanan & Akses,
     *          Jangka Simpan & Nasib Akhir, Kategori Arsip, Ket.
     */
    private async generateExcelArsipFormulir6(workbook: ExcelJS.Workbook, data: any[], filters: ArsipFilters): Promise<Buffer> {
        const worksheet = workbook.addWorksheet('Formulir 6 - Arsip Inaktif', {
            pageSetup: { orientation: 'landscape', paperSize: 9 },
        });

        // Title
        worksheet.mergeCells('A1:K1');
        const titleCell = worksheet.getCell('A1');
        titleCell.value = 'DAFTAR ARSIP INAKTIF (KERTAS)';
        titleCell.font = TITLE_FONT;
        titleCell.alignment = CENTER_ALIGN;

        // Pencipta Arsip
        worksheet.mergeCells('A3:B3');
        worksheet.getCell('A3').value = 'Pencipta Arsip';
        worksheet.getCell('A3').font = SUBTITLE_FONT;
        worksheet.mergeCells('C3:F3');
        worksheet.getCell('C3').value = ': Kementerian ATR/BPN';
        worksheet.getCell('C3').font = { ...DATA_FONT, size: 10 };

        // Unit Pengolah
        worksheet.mergeCells('A4:B4');
        worksheet.getCell('A4').value = 'Unit Pengolah';
        worksheet.getCell('A4').font = SUBTITLE_FONT;
        worksheet.mergeCells('C4:F4');
        worksheet.getCell('C4').value = ': Direktorat Jenderal Pengadaan Tanah dan Pengembangan Pertanahan';
        worksheet.getCell('C4').font = { ...DATA_FONT, size: 10 };

        // Header row at row 6
        const hRow = 6;
        const headers = [
            'No', 'Kode\nKlasifikasi', 'Uraian Informasi\nArsip/Berkas', 'Kurun\nWaktu',
            'Tingkat\nPerkembangan', 'Jumlah', 'Lokasi Simpan\n(Rak/Boks/Folder)',
            'Keamanan\n& Akses', 'Jangka Simpan\n& Nasib Akhir', 'Kategori\nArsip', 'Ket.'
        ];
        const colWidths = [6, 14, 35, 12, 14, 8, 20, 14, 18, 14, 14];

        headers.forEach((header, i) => {
            const cell = worksheet.getCell(hRow, i + 1);
            cell.value = header;
            cell.font = HEADER_FONT;
            cell.fill = HEADER_FILL;
            cell.alignment = CENTER_ALIGN;
            cell.border = THIN_BORDER;
        });

        colWidths.forEach((w, i) => {
            worksheet.getColumn(i + 1).width = w;
        });
        worksheet.getRow(hRow).height = 35;

        // Column numbering
        const numRow = hRow + 1;
        for (let i = 1; i <= 11; i++) {
            const cell = worksheet.getCell(numRow, i);
            cell.value = `(${i})`;
            cell.font = { ...DATA_FONT, italic: true, size: 8 };
            cell.alignment = CENTER_ALIGN;
            cell.border = THIN_BORDER;
        }

        // Data rows
        const startRow = numRow + 1;
        data.forEach((item, index) => {
            const rowNum = startRow + index;
            const lokasi = [item.lokasiFc, item.lokasiLaci, item.lokasiFolder].filter(Boolean).join('/');
            const jangkaSimpan = [
                item.masaSimpanAktif ? `Aktif: ${item.masaSimpanAktif}` : '',
                item.masaSimpanInaktif ? `Inaktif: ${item.masaSimpanInaktif}` : '',
                item.hasilAkhir ? `Nasib: ${item.hasilAkhir}` : '',
            ].filter(Boolean).join('\n');

            const kategoriArsip = item.jenisArsip === 'masuk' ? 'Surat Masuk' : 'Surat Keluar';

            const rowData = [
                index + 1,
                item.kodeKlasifikasi || '',
                item.uraianBerkas || item.uraianItem || '',
                item.kurunWaktu || String(item.tahun),
                item.tingkatPerkembangan || '',
                item.jumlah || 1,
                lokasi || '',
                item.klasifikasiKeamanan || '',
                jangkaSimpan,
                kategoriArsip,
                item.keterangan || '',
            ];

            rowData.forEach((val, i) => {
                const cell = worksheet.getCell(rowNum, i + 1);
                cell.value = val;
                cell.font = DATA_FONT;
                cell.border = THIN_BORDER;
                cell.alignment = i === 2 || i === 8 ? LEFT_ALIGN : CENTER_ALIGN;
            });
        });

        // Signature block
        const sigRow = startRow + data.length + 2;

        // Left signature — Pimpinan Unit Kearsipan
        worksheet.mergeCells(sigRow, 1, sigRow, 5);
        worksheet.getCell(sigRow, 1).value = 'Mengetahui,\nPimpinan Unit Kearsipan';
        worksheet.getCell(sigRow, 1).font = DATA_FONT;
        worksheet.getCell(sigRow, 1).alignment = CENTER_ALIGN;

        worksheet.mergeCells(sigRow + 4, 1, sigRow + 4, 5);
        worksheet.getCell(sigRow + 4, 1).value = '(Nama Lengkap)';
        worksheet.getCell(sigRow + 4, 1).font = { ...DATA_FONT, underline: true };
        worksheet.getCell(sigRow + 4, 1).alignment = CENTER_ALIGN;

        worksheet.mergeCells(sigRow + 5, 1, sigRow + 5, 5);
        worksheet.getCell(sigRow + 5, 1).value = 'NIP ....................................';
        worksheet.getCell(sigRow + 5, 1).alignment = CENTER_ALIGN;

        // Right signature — Pimpinan Unit Pengolah
        worksheet.mergeCells(sigRow, 7, sigRow, 11);
        worksheet.getCell(sigRow, 7).value = '........................................, ........................................\nPimpinan Unit Pengolah';
        worksheet.getCell(sigRow, 7).font = DATA_FONT;
        worksheet.getCell(sigRow, 7).alignment = CENTER_ALIGN;

        worksheet.mergeCells(sigRow + 4, 7, sigRow + 4, 11);
        worksheet.getCell(sigRow + 4, 7).value = '(Nama Lengkap)';
        worksheet.getCell(sigRow + 4, 7).font = { ...DATA_FONT, underline: true };
        worksheet.getCell(sigRow + 4, 7).alignment = CENTER_ALIGN;

        worksheet.mergeCells(sigRow + 5, 7, sigRow + 5, 11);
        worksheet.getCell(sigRow + 5, 7).value = 'NIP ....................................';
        worksheet.getCell(sigRow + 5, 7).alignment = CENTER_ALIGN;

        // Formulir label
        const labelRow = sigRow + 7;
        worksheet.mergeCells(labelRow, 8, labelRow, 11);
        worksheet.getCell(labelRow, 8).value = 'Formulir 6. Daftar Arsip Inaktif (Kertas)';
        worksheet.getCell(labelRow, 8).font = { ...DATA_FONT, italic: true, size: 8 };
        worksheet.getCell(labelRow, 8).alignment = { horizontal: 'right' };

        const buffer = await workbook.xlsx.writeBuffer();
        return Buffer.from(buffer);
    }

    // ============== PDF EXPORTS ==============

    async generatePdfSuratMasuk(filters: SuratMasukFilters): Promise<Buffer> {
        const { data } = await suratMasukService.findAll({
            ...filters,
            page: 1,
            limit: 10000,
        });

        return new Promise((resolve, reject) => {
            const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
            const chunks: Buffer[] = [];

            doc.on('data', (chunk) => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            // Header
            doc.fontSize(16).font('Helvetica-Bold').text('DAFTAR SURAT MASUK', { align: 'center' });
            doc.fontSize(10).font('Helvetica').text('Direktorat Jenderal Pengadaan Tanah dan Pengembangan Pertanahan', { align: 'center' });
            doc.fontSize(9).text(`Tahun: ${filters.tahun || 'Semua'} | Dicetak: ${new Date().toLocaleDateString('id-ID')}`, { align: 'center' });
            doc.moveDown(1.5);

            // Table
            const tableTop = doc.y;
            const colWidths = [25, 40, 100, 80, 200, 90, 90, 90];
            const headers = ['No', 'No.Urut', 'Nomor Surat', 'Tanggal', 'Perihal', 'Dari', 'Kepada', 'Status'];

            doc.rect(30, tableTop - 5, 782, 20).fill('#1E3A5F');
            let xPos = 30;
            doc.font('Helvetica-Bold').fontSize(8).fillColor('white');
            headers.forEach((header, i) => {
                doc.text(header, xPos + 2, tableTop, { width: colWidths[i] - 4, align: 'left' });
                xPos += colWidths[i];
            });

            let yPos = tableTop + 20;
            doc.font('Helvetica').fontSize(7).fillColor('black');

            data.forEach((item, index) => {
                if (yPos > 520) {
                    doc.addPage();
                    yPos = 30;
                }
                if (index % 2 === 0) {
                    doc.rect(30, yPos - 3, 782, 15).fill('#F5F5F5');
                }

                xPos = 30;
                const rowData = [
                    String(index + 1),
                    String(item.noUrut),
                    item.nomorSurat || '',
                    item.tanggalSurat || '',
                    (item.perihal || '').substring(0, 50),
                    (item.dari || '').substring(0, 20),
                    (item.kepada || '').substring(0, 20),
                    item.status === 'sudah_dibalas' ? 'Dibalas' : 'Belum',
                ];

                doc.fillColor('black');
                rowData.forEach((text, i) => {
                    doc.text(text, xPos + 2, yPos, { width: colWidths[i] - 4, align: 'left' });
                    xPos += colWidths[i];
                });
                yPos += 15;
            });

            doc.fontSize(8).text(`Total: ${data.length} surat`, 30, yPos + 20);
            doc.end();
        });
    }

    async generatePdfSuratKeluar(filters: SuratKeluarFilters): Promise<Buffer> {
        const { data } = await suratKeluarService.findAll({
            ...filters,
            page: 1,
            limit: 10000,
        });

        return new Promise((resolve, reject) => {
            const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
            const chunks: Buffer[] = [];

            doc.on('data', (chunk) => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            doc.fontSize(16).font('Helvetica-Bold').text('DAFTAR SURAT KELUAR', { align: 'center' });
            doc.fontSize(10).font('Helvetica').text('Direktorat Jenderal Pengadaan Tanah dan Pengembangan Pertanahan', { align: 'center' });
            doc.fontSize(9).text(`Tahun: ${filters.tahun || 'Semua'} | Dicetak: ${new Date().toLocaleDateString('id-ID')}`, { align: 'center' });
            doc.moveDown(1.5);

            const tableTop = doc.y;
            const colWidths = [25, 40, 110, 80, 90, 220, 100, 100];
            const headers = ['No', 'No.Urut', 'Nomor Surat', 'Tanggal', 'Naskah Dinas', 'Perihal', 'Kepada', 'Klasifikasi'];

            doc.rect(30, tableTop - 5, 782, 20).fill('#1E3A5F');
            let xPos = 30;
            doc.font('Helvetica-Bold').fontSize(8).fillColor('white');
            headers.forEach((header, i) => {
                doc.text(header, xPos + 2, tableTop, { width: colWidths[i] - 4, align: 'left' });
                xPos += colWidths[i];
            });

            let yPos = tableTop + 20;
            doc.font('Helvetica').fontSize(7).fillColor('black');

            data.forEach((item, index) => {
                if (yPos > 520) {
                    doc.addPage();
                    yPos = 30;
                }
                if (index % 2 === 0) {
                    doc.rect(30, yPos - 3, 782, 15).fill('#F5F5F5');
                }

                xPos = 30;
                const rowData = [
                    String(index + 1),
                    String(item.noUrut),
                    item.nomorSurat || '',
                    item.tanggalSurat || '',
                    (item.naskahDinas || '').substring(0, 18),
                    (item.perihal || '').substring(0, 55),
                    (item.kepada || '').substring(0, 22),
                    (item.klasifikasiFasilitatif || '').substring(0, 22),
                ];

                doc.fillColor('black');
                rowData.forEach((text, i) => {
                    doc.text(text, xPos + 2, yPos, { width: colWidths[i] - 4, align: 'left' });
                    xPos += colWidths[i];
                });
                yPos += 15;
            });

            doc.fontSize(8).text(`Total: ${data.length} surat`, 30, yPos + 20);
            doc.end();
        });
    }

    /**
     * Export Arsip to PDF — Formulir 4 or 6 format
     */
    async generatePdfArsip(filters: ArsipFilters, formulirType: string = 'formulir4'): Promise<Buffer> {
        const { data } = await arsipService.findAll({
            ...filters,
            page: 1,
            limit: 10000,
        });

        return new Promise((resolve, reject) => {
            const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
            const chunks: Buffer[] = [];

            doc.on('data', (chunk) => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            if (formulirType === 'formulir6') {
                // Formulir 6 – Daftar Arsip Inaktif (Kertas)
                doc.fontSize(16).font('Helvetica-Bold').text('DAFTAR ARSIP INAKTIF (KERTAS)', { align: 'center' });
                doc.moveDown(0.5);
                doc.fontSize(10).font('Helvetica').text(`Pencipta Arsip      : Kementerian ATR/BPN`, 30);
                doc.text(`Unit Pengolah        : Direktorat Jenderal Pengadaan Tanah dan Pengembangan Pertanahan`, 30);
            } else {
                // Formulir 4 – Daftar Arsip Aktif
                doc.fontSize(16).font('Helvetica-Bold').text('DAFTAR ARSIP AKTIF', { align: 'center' });
                doc.moveDown(0.5);
                doc.fontSize(10).font('Helvetica').text(`Unit Pengolah : Direktorat Jenderal Pengadaan Tanah dan Pengembangan Pertanahan`, 30);
            }

            doc.fontSize(9).text(`Dicetak: ${new Date().toLocaleDateString('id-ID')}`, { align: 'right' });
            doc.moveDown(1);

            const tableTop = doc.y;

            if (formulirType === 'formulir6') {
                // Formulir 6 columns: No, Kode Klas, Uraian, Kurun Waktu, Tk.Perkembangan, Jumlah, Lokasi, Keamanan, Jangka Simpan, Kategori, Ket
                const colWidths = [20, 50, 180, 40, 55, 30, 70, 55, 80, 50, 70];
                const headers = ['No', 'Kode\nKlas.', 'Uraian Informasi Arsip/Berkas', 'Kurun\nWaktu', 'Tk.\nPrkbg.', 'Jml', 'Lokasi Simpan', 'Keamanan\n& Akses', 'Jangka Simpan\n& Nasib Akhir', 'Kategori\nArsip', 'Ket.'];

                doc.rect(30, tableTop - 5, 782, 25).fill('#1E3A5F');
                let xPos = 30;
                doc.font('Helvetica-Bold').fontSize(7).fillColor('white');
                headers.forEach((header, i) => {
                    doc.text(header, xPos + 2, tableTop, { width: colWidths[i] - 4, align: 'center' });
                    xPos += colWidths[i];
                });

                let yPos = tableTop + 28;
                doc.font('Helvetica').fontSize(6).fillColor('black');

                data.forEach((item, index) => {
                    if (yPos > 520) {
                        doc.addPage();
                        yPos = 30;
                    }
                    if (index % 2 === 0) {
                        doc.rect(30, yPos - 3, 782, 15).fill('#F5F5F5');
                    }

                    const lokasi = [item.lokasiFc, item.lokasiLaci, item.lokasiFolder].filter(Boolean).join('/');
                    const jangkaSimpan = [
                        item.masaSimpanAktif ? `A:${item.masaSimpanAktif}` : '',
                        item.hasilAkhir || '',
                    ].filter(Boolean).join(' / ');

                    xPos = 30;
                    const rowData = [
                        String(index + 1),
                        (item.kodeKlasifikasi || '').substring(0, 10),
                        (item.uraianBerkas || item.uraianItem || '').substring(0, 45),
                        item.kurunWaktu || String(item.tahun),
                        (item.tingkatPerkembangan || '').substring(0, 12),
                        String(item.jumlah || 1),
                        lokasi.substring(0, 15),
                        (item.klasifikasiKeamanan || '').substring(0, 12),
                        jangkaSimpan.substring(0, 20),
                        item.jenisArsip === 'masuk' ? 'SM' : 'SK',
                        (item.keterangan || '').substring(0, 15),
                    ];

                    doc.fillColor('black');
                    rowData.forEach((text, i) => {
                        doc.text(text, xPos + 2, yPos, { width: colWidths[i] - 4, align: 'left' });
                        xPos += colWidths[i];
                    });
                    yPos += 15;
                });

                doc.fontSize(8).text(`Total: ${data.length} arsip`, 30, yPos + 20);
                doc.fontSize(7).text('Formulir 6. Daftar Arsip Inaktif (Kertas)', 600, yPos + 35, { align: 'right' });
            } else {
                // Formulir 4 columns
                const colWidths = [20, 45, 145, 40, 30, 25, 145, 40, 25, 50, 55, 55, 55];
                const headers = ['No.\nBrks', 'Kode\nKlas.', 'Uraian Info.\nBerkas', 'Kurun\nWktu', 'Jml\nBrks', 'No.\nItem', 'Uraian Info.\nArsip', 'Tgl', 'Jml', 'Tk.\nPrkbg.', 'Lokasi\nSimpan', 'Keamanan\n& Akses', 'Ket.'];

                doc.rect(30, tableTop - 5, 782, 25).fill('#1E3A5F');
                let xPos = 30;
                doc.font('Helvetica-Bold').fontSize(6).fillColor('white');
                headers.forEach((header, i) => {
                    doc.text(header, xPos + 1, tableTop, { width: colWidths[i] - 2, align: 'center' });
                    xPos += colWidths[i];
                });

                let yPos = tableTop + 28;
                doc.font('Helvetica').fontSize(6).fillColor('black');

                data.forEach((item, index) => {
                    if (yPos > 520) {
                        doc.addPage();
                        yPos = 30;
                    }
                    if (index % 2 === 0) {
                        doc.rect(30, yPos - 3, 782, 15).fill('#F5F5F5');
                    }

                    const lokasi = [item.lokasiFc, item.lokasiLaci, item.lokasiFolder].filter(Boolean).join('/');

                    xPos = 30;
                    const rowData = [
                        item.nomorBerkas || String(index + 1),
                        (item.kodeKlasifikasi || '').substring(0, 10),
                        (item.uraianBerkas || '').substring(0, 35),
                        item.kurunWaktu || String(item.tahun),
                        String(item.jumlah || 1),
                        (item.nomorItem || '').substring(0, 5),
                        (item.uraianItem || '').substring(0, 35),
                        item.tanggalArsip || '',
                        String(item.jumlah || 1),
                        (item.tingkatPerkembangan || '').substring(0, 10),
                        lokasi.substring(0, 12),
                        (item.klasifikasiKeamanan || '').substring(0, 12),
                        (item.keterangan || '').substring(0, 12),
                    ];

                    doc.fillColor('black');
                    rowData.forEach((text, i) => {
                        doc.text(text, xPos + 1, yPos, { width: colWidths[i] - 2, align: 'left' });
                        xPos += colWidths[i];
                    });
                    yPos += 15;
                });

                doc.fontSize(8).text(`Total: ${data.length} arsip`, 30, yPos + 20);
                doc.fontSize(7).text('Formulir 4. Daftar Arsip Aktif', 600, yPos + 35, { align: 'right' });
            }

            doc.end();
        });
    }
}

export const exportService = new ExportService();
