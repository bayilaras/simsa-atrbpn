import { Request, Response, NextFunction } from 'express';
import { NAMA_ELEMEN_MARKUP } from '../constants/nama-elemen-markup.js';

/**
 * Input Sanitization Middleware
 *
 * Membuang markup dari setiap nilai teks di req.body. Yang dibuang hanya markup
 * sungguhan: tag elemen HTML, SVG, atau MathML yang dikenal (huruf besar/kecil
 * sama saja) atau elemen kustom (huruf kecil dengan tanda hubung, mis. x-foo),
 * yang namanya diikuti spasi, '/' atau '>' (mis. <b>, </div>, <img src=x ...>);
 * elemen script/style beserta isinya; dan komentar HTML. Teks lain yang memuat
 * '<' dan '>' disimpan apa adanya: perbandingan "a < b", alamat surel
 * "Budi <budi@contoh.go.id>", panah "->", isian seperti "<nama>" atau
 * "Undangan <Rapat Koordinasi>".
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
]);

/** Elemen yang isinya bukan teks bacaan; dibuang bersama isinya. */
const ELEMENTS_WITHOUT_TEXT: ReadonlySet<string> = new Set(['script', 'style']);

/**
 * Membuang satu tag dapat menyambung dua potongan menjadi tag baru
 * ("<scr<b>ipt>" → "<script>"), jadi pembuangan diulang sampai hasilnya tetap.
 * Teks wajar selesai dalam satu atau dua putaran.
 */
const MAX_PASSES = 10;

const LESS_THAN = 60;
const GREATER_THAN = 62;
const EQUALS = 61;
const SLASH = 47;
const DOUBLE_QUOTE = 34;
const SINGLE_QUOTE = 39;

function isAsciiLetter(code: number): boolean {
    return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isTagNameChar(code: number): boolean {
    return isAsciiLetter(code) || (code >= 48 && code <= 57) || code === 45;
}

/** Spasi menurut HTML: spasi, tab, LF, FF, CR. */
function isHtmlSpace(code: number): boolean {
    return code === 32 || code === 9 || code === 10 || code === 12 || code === 13;
}

interface HtmlTag { end: number; name: string; closing: boolean }

/**
 * Nama elemen kustom menurut standar HTML: diawali huruf kecil, memuat tanda
 * hubung, tanpa huruf kapital (mis. x-foo). Kata seperti "e-Office" tetap teks.
 */
function isCustomElementName(name: string): boolean {
    return name.includes('-') && /^[a-z][a-z0-9-]*$/.test(name);
}

/**
 * Tag yang dimulai di `start` (posisi '<'), atau null bila bukan tag elemen yang
 * dikenal. Nilai atribut berkutip (kutip tepat setelah '=') boleh memuat '>'.
 * Pemindaian berhenti di '<' berikutnya, sehingga satu putaran tetap linear
 * terhadap panjang teks.
 */
function readTag(text: string, start: number): HtmlTag | null {
    let position = start + 1;
    const closing = text.charCodeAt(position) === SLASH;
    if (closing) position += 1;
    const nameStart = position;
    if (!isAsciiLetter(text.charCodeAt(position))) return null;
    while (isTagNameChar(text.charCodeAt(position))) position += 1;
    const writtenName = text.slice(nameStart, position);
    const name = writtenName.toLowerCase();
    if (!NAMA_ELEMEN_MARKUP.has(name) && !isCustomElementName(writtenName)) return null;
    const afterName = text.charCodeAt(position);
    if (!isHtmlSpace(afterName) && afterName !== SLASH && afterName !== GREATER_THAN) return null;
    let afterEquals = false;
    while (position < text.length) {
        const code = text.charCodeAt(position);
        if (code === GREATER_THAN) return { end: position + 1, name, closing };
        if (code === LESS_THAN) return null;
        if (afterEquals && (code === DOUBLE_QUOTE || code === SINGLE_QUOTE)) {
            position += 1;
            while (position < text.length && text.charCodeAt(position) !== code) {
                if (text.charCodeAt(position) === LESS_THAN) return null;
                position += 1;
            }
            afterEquals = false;
        } else if (code === EQUALS) {
            afterEquals = true;
        } else if (!isHtmlSpace(code)) {
            afterEquals = false;
        }
        position += 1;
    }
    return null;
}

/**
 * Posisi setelah tag penutup </name> pertama mulai `from`, atau -1. `noClosingFrom`
 * mengingat posisi yang sudah diketahui tidak diikuti penutup, agar banyak tag
 * pembuka tanpa penutup tidak memindai ulang sisa teks.
 */
function elementEnd(text: string, from: number, name: string, noClosingFrom: Map<string, number>): number {
    if (from >= (noClosingFrom.get(name) ?? Infinity)) return -1;
    for (let position = text.indexOf('<', from); position !== -1; position = text.indexOf('<', position + 1)) {
        const tag = readTag(text, position);
        if (tag?.closing && tag.name === name) return tag.end;
    }
    noClosingFrom.set(name, from);
    return -1;
}

function stripOnce(text: string): string {
    const noClosingFrom = new Map<string, number>();
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
            const tag = readTag(text, position);
            if (tag) {
                end = tag.end;
                if (!tag.closing && ELEMENTS_WITHOUT_TEXT.has(tag.name)) {
                    const bodyEnd = elementEnd(text, tag.end, tag.name, noClosingFrom);
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

/** Buang setiap potongan '<…>'; hanya untuk teks yang tagnya bersambung terlalu dalam. */
function stripEveryBracketPair(text: string): string {
    let result = '';
    let copyFrom = 0;
    for (let position = text.indexOf('<'); position !== -1; position = text.indexOf('<', copyFrom)) {
        const end = text.indexOf('>', position + 1);
        if (end === -1) break;
        result += text.slice(copyFrom, position);
        copyFrom = end + 1;
    }
    return result + text.slice(copyFrom);
}

/**
 * Buang markup HTML; teks lain tidak diubah. Waktu kerja linear terhadap panjang
 * teks (penyaring ini berjalan untuk setiap badan JSON, sebelum autentikasi).
 */
function stripTags(str: string): string {
    let text = str;
    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
        if (!text.includes('<')) return text;
        const next = stripOnce(text);
        if (next.length === text.length) return text;
        text = next;
    }
    return stripEveryBracketPair(text);
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
    return stripTags(value).replace(/\s+/g, ' ').trim();
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
        // Strip HTML tags first; multi-line fields keep their line breaks (§5).
        return key && MULTILINE_FIELDS.has(key)
            ? normalizeMultiline(stripTags(value))
            : sanitizeSatuBaris(value);
    }

    if (Array.isArray(value)) {
        return value.map((item) => sanitizeValue(item));
    }

    if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
        const sanitized: Record<string, any> = {};
        for (const [k, v] of Object.entries(value)) {
            sanitized[k] = sanitizeValue(v, k);
        }
        return sanitized;
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
