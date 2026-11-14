import { Request, Response, NextFunction } from 'express';
import { NAMA_ELEMEN_MARKUP } from '../constants/nama-elemen-markup.js';
import { parseJsonObjectString } from '../utils/json-objek-teks.js';

/**
 * Input Sanitization Middleware
 *
 * Membuang markup dari setiap nilai teks di req.body. Nama tag dibaca seperti
 * peramban: diawali huruf ASCII, lalu berlanjut sampai pemisah, '/' atau '>'.
 * Pemisah adalah setiap karakter spasi (kelas \s JavaScript: termasuk VT, NBSP,
 * U+2028/2029, U+3000, BOM), sebab normalisasi spasi kemudian mengubahnya
 * menjadi spasi biasa. Yang dibuang:
 * - tag elemen HTML, SVG, atau MathML yang dikenal (huruf besar/kecil sama
 *   saja) yang namanya diikuti pemisah, '/' atau '>' (mis. <b>, </div>,
 *   <img src=x ...>), sampai '>' pertama di luar nilai atribut berkutip;
 * - tag bernama lain (termasuk nama bertanda hubung seperti x-foo) yang
 *   namanya diikuti pemisah atau '/' dan memuat '=' sebelum '>' berikutnya
 *   (mis. <xss onmouseover=...>, <x/ onfocus=...>);
 * - elemen script/style beserta isinya, dan komentar HTML.
 * Nama elemen yang dikenal yang diikuti pemisah atau '/' tetapi tidak pernah
 * ditutup '>' tidak dibuang: '<'-nya diberi spasi ("< img src=x"), sehingga
 * tidak tersimpan awal tag elemen yang dikenal. Nama elemen di akhir teks tanpa
 * karakter apa pun sesudahnya ("nilai p<q", "teks <img") bukan tag dan tetap.
 * Hasil akhir adalah titik tetap: menyaring ulang tidak mengubahnya.
 *
 * Teks lain yang memuat '<' dan '>' disimpan apa adanya: perbandingan "a < b",
 * alamat surel "Budi <budi@contoh.go.id>", panah "->", isian seperti "<nama>",
 * "Undangan <Rapat Koordinasi>", "Aplikasi <e-Office>", "Lampiran <PP-24/1997>".
 *
 * Penyaring ini bukan pengaman tampilan: setiap keluaran HTML di luar React
 * wajib meloloskan teks (backend utils/escape-html.ts, frontend lib/escape-html.js).
 *
 * Skipped fields: extractedText (OCR output may contain formatting) dan kata sandi.
 */

const SKIP_FIELDS = new Set(['extractedText', 'password', 'currentPassword', 'newPassword']);

/** Bidang isian multi-baris (textarea): tag tetap dibuang, baris baru dipertahankan (§5). */
export const MULTILINE_FIELDS: ReadonlySet<string> = new Set([
    'instruction', 'instruksi', 'catatan', 'catatanPenyelesaian', 'alasan', 'keterangan', 'perihal',
    'uraianBerkas', 'purpose', 'details', 'notes', 'reason', 'deskripsi', 'description',
]);

/** Penutup elemen yang isinya bukan teks bacaan; elemen dibuang bersama isinya. */
const CLOSING_TAG: ReadonlyMap<string, RegExp> = new Map([
    ['script', /<\/script(?=[\s/>])/gi],
    ['style', /<\/style(?=[\s/>])/gi],
]);

/**
 * Membuang satu tag dapat menyambung dua potongan menjadi tag baru
 * ("<scr<b>ipt>" → "<script>"), jadi penyaringan diulang sampai hasilnya tetap.
 * Teks wajar selesai dalam satu atau dua putaran.
 */
const MAX_PASSES = 10;

/** Nama elemen terpanjang di NAMA_ELEMEN_MARKUP jauh lebih pendek dari ini. */
const MAX_KNOWN_NAME_LENGTH = 32;

const GREATER_THAN = 62;
const EQUALS = 61;
const SLASH = 47;
const DOUBLE_QUOTE = 34;
const SINGLE_QUOTE = 39;

