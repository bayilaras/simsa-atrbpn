/**
 * Teks surat dari PDF yang dipilih di formulir surat, dibaca di peramban.
 * Berkasnya tidak dikirim ke mana pun untuk keperluan ini; hanya teks hasilnya
 * yang dikirim ke server untuk dibaca menjadi isian (letter-prefill.service.js).
 * PDF hasil pindai tidak memuat teks, sehingga hasilnya string kosong.
 */

/** Sama dengan LETTER_FORM_TEXT_MAX_CHARS di backend (services/letter-text-fields.ts). */
export const MAKS_KARAKTER_TEKS_SURAT = 20_000
/** Isian surat ada di halaman awal; halaman berikutnya adalah lampiran. */
export const MAKS_HALAMAN_TEKS_SURAT = 5
const BATAS_WAKTU_MS = 20_000

/**
 * Menyusun baris bacaan dari item teks PDF.js. Aturannya sama dengan
 * joinPdfTextItems di backend; kedua fungsi diuji dengan berkas contoh yang
 * sama (backend/src/__tests__/fixtures/pdf-text-lines.json).
 */
export function susunBarisPdf(items) {
    if (!Array.isArray(items)) return ''
    let hasil = ''
    let sebelumnya = null
    for (const item of items) {
        if (typeof item?.str !== 'string') continue
        const matriks = Array.isArray(item.transform) ? item.transform : null
        const x = Number(matriks?.[4])
        const y = Number(matriks?.[5])
        const berposisi = matriks !== null && Number.isFinite(x) && Number.isFinite(y)
        const tinggi = Math.abs(Number(item.height)) || Math.abs(Number(matriks?.[3])) || 0
        const lebar = Math.abs(Number(item.width)) || 0
        if (!berposisi) {
            if (hasil && !/\s$/.test(hasil)) hasil += ' '
        } else if (sebelumnya && item.str.length > 0) {
            // Item kosong tidak memuat huruf, jadi posisinya tidak menunjukkan
            // letak teks berikutnya; hanya tanda akhir barisnya yang dipakai.
            const tinggiBaris = Math.max(tinggi, sebelumnya.tinggi, 1)
            const turun = Math.abs(y - sebelumnya.y)
            if (turun > tinggiBaris * 0.5) {
                if (!hasil.endsWith('\n')) hasil += '\n'
                // Jarak sekitar dua baris memisahkan paragraf.
                if (turun > tinggiBaris * 1.9 && !hasil.endsWith('\n\n')) hasil += '\n'
            } else if (x - (sebelumnya.x + sebelumnya.lebar) > tinggiBaris * 0.15
                && hasil && !/\s$/.test(hasil) && !/^\s/.test(item.str)) {
                // Lebih lebar dari jarak antarhuruf: PDF tidak menuliskan spasinya.
                hasil += ' '
            }
        }
        hasil += item.str
        if (item.hasEOL === true && !hasil.endsWith('\n')) hasil += '\n'
        if (berposisi && (item.str.length > 0 || !sebelumnya)) sebelumnya = { x, y, lebar, tinggi }
    }
    return hasil
        .split('\n')
        .map(baris => baris.replace(/[ \t\u00a0]+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

/** Teks halaman-halaman awal sebuah dokumen PDF.js, paling panjang `maksKarakter`. */
export async function teksDariDokumenPdf(dokumen, {
    maksHalaman = MAKS_HALAMAN_TEKS_SURAT,
    maksKarakter = MAKS_KARAKTER_TEKS_SURAT,
} = {}) {
    const jumlahHalaman = Number.isInteger(dokumen?.numPages) ? Math.min(dokumen.numPages, maksHalaman) : 0
    const halaman = []
    let panjang = 0
    for (let nomor = 1; nomor <= jumlahHalaman && panjang < maksKarakter; nomor += 1) {
        const lembar = await dokumen.getPage(nomor)
        const isi = await lembar.getTextContent()
        const teks = susunBarisPdf(isi?.items)
        if (!teks) continue
        halaman.push(teks)
        panjang += teks.length + 2
    }
    return halaman.join('\n\n').slice(0, maksKarakter).trim()
}

let pemuatPdfjs = null

// PDF.js dimuat hanya saat sebuah PDF benar-benar dibaca. Build "legacy"
// dipakai agar berjalan di semua peramban yang didukung aplikasi; berkas
// pekerjanya dimuat dari alamat aplikasi sendiri (CSP: worker-src 'self').
function muatPdfjs() {
    pemuatPdfjs ??= Promise.all([
        import('pdfjs-dist/legacy/build/pdf.min.mjs'),
        import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
    ]).then(([pdfjs, pekerja]) => {
        pdfjs.GlobalWorkerOptions.workerSrc = pekerja.default
        return pdfjs
    }).catch((error) => {
        // Kegagalan memuat (mis. jaringan) tidak menetap: berkas berikutnya mencoba lagi.
        pemuatPdfjs = null
        throw error
    })
    return pemuatPdfjs
}

/**
 * Teks surat dari berkas PDF (File/Blob). Mengembalikan string kosong bila PDF
 * tidak memuat teks; melempar galat bila PDF tidak dapat dibuka (rusak,
 * berkata sandi), waktunya habis, atau `signal` dibatalkan.
 */
export async function bacaTeksPdf(berkas, { signal } = {}) {
    signal?.throwIfAborted()
    const pdfjs = await muatPdfjs()
    const data = new Uint8Array(await berkas.arrayBuffer())
    signal?.throwIfAborted()
    const tugas = pdfjs.getDocument({
        data,
        // Hanya teks yang dibaca: tanpa font, gambar, WebAssembly, atau
        // permintaan jaringan tambahan dari dalam pekerja.
        disableFontFace: true,
        useSystemFonts: false,
        useWorkerFetch: false,
        useWasm: false,
        isEvalSupported: false,
    })
    const hentikan = () => { Promise.resolve(tugas.destroy()).catch(() => {}) }
    const pewaktu = setTimeout(hentikan, BATAS_WAKTU_MS)
    signal?.addEventListener('abort', hentikan, { once: true })
    try {
        const dokumen = await tugas.promise
        const teks = await teksDariDokumenPdf(dokumen)
        signal?.throwIfAborted()
        return teks
    } finally {
        clearTimeout(pewaktu)
        signal?.removeEventListener('abort', hentikan)
        hentikan()
    }
}
