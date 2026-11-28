/**
 * Reads letter fields (number, date, subject, sender, recipient) from the
 * plain text of a letter. Nothing here touches a PDF engine, an OCR engine,
 * the database or the network, so both the OCR worker (extractLetterMetadata)
 * and the API process (readLetterFormFields) can use it.
 */

// Enhanced metadata interface with additional fields
export interface ExtractedMetadata {
    // Core fields
    nomorSurat: string | null;
    perihal: string | null;
    tanggalSurat: string | null;
    pengirim: string | null;
    extractedText: string;

    // Enhanced fields
    penerima: string | null;           // Kepada/Yth
    tembusan: string[];                // Tembusan list
    lampiran: string | null;           // Lampiran info
    sifatSurat: string | null;         // Segera/Sangat Segera/Biasa/Rahasia
    klasifikasiKeamanan: string | null; // Rahasia/Terbatas/Biasa
    jenisSurat: string | null;         // Surat Dinas/Nota Dinas/Memo etc
    keywords: string[];                // Auto-extracted keywords
    summary: string | null;            // First paragraph summary
}

// Common Indonesian stopwords to filter out from keywords
const STOPWORDS = new Set([
    'yang', 'dan', 'di', 'ke', 'dari', 'untuk', 'dengan', 'pada', 'ini', 'itu',
    'adalah', 'dalam', 'akan', 'atau', 'sebagai', 'oleh', 'bahwa', 'tersebut',
    'dapat', 'tidak', 'juga', 'kami', 'anda', 'saya', 'mereka', 'kita', 'ada',
    'telah', 'sudah', 'belum', 'harus', 'bisa', 'lebih', 'sangat', 'sesuai',
    'atas', 'bawah', 'antara', 'tentang', 'kepada', 'melalui', 'perihal', 'hal',
    'nomor', 'tanggal', 'tahun', 'bulan', 'hari', 'surat', 'bersama', 'demikian',
    'hormat', 'menteri', 'direktur', 'kepala', 'sekretaris', 'tempat', 'yth'
]);

/**
 * Rebuild reading lines from PDF.js text items. Items that share a baseline
 * are joined without inventing a space inside a word, and a new baseline
 * starts a new line, so the field patterns below can stop at the end of a
 * line. Items without a position keep the former space-joined behaviour.
 */