function isAsciiLetter(code: number): boolean {
    return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

/** Karakter kelas \s JavaScript. */
function isSeparator(code: number): boolean {
    if (code <= 32) return code === 32 || (code >= 9 && code <= 13);
    if (code < 160) return false;
    return code === 0xa0 || code === 0x1680 || (code >= 0x2000 && code <= 0x200a) || code === 0x2028
        || code === 0x2029 || code === 0x202f || code === 0x205f || code === 0x3000 || code === 0xfeff;
}

function endsTagName(code: number): boolean {
    return isSeparator(code) || code === SLASH || code === GREATER_THAN;
}

/**
 * Posisi karakter `char` berikutnya mulai `from`. Dalam satu putaran `from`
 * tidak pernah mundur, jadi hasil pencarian dipakai ulang dan total pemindaian
 * tetap linear.
 */
class NextChar {
    private found = -2;

    constructor(private readonly text: string, private readonly char: string) {}

    from(position: number): number {
        if (this.found === -1) return -1;
        if (this.found < position) this.found = this.text.indexOf(this.char, position);
        return this.found;
    }
}

/** Akhir nama tag berikutnya (pemisah, '/' atau '>') mulai `from`, dengan pemakaian ulang yang sama. */
class NextNameEnd {
    private found = -2;
    private scanned = 0;

    constructor(private readonly text: string) {}

    from(position: number): number {
        if (this.found >= position) return this.found;
        if (this.found === -1) return -1;
        let index = Math.max(position, this.scanned);
        while (index < this.text.length && !endsTagName(this.text.charCodeAt(index))) index += 1;
        this.scanned = index;
        this.found = index < this.text.length ? index : -1;
        return this.found;
    }
}

interface PassState {
    text: string;
    nextGreaterThan: NextChar;
    nextEquals: NextChar;
    nextNameEnd: NextNameEnd;
    lastQuote: Map<number, number>;
    noClosingFrom: Map<string, number>;
}

/** Hasil pembacaan '<': rentang tag yang dibuang, atau '<' dinetralkan (diberi spasi). */
type TagMatch = { end: number; name: string; closing: boolean } | 'neutralise' | null;

/**
 * Akhir tag elemen yang dikenal: '>' pertama di luar nilai atribut berkutip
 * ('<' boleh ada di dalamnya). Kutip tanpa penutup: sampai '>' berikutnya
 * setelah kutip itu. Tanpa '>' di luar kutip: sampai akhir teks. Setiap jalur
 * membuang seluruh bagian yang dipindai, jadi putaran tetap linear.
 */
function knownTagEnd(state: PassState, nameEnd: number): number {
    const { text } = state;
    let afterEquals = false;
    for (let position = nameEnd; position < text.length; position += 1) {
        const code = text.charCodeAt(position);
        if (code === GREATER_THAN) return position + 1;
        if (afterEquals && (code === DOUBLE_QUOTE || code === SINGLE_QUOTE)) {
            const close = position < (state.lastQuote.get(code) ?? -1)
                ? text.indexOf(String.fromCharCode(code), position + 1)
                : -1;
            if (close === -1) {
                const greaterThan = text.indexOf('>', position + 1);
                return greaterThan === -1 ? text.length : greaterThan + 1;
            }
            position = close;
            afterEquals = false;
        } else if (code === EQUALS) {
            afterEquals = true;
        } else if (!isSeparator(code)) {
            afterEquals = false;
        }
    }
    return text.length;
}

function readTag(state: PassState, start: number): TagMatch {
    const { text } = state;
    let nameStart = start + 1;
    const closing = text.charCodeAt(nameStart) === SLASH;
    if (closing) nameStart += 1;
    if (!isAsciiLetter(text.charCodeAt(nameStart))) return null;
    // Nama berlanjut melewati '<' seperti di peramban ("<img<1 ..." bernama "img<1").
    const nameEnd = state.nextNameEnd.from(nameStart);
    if (nameEnd === -1) return null;
    const afterName = text.charCodeAt(nameEnd);
    const name = nameEnd - nameStart <= MAX_KNOWN_NAME_LENGTH ? text.slice(nameStart, nameEnd).toLowerCase() : '';

    if (NAMA_ELEMEN_MARKUP.has(name)) {
        if (state.nextGreaterThan.from(nameEnd) === -1) return 'neutralise';
        if (closing) return { end: state.nextGreaterThan.from(nameEnd) + 1, name, closing };
        return { end: afterName === GREATER_THAN ? nameEnd + 1 : knownTagEnd(state, nameEnd), name, closing };
    }

    // Nama lain (termasuk nama bertanda hubung) hanya tag bila membawa atribut:
    // '=' sebelum '>' berikutnya; '/' setelah nama diperlakukan seperti spasi.
    if (closing || afterName === GREATER_THAN) return null;
    const greaterThan = state.nextGreaterThan.from(nameEnd);
    if (greaterThan === -1) return null;
    const equals = state.nextEquals.from(nameEnd);
    return equals !== -1 && equals < greaterThan ? { end: greaterThan + 1, name, closing } : null;
}

/**
 * Akhir penutup </name> pertama mulai `from`, atau -1. `noClosingFrom` mengingat
 * posisi yang sudah diketahui tidak diikuti penutup, agar banyak tag pembuka
 * tanpa penutup tidak memindai ulang sisa teks.
 */
function elementEnd(state: PassState, from: number, name: string): number {
    if (from >= (state.noClosingFrom.get(name) ?? Infinity)) return -1;
    const closingTag = CLOSING_TAG.get(name)!;
    closingTag.lastIndex = from;
    const match = closingTag.exec(state.text);
    if (!match) {
        state.noClosingFrom.set(name, from);
        return -1;
    }
    const greaterThan = state.text.indexOf('>', match.index);
    return greaterThan === -1 ? state.text.length : greaterThan + 1;
}

function stripOnce(text: string): string {
    const state: PassState = {
        text,
        nextGreaterThan: new NextChar(text, '>'),
        nextEquals: new NextChar(text, '='),
        nextNameEnd: new NextNameEnd(text),
        lastQuote: new Map([[DOUBLE_QUOTE, text.lastIndexOf('"')], [SINGLE_QUOTE, text.lastIndexOf("'")]]),
        noClosingFrom: new Map(),
    };
    let noCommentEndFrom = Infinity;
    let result = '';
    let copyFrom = 0;
    let position = text.indexOf('<');
    while (position !== -1) {
        let end = -1;
        if (text.startsWith('<!--', position)) {
            if (position < noCommentEndFrom) {
                const commentEnd = text.indexOf('-->', position + 4);
                if (commentEnd === -1) noCommentEndFrom = position;
                else end = commentEnd + 3;
            }
        } else {
            const tag = readTag(state, position);
            if (tag === 'neutralise') {
                result += `${text.slice(copyFrom, position + 1)} `;
                copyFrom = position + 1;
            } else if (tag) {
                end = tag.end;
                if (!tag.closing && CLOSING_TAG.has(tag.name)) {
                    const bodyEnd = elementEnd(state, tag.end, tag.name);
                    if (bodyEnd !== -1) end = bodyEnd;
                }
            }
        }
        if (end === -1) {
            position = text.indexOf('<', position + 1);
            continue;
        }
        result += text.slice(copyFrom, position);
        copyFrom = end;
        position = text.indexOf('<', end);
    }
    return result + text.slice(copyFrom);
}

/**
 * Buang markup lalu rapikan spasi, berulang sampai hasilnya tetap. Waktu kerja
 * linear terhadap panjang teks (penyaring ini berjalan untuk setiap badan JSON,
 * sebelum autentikasi). Sambungan tag yang lebih dalam dari MAX_PASSES bukan
 * teks wajar: semua '<' dibuang.
 */
function sanitizeText(value: string, normalize: (text: string) => string): string {
    let text = value;
    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
        const next = normalize(text.includes('<') ? stripOnce(text) : text);
        if (next === text) return text;
        text = next;
    }
    return normalize(text.replace(/</g, ''));
}

