/**
 * Baris tabel PDF ekspor dengan tinggi dinamis: teks dibungkus di dalam lebar
 * kolomnya dan tinggi baris mengikuti sel tertinggi, sehingga isi panjang
 * tidak menimpa baris di bawahnya. Satu baris paling tinggi satu halaman isi;
 * sel yang lebih panjang dipotong dengan "…" dan PDF diberi catatan
 * CATATAN_TEKS_DIPOTONG (versi Excel tetap memuat isi lengkap). Ukuran huruf
 * harus sudah dipasang pada dokumen sebelum tinggi dihitung.
 */
export interface TataBarisPdf {
    /** Jarak teks dari tepi kiri dan kanan sel. */
    padX: number;
    /** Jarak teks dari tepi atas dan bawah sel. */
    padY: number;
    /** Tinggi baris paling kecil. */
    minimal: number;
}

export const CATATAN_TEKS_DIPOTONG = 'Teks yang terlalu panjang dipotong; versi Excel memuat isi lengkap.';

/** Lebar kolom yang dijumlahkan menjadi `total`; selisihnya masuk ke kolom `lentur`. */
export function lebarPenuh(lebar: number[], lentur: number, total: number): number[] {
    const selisih = total - lebar.reduce((jumlah, nilai) => jumlah + nilai, 0);
    return lebar.map((nilai, i) => (i === lentur ? nilai + selisih : nilai));
}

/** Batas bawah isi halaman, tepat di atas margin bawah. */
export function batasBawahPdf(doc: PDFKit.PDFDocument): number {
    return doc.page.height - doc.page.margins.bottom;
}

/** Tinggi baris paling besar: seluruh isi satu halaman baru. */
export function tinggiMaksimalBarisPdf(doc: PDFKit.PDFDocument): number {
    return batasBawahPdf(doc) - doc.page.margins.top;
}

/** Tinggi satu baris: sel tertinggi ditambah ruang atas dan bawah, paling tinggi satu halaman. */
export function tinggiBarisPdf(doc: PDFKit.PDFDocument, sel: string[], lebar: number[], tata: TataBarisPdf): number {
    const tertinggi = sel.reduce((maks, teks, i) => (teks
        ? Math.max(maks, doc.heightOfString(teks, { width: lebar[i] - 2 * tata.padX }))
        : maks), 0);
    return Math.min(tinggiMaksimalBarisPdf(doc), Math.max(tata.minimal, Math.ceil(tertinggi + 2 * tata.padY)));
}

/**
 * Tulis satu baris setinggi `tinggi` mulai dari (x, y); sel kosong dilewati.
 * Sel yang tidak muat dipotong dengan "…" di dalam barisnya sendiri, tidak
 * pernah berlanjut ke halaman lain. Mengembalikan true bila ada sel dipotong.
 */
export function tulisBarisPdf(
    doc: PDFKit.PDFDocument, sel: string[], lebar: number[], x: number, y: number, tata: TataBarisPdf, tinggi: number,
): boolean {
    const ruang = tinggi - 2 * tata.padY;
    let kiri = x;
    let dipotong = false;
    sel.forEach((teks, i) => {
        if (teks) {
            const width = lebar[i] - 2 * tata.padX;
            const potong = doc.heightOfString(teks, { width }) > ruang;
            dipotong = dipotong || potong;
            doc.text(teks, kiri + tata.padX, y + tata.padY, potong
                ? { width, align: 'left', height: ruang, ellipsis: true }
                : { width, align: 'left' });
        }
        kiri += lebar[i];
    });
    return dipotong;
}
