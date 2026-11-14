/**
 * Baris tabel PDF ekspor dengan tinggi dinamis: teks dibungkus di dalam lebar
 * kolomnya dan tinggi baris mengikuti sel tertinggi, sehingga isi panjang
 * tidak dipotong dan tidak menimpa baris di bawahnya. Ukuran huruf harus
 * sudah dipasang pada dokumen sebelum tinggi dihitung.
 */
export interface TataBarisPdf {
    /** Jarak teks dari tepi kiri dan kanan sel. */
    padX: number;
    /** Jarak teks dari tepi atas dan bawah sel. */
    padY: number;
    /** Tinggi baris paling kecil. */
    minimal: number;
}

/** Lebar kolom yang dijumlahkan menjadi `total`; selisihnya masuk ke kolom `lentur`. */
export function lebarPenuh(lebar: number[], lentur: number, total: number): number[] {
    const selisih = total - lebar.reduce((jumlah, nilai) => jumlah + nilai, 0);
    return lebar.map((nilai, i) => (i === lentur ? nilai + selisih : nilai));
}

/** Tinggi satu baris: sel tertinggi ditambah ruang atas dan bawah. */
export function tinggiBarisPdf(doc: PDFKit.PDFDocument, sel: string[], lebar: number[], tata: TataBarisPdf): number {
    const tertinggi = sel.reduce((maks, teks, i) => (teks
        ? Math.max(maks, doc.heightOfString(teks, { width: lebar[i] - 2 * tata.padX }))
        : maks), 0);
    return Math.max(tata.minimal, Math.ceil(tertinggi + 2 * tata.padY));
}

/** Tulis satu baris mulai dari (x, y); sel kosong dilewati. */
export function tulisBarisPdf(doc: PDFKit.PDFDocument, sel: string[], lebar: number[], x: number, y: number, tata: TataBarisPdf): void {
    let kiri = x;
    sel.forEach((teks, i) => {
        if (teks) doc.text(teks, kiri + tata.padX, y + tata.padY, { width: lebar[i] - 2 * tata.padX, align: 'left' });
        kiri += lebar[i];
    });
}

/** Batas bawah isi halaman, tepat di atas margin bawah. */
export function batasBawahPdf(doc: PDFKit.PDFDocument): number {
    return doc.page.height - doc.page.margins.bottom;
}