function collapseWhitespace(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

/** Rapikan spasi per baris, pertahankan baris baru, maksimal satu baris kosong berturut-turut. */
function normalizeMultiline(value: string): string {
    return value
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Normalisasi bidang satu baris yang dipakai sanitizer JSON: buang markup, rapatkan
 * spasi, trim. Diekspor agar pembanding nilai lama (guard rangkaian, F-I1, impor
 * sinkron) memakai normalisasi jalur tulis; untuk bidang multi-baris (mis. perihal)
 * pembanding ini sengaja mengabaikan baris baru.
 */
export function sanitizeSatuBaris(value: string): string {
    return sanitizeText(value, collapseWhitespace);
}

/**
 * Recursively sanitize all string values in an object
 */
function sanitizeValue(value: any, key?: string): any {
    // Skip whitelisted fields
    if (key && SKIP_FIELDS.has(key)) {
        return value;
    }

    if (typeof value === 'string') {
        // Multi-line fields keep their line breaks (§5).
        return sanitizeText(value, key && MULTILINE_FIELDS.has(key) ? normalizeMultiline : collapseWhitespace);
    }

    if (Array.isArray(value)) {
        return value.map((item) => sanitizeValue(item));
    }

    if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
        // fromEntries menjadikan setiap kunci (termasuk "__proto__") milik objek itu sendiri.
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitizeValue(v, k)]));
    }

    return value;
}

/**
 * Express middleware to sanitize request body
 */
export function sanitizeInput(req: Request, res: Response, next: NextFunction): void {
    if (req.body && typeof req.body === 'object') {
        req.body = sanitizeValue(req.body);
    }
    next();
}

/**
 * Bidang multipart yang membawa objek bersarang sebagai teks JSON; validator
 * mengurainya dengan parseJsonObjectString yang sama.
 */
const MULTIPART_JSON_FIELDS: ReadonlySet<string> = new Set(['disposisi', 'referensi', 'tindakLanjut']);

function sanitizeMultipartField(value: unknown, key: string): unknown {
    if (MULTIPART_JSON_FIELDS.has(key)) {
        const parsed = parseJsonObjectString(value);
        if (parsed !== value && parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return JSON.stringify(sanitizeValue(parsed));
        }
    }
    return sanitizeValue(value, key);
}

/**
 * Penyaring yang sama untuk badan multipart. sanitizeInput global berjalan
 * sebelum parser unggah (multer), jadi setiap rute unggah yang membaca isian
 * teks memasang ini tepat setelah parser unggahnya: surat masuk dan surat
 * keluar (buat/ubah), lampiran surat/arsip, bukti pelaksanaan penyusutan, dan
 * PDF sumber aturan. Objek bersarang dalam teks JSON disaring seperti badan
 * JSON. Idempoten untuk badan JSON yang sudah tersaring.
 */
export function sanitizeMultipartInput(req: Request, res: Response, next: NextFunction): void {
    if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
        req.body = Object.fromEntries(Object.entries(req.body)
            .map(([key, value]) => [key, sanitizeMultipartField(value, key)]));
    }
    next();
}