export function joinPdfTextItems(items: unknown): string {
    if (!Array.isArray(items)) return '';
    let out = '';
    let previous: { x: number; y: number; width: number; height: number } | null = null;
    for (const raw of items) {
        const item = raw as { str?: unknown; transform?: unknown; width?: unknown; height?: unknown; hasEOL?: unknown };
        if (typeof item?.str !== 'string') continue;
        const transform = Array.isArray(item.transform) ? item.transform : null;
        const x = Number(transform?.[4]);
        const y = Number(transform?.[5]);
        const positioned = transform !== null && Number.isFinite(x) && Number.isFinite(y);
        const height = Math.abs(Number(item.height)) || Math.abs(Number(transform?.[3])) || 0;
        const width = Math.abs(Number(item.width)) || 0;
        if (!positioned) {
            if (out && !/\s$/.test(out)) out += ' ';
        } else if (previous && item.str.length > 0) {
            // An empty item carries no glyph, so its position says nothing
            // about where the text continues; only its hasEOL mark counts.
            const lineHeight = Math.max(height, previous.height, 1);
            const drop = Math.abs(y - previous.y);
            if (drop > lineHeight * 0.5) {
                if (!out.endsWith('\n')) out += '\n';
                // A gap of about two lines separates paragraphs.
                if (drop > lineHeight * 1.9 && !out.endsWith('\n\n')) out += '\n';
            } else if (x - (previous.x + previous.width) > lineHeight * 0.15
                && out && !/\s$/.test(out) && !/^\s/.test(item.str)) {
                // Wider than kerning: the PDF left the space out of its text.
                out += ' ';
            }
        }
        out += item.str;
        if (item.hasEOL === true && !out.endsWith('\n')) out += '\n';
        if (positioned && (item.str.length > 0 || !previous)) previous = { x, y, width, height };
    }
    return out
        .split('\n')
        .map(line => line.replace(/[ \t\u00a0]+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

const FIELD_LABEL = '(?:Nomor|No\\.|Sifat|Lampiran|Lamp\\.|Hal|Perihal|Tanggal|Dari|Kepada|Yth\\.?|Tembusan)';
const NEXT_FIELD_LABEL = new RegExp(`\\s${FIELD_LABEL}\\s*:`, 'i');
const LINE_STARTS_WITH_LABEL = new RegExp(`^(?:${FIELD_LABEL}\\s*:|Yth\\b|Kepada\\b|Tembusan\\b)`, 'i');
const BODY_OPENING = /^(?:Dengan hormat|Sehubungan|Bersama ini|Menindaklanjuti|Berdasarkan|Dalam rangka|Menunjuk|Memperhatikan|Berkenaan|Yang bertanda)/i;
const NUMBER_STOP_WORD = /^(?:hal|perihal|lampiran|lamp\.?|sifat|tanggal|yth\.?|kepada|dari|tentang|tembusan)$/i;
const NUMBER_LABEL_NOT_A_LETTER = /^(?:induk|telepon|telp\.?|hp|handphone|rekening|urut|agenda|registrasi|seri|pokok|identitas|polisi|faks\.?|fax)\b/i;
const ADDRESS_CONTEXT = /\b(?:jalan|jl\.?|telp\.?|telepon|faks\.?|fax|faksimile|kode pos|kav\.?|blok)\b/i;
const ROMAN_MONTHS = new Set(['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']);
const BULAN: Record<string, string> = {
    januari: '01', februari: '02', maret: '03', april: '04', mei: '05', juni: '06',
    juli: '07', agustus: '08', september: '09', oktober: '10', november: '11', desember: '12',
};
const TEXT_DATE = /(\d{1,2})\s+(Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s+(\d{4})/i;
const NUMERIC_DATE = /(?<!\d)(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})(?!\d)/;
const WEEKDAY = /^(?:senin|selasa|rabu|kamis|jumat|jum'at|sabtu|minggu|ahad)$/i;
/** A letter's own header fields sit above its body, within this many lines. */
const HEADER_LINES = 30;

function toLines(text: string): string[] {
    return text.split(/\r?\n/).map(line => line.replace(/[ \t\u00a0]+/g, ' ').trim());
}

/** A value ends where the next field of the same header begins. */
function cutAtNextLabel(value: string): string {
    const next = value.search(NEXT_FIELD_LABEL);
    return (next >= 0 ? value.slice(0, next) : value).replace(/^[\s:]+/, '').trim();
}

/** OCR reads the Roman month of a letter number as digits: X1, 1X, V1. */
function repairRomanMonth(nomor: string): string {
    return nomor.split('/').map(segment => {
        if (!/^[IVX1l|]{1,4}$/.test(segment) || !/[IVX]/.test(segment) || !/[1l|]/.test(segment)) return segment;
        const roman = segment.replace(/[1l|]/g, 'I');
        return ROMAN_MONTHS.has(roman) ? roman : segment;
    }).join('/');
}

/**
 * Read a letter number from the words that follow its label. The scan is one
 * pass over at most a line of text, so a number followed by a long sentence
 * cannot stall the process.
 */
function readNumberTokens(rest: string): { value: string; strong: boolean } | null {
    const tokens = rest.slice(0, 160).split(' ').filter(Boolean).slice(0, 24);
    const isSeparator = (token: string | undefined) => token !== undefined && /^[\/\-.]$/.test(token);
    const accepted: string[] = [];
    for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index].replace(/[,;:]+$/, '');
        if (!token || NUMBER_STOP_WORD.test(token)) break;
        if (/^tahun$/i.test(token)) {
            // "Nomor 12 Tahun 2026" is one number.
            if (accepted.length === 1 && /^\d+$/.test(accepted[0]) && /^\d{4}\b/.test(tokens[index + 1] ?? '')) {
                return { value: `${accepted[0]} Tahun ${(tokens[index + 1] as string).slice(0, 4)}`, strong: true };
            }
            break;
        }
        if (!/^[A-Za-z0-9.\-\/()|]+$/.test(token)) break;
        const last = accepted[accepted.length - 1];
        // After its first word a number only continues across a separator,
        // as in "B - 99 / CTH.05 / XI / 2026".
        if (last !== undefined && !isSeparator(token) && !/^[\/\-]/.test(token)
            && !isSeparator(last) && !/[\/\-]$/.test(last)) break;
        const lettersOnly = /^[A-Za-z]+$/.test(token);
        const joinsNumber = isSeparator(last) || isSeparator(tokens[index + 1]);
        if (lettersOnly && !(token.length <= 6 && joinsNumber)) break;
        accepted.push(token);
        if (tokens[index] !== token) break; // trailing punctuation ends the number
    }
    while (accepted.length && isSeparator(accepted[accepted.length - 1])) accepted.pop();
    if (!accepted.length) return null;
    const value = repairRomanMonth(accepted.join('').replace(/[.]+$/, '')).slice(0, 100);
    if (!/[A-Za-z0-9]/.test(value)) return null;
    return { value, strong: /\d/.test(value) && /[\/\-]/.test(value) };
}

function findNomorSurat(lines: string[], text: string): string | null {
    let weak: string | null = null;
    for (const line of lines) {
        const label = /(?:^|[\s(])(?:N\s?omor|No\.?)(?:\s*:\s*|\s+)/gi;
        for (let match = label.exec(line); match; match = label.exec(line)) {
            const rest = line.slice(match.index + match[0].length);
            if (!rest || NUMBER_LABEL_NOT_A_LETTER.test(rest)) continue;
            if (ADDRESS_CONTEXT.test(line.slice(0, match.index))) continue;
            const found = readNumberTokens(rest);
            if (!found) continue;
            if (found.strong) return found.value;
            // A bare number counts only when its label opens the line. Alone
            // on that line it is a header field and is taken as it stands.
            if (match.index !== 0) continue;
            if (rest.trim().split(' ').length === 1) return found.value;
            if (!weak) weak = found.value;
        }
    }
    // Without a label only a slash-separated number is taken: amounts such as
    // "Rp.1.000.000" and phone numbers share the letters-then-digits shape.
    for (const loose of text.matchAll(/(?<![A-Za-z0-9.\-\/])((?:\d{1,6}\/)?[A-Za-z]{1,8}[.\-\/]\d+[.\-\/][A-Za-z0-9.\-\/]{1,60})/g)) {
        const value = loose[1].replace(/[.\-\/]+$/, '');
        if (value.includes('/')) return repairRomanMonth(value).slice(0, 100);
    }
    return weak;
}

function toIsoDate(day: string, month: string, year: string): string | null {
    const d = Number(day), m = Number(month), y = Number(year);
    if (!(d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 1900 && y <= 2100)) return null;
    // 31 February is not a date; the forms and the importers reject it.
    if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null;
    return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function dateIn(value: string, allowNumeric: boolean): string | null {
    const textual = value.match(TEXT_DATE);
    if (textual) return toIsoDate(textual[1], BULAN[textual[2].toLowerCase()], textual[3]);
    if (!allowNumeric) return null;
    const numeric = value.match(NUMERIC_DATE);
    return numeric ? toIsoDate(numeric[1], numeric[2], numeric[3]) : null;
}

/** Prefer the date the letter states as its own over a date in the body. */
function findTanggalSurat(lines: string[], text: string): string | null {
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        // "Tanggal : 20 November 2026" in the header, or "Jakarta, 12 November
        // 2026" on a line of its own; whichever the letter states first. A
        // weekday before the comma is a schedule row, not the place of issue.
        const labelled = index < HEADER_LINES ? line.match(/^Tanggal\s*:?\s*(.+)$/i) : null;
        const placed = !labelled && line.length <= 60 ? line.match(/^([A-Za-z .'-]{2,40}),\s*(.+)$/) : null;
        const stated = labelled ? labelled[1] : placed && !WEEKDAY.test(placed[1].trim()) ? placed[2] : null;
        const found = stated ? dateIn(stated, true) : null;
        if (found) return found;
    }
    return dateIn(text, false);
}

/**
 * A long header value wraps onto short lines of its own. Those lines belong
 * to the value until the next field, the address line or the body begins.
 */
function continueWrapped(lines: string[], index: number, value: string): string {
    let joined = value;
    for (let next = index + 1; next <= index + 2 && next < lines.length; next++) {
        const line = lines[next];
        if (!line || line.length > 70 || joined.length < 20 || joined.length + line.length > 250
            || LINE_STARTS_WITH_LABEL.test(line) || BODY_OPENING.test(line) || /^di(?:\s|$)/i.test(line)) break;
        joined = `${joined} ${line}`;
    }
    return joined;
}

function findPerihal(lines: string[]): string | null {
    for (let index = 0; index < lines.length; index++) {
        // Without its colon the label must be followed by a capitalised
        // subject, so a sentence that opens with "Hal ini" is not taken.
        const match = lines[index].match(/^(?:Perihal|Hal)\s*:\s*(.+)$/i)
            ?? (lines[index].length <= 120 ? lines[index].match(/^(?:Perihal|Hal)\s+([A-Z].+)$/) : null);
        if (!match) continue;
        const value = cutAtNextLabel(match[1]);
        if (!value) continue;
        return continueWrapped(lines, index, value).slice(0, 500);
    }
    // Circulars and decrees carry their subject under "TENTANG".
    for (let index = 0; index < lines.length; index++) {
        const match = lines[index].match(/^TENTANG\b\s*(.*)$/);
        if (!match) continue;
        const parts = match[1] ? [match[1]] : [];
        for (let next = index + 1; next <= index + 3 && next < lines.length; next++) {
            const line = lines[next];
            if (!line || line !== line.toUpperCase() || line.length > 90) break;
            parts.push(line);
        }
        if (parts.length) return parts.join(' ').slice(0, 500);
    }
    // A header whose fields share one line. The colon is required here: the
    // word "hal" is common in the body of a letter.
    for (const line of lines) {
        const match = line.match(/\s(?:Perihal|Hal)\s*:\s*(.+)$/i);
        const value = match ? cutAtNextLabel(match[1]) : '';
        if (value) return value.slice(0, 500);
    }
    return null;
}

/**
 * The value of a labelled header line, or of the line after a bare label.
 * `inline` finds the same field inside a line that carries several fields;
 * it must require the colon, because these words also occur in sentences.
 */
function labelledValue(lines: string[], label: RegExp, inline?: RegExp): string | null {
    for (let index = 0; index < lines.length; index++) {
        const match = lines[index].match(label);
        if (!match) continue;
        const value = cutAtNextLabel(match[1] ?? '');
        if (value) return continueWrapped(lines, index, value);
        const next = lines[index + 1];
        if (next && !LINE_STARTS_WITH_LABEL.test(next)) return cutAtNextLabel(next) || null;
    }
    if (!inline) return null;
    for (const line of lines) {
        const match = line.match(inline);
        const value = match ? cutAtNextLabel(match[1] ?? '') : '';
        if (value) return value;
    }
    return null;
}

/** The signer's title closes a letter on a short line that ends with a comma. */
function signerTitle(lines: string[]): string | null {
    for (let index = lines.length - 1; index >= Math.max(0, lines.length - 25); index--) {
        const match = lines[index].match(/^((?:a\.n\.|u\.b\.|Plt\.?|Plh\.?|Pj\.?)\s+)?((?:Menteri|Sekretaris|Direktur|Kepala|Inspektur|Deputi|Ketua|Gubernur|Bupati|Wali ?kota|Camat|Lurah|Kasubdit|Kabid|Kabag|Kasubbag|Kasi)\b[^,\n]{0,90}),$/i);
        // A title is a few words; a longer line is a sentence of the body.
        if (match && match[2].split(' ').length <= 10) return `${match[1] ?? ''}${match[2]}`.trim();
    }
    return null;
}

/** Pengirim: a "Dari" header, else the title of the person who signs. */
function findPengirim(lines: string[], text: string): string | null {
    return (labelledValue(lines, /^(?:Dari|Pengirim)\s*:\s*(.*)$/i, /\s(?:Dari|Pengirim)\s*:\s*(.+)$/i)
        ?? signerTitle(lines)
        ?? text.match(/(?:a\.n\.|atas nama)[\s.]+([^\n,]+)/i)?.[1].trim()
        ?? null)?.substring(0, 255) || null;
}

/** Penerima: the "Yth." or "Kepada" line. */
function findPenerima(lines: string[]): string | null {
    return (labelledValue(lines, /^(?:Kepada\s+)?Yth\.?\s*:?\s*(.*)$/i, /\sYth\.?\s*:\s*(.+)$/i)
        ?? labelledValue(lines, /^Kepada\s*:?\s*(.*)$/i))?.substring(0, 500) || null;
}

/**
 * Document types that head a letter as a title line of their own, with the
 * name the letter forms use for that type (frontend/src/lib/jenis-naskah.js).
 */
const LETTER_TYPE_TITLES: ReadonlyArray<readonly [RegExp, string]> = [
    [/^NOTA DINAS$/, 'Nota Dinas'],
    [/^MEMORANDUM$/, 'Memorandum'],
    [/^SURAT EDARAN$/, 'Surat Edaran'],
    [/^SURAT UNDANGAN$/, 'Surat Undangan'],
    [/^SURAT PENGANTAR$/, 'Surat Pengantar'],
    [/^PENGUMUMAN$/, 'Pengumuman'],
    [/^TELAAHAN STAF$/, 'Telaahan Staf'],
    [/^SURAT TUGAS(?: [A-Z ]{1,60})?$/, 'Surat Tugas'],
    [/^SURAT PERINTAH(?: [A-Z ]{1,60})?$/, 'Surat Perintah'],
    [/^SURAT KUASA(?: [A-Z ]{1,60})?$/, 'Surat Kuasa'],
    [/^SURAT KETERANGAN(?: [A-Z ]{1,60})?$/, 'Surat Keterangan'],
    [/^BERITA ACARA(?: [A-Z ]{1,60})?$/, 'Berita Acara'],
    [/^KEPUTUSAN [A-Z ]{3,80}$/, 'Keputusan'],
    [/^INSTRUKSI [A-Z ]{3,80}$/, 'Instruksi'],
    [/^PERATURAN [A-Z ]{3,80}$/, 'Peraturan'],
];

/**
 * The document type, read only from a capitalised title line above the body.
 * The same words inside a sentence ("berdasarkan nota dinas ...") say nothing
 * about the letter in hand, and an ordinary letter carries no title at all.
 */
function findLetterTypeTitle(lines: string[]): string | null {
    for (const line of lines.slice(0, HEADER_LINES)) {
        for (const [title, name] of LETTER_TYPE_TITLES) {
            if (title.test(line)) return name;
        }
    }
    return null;
}

// Extract keywords from text
function extractKeywords(text: string): string[] {
    // Tokenize and clean text
    const words = text
        .toLowerCase()
        .replace(/[^a-zA-Z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 3)
        .filter(word => !STOPWORDS.has(word))
        .filter(word => !/^\d+$/.test(word)); // Remove pure numbers

    // Count word frequency
    const wordFreq: Record<string, number> = {};
    words.forEach(word => {
        wordFreq[word] = (wordFreq[word] || 0) + 1;
    });

    // Sort by frequency and take top 10
    return Object.entries(wordFreq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([word]) => word);
}

// Extract summary from first paragraph
function extractSummary(text: string): string | null {
    // Find first substantial paragraph (at least 50 chars)
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 50);

    if (paragraphs.length === 0) return null;

    // Get first paragraph, limit to 300 chars
    let summary = paragraphs[0].trim().replace(/\s+/g, ' ');
    if (summary.length > 300) {
        summary = summary.substring(0, 297) + '...';
    }
    return summary;
}

// Format jenis surat to proper case
function formatJenisSurat(jenis: string): string {
    const formatMap: Record<string, string> = {
        'surat dinas': 'Surat Dinas',
        'nota dinas': 'Nota Dinas',
        'memorandum': 'Memorandum',
        'memo': 'Memorandum',
        'surat keputusan': 'Surat Keputusan',
        'surat edaran': 'Surat Edaran',
        'surat undangan': 'Surat Undangan',
        'surat perintah': 'Surat Perintah',
        'instruksi': 'Instruksi',
        'surat tugas': 'Surat Tugas',
        'berita acara': 'Berita Acara'
    };
    return formatMap[jenis.toLowerCase()] || jenis;
}

// Extract metadata from text using regex patterns
export function extractLetterMetadata(text: string): ExtractedMetadata {
    // Fields are read line by line: a header value ends at the end of its
    // line or where the next field label begins.
    const lines = toLines(text);

    const nomorSurat = findNomorSurat(lines, text);
    const perihal = findPerihal(lines);
    const tanggalSurat = findTanggalSurat(lines, text);

    const pengirim = findPengirim(lines, text);
    const penerima = findPenerima(lines);

    // Extract tembusan
    const tembusan: string[] = [];
    const tembusanMatch = text.match(/Tembusan[\s:]+([^]*?)(?=\n\s*\n|\n\d+\.\s+\w+:)/i);
    if (tembusanMatch) {
        const tembusanText = tembusanMatch[1];
        const tembusanItems = tembusanText.split(/[;\n]/);
        tembusanItems.forEach(item => {
            const cleaned = item.replace(/^\d+[\.\)]?\s*/, '').trim();
            if (cleaned.length > 3 && cleaned.length < 200) {
                tembusan.push(cleaned);
            }
        });
    }

    // Extract lampiran
    const lampiranPatterns = [
        /Lampiran[\s:]+(\d+\s*(?:lembar|berkas|set|eks|buah)?[^\n]*)/i,
        /Lamp\.?[\s:]+(\d+\s*(?:lembar|berkas|set|eks|buah)?[^\n]*)/i,
    ];
    let lampiran: string | null = null;
    for (const pattern of lampiranPatterns) {
        const match = text.match(pattern);
        if (match) {
            lampiran = cutAtNextLabel(match[1]).substring(0, 255) || null;
            break;
        }
    }

    // Extract sifat surat
    const sifatPatterns = [
        /Sifat[\s:]+([^\n]+)/i,
        /\b(SANGAT SEGERA|SEGERA|BIASA|PENTING|RAHASIA|TERBATAS)\b/i,
    ];
    let sifatSurat: string | null = null;
    for (const pattern of sifatPatterns) {
        const match = text.match(pattern);
        if (match) {
            sifatSurat = cutAtNextLabel(match[1]).toUpperCase().substring(0, 50) || null;
            break;
        }
    }

    // Extract klasifikasi keamanan
    const keamananPatterns = [
        /Klasifikasi[\s:]+([^\n]+)/i,
        /\b(RAHASIA|SANGAT RAHASIA|TERBATAS|BIASA)\b/i,
    ];
    let klasifikasiKeamanan: string | null = null;
    for (const pattern of keamananPatterns) {
        const match = text.match(pattern);
        if (match) {
            klasifikasiKeamanan = cutAtNextLabel(match[1]).toUpperCase().substring(0, 100) || null;
            break;
        }
    }

    // Extract jenis surat/naskah dinas
    const jenisPatterns = [
        /\b(SURAT DINAS|NOTA DINAS|MEMORANDUM|MEMO|SURAT KEPUTUSAN|SURAT EDARAN|SURAT UNDANGAN|SURAT PERINTAH|INSTRUKSI|SURAT TUGAS|BERITA ACARA)\b/i,
    ];
    let jenisSurat: string | null = null;
    for (const pattern of jenisPatterns) {
        const match = text.match(pattern);
        if (match) {
            jenisSurat = formatJenisSurat(match[1]);
            break;
        }
    }

    // Extract keywords
    const keywords = extractKeywords(text);

    // Extract summary
    const summary = extractSummary(text);

    return {
        nomorSurat,
        perihal,
        tanggalSurat,
        pengirim,
        extractedText: text.substring(0, 50000), // Limit stored text
        penerima,
        tembusan: tembusan.slice(0, 10), // Max 10 tembusan
        lampiran,
        sifatSurat,
        klasifikasiKeamanan,
        jenisSurat,
        keywords,
        summary
    };
}

/** Longest letter text the letter forms send to be read: about five pages. */
export const LETTER_FORM_TEXT_MAX_CHARS = 20_000;
/** A visual line of a letter is far shorter; the bound keeps every scan cheap. */
const LETTER_FORM_LINE_MAX_CHARS = 500;

/** What a letter form can take over from the text of the letter. */
export interface LetterFormFields {
    nomorSurat: string | null;
    tanggalSurat: string | null;
    perihal: string | null;
    pengirim: string | null;
    penerima: string | null;
    jenisSurat: string | null;
}

/**
 * The fields a person registering a letter would otherwise retype. Sifat and
 * the security class are left out on purpose: they decide who may open the
 * record, so they stay a choice of the person who registers the letter.
 */
export function readLetterFormFields(text: string): LetterFormFields {
    const lines = toLines(text.slice(0, LETTER_FORM_TEXT_MAX_CHARS))
        .map(line => line.slice(0, LETTER_FORM_LINE_MAX_CHARS));
    const bounded = lines.join('\n');
    return {
        nomorSurat: findNomorSurat(lines, bounded),
        tanggalSurat: findTanggalSurat(lines, bounded),
        perihal: findPerihal(lines),
        pengirim: findPengirim(lines, bounded),
        penerima: findPenerima(lines),
        jenisSurat: findLetterTypeTitle(lines),
    };
}
