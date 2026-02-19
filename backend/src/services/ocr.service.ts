import Tesseract from 'tesseract.js';
import { createLogger } from '../utils/logger';

const log = createLogger('OcrService');

// pdfjs-dist is problematic in Node.js environments
// Using a lazy import approach to avoid crashes at module load time
let pdfjs: any = null;

async function loadPdfJs() {
    if (!pdfjs) {
        try {
            // Try legacy build first for Node.js compatibility
            pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
            pdfjs.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/legacy/build/pdf.worker.mjs';
        } catch (e) {
            log.warn('Failed to load pdfjs-dist legacy build, PDF extraction disabled');
            pdfjs = null;
        }
    }
    return pdfjs;
}

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

export interface OCRResult {
    success: boolean;
    text: string;
    metadata: ExtractedMetadata;
    error?: string;
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

class OCRService {
    // Extract text from PDF buffer
    async extractTextFromPDF(buffer: Buffer): Promise<string> {
        try {
            const pdf = await loadPdfJs();
            if (!pdf) {
                return '[PDF extraction tidak tersedia]';
            }

            // Load PDF document
            const pdfData = new Uint8Array(buffer);
            const pdfDoc = await pdf.getDocument({ data: pdfData }).promise;

            let fullText = '';

            // Extract text from each page
            for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
                const page = await pdfDoc.getPage(pageNum);
                const textContent = await page.getTextContent();
                const pageText = textContent.items
                    .map((item: any) => item.str)
                    .join(' ');
                fullText += pageText + '\n';
            }

            return fullText.trim();
        } catch (error) {
            log.error({ err: error }, 'Error extracting text from PDF:');
            throw error;
        }
    }

    // Perform OCR on an image buffer using Tesseract
    async performOCR(imageBuffer: Buffer): Promise<string> {
        try {
            const { data: { text } } = await Tesseract.recognize(
                imageBuffer,
                'ind+eng', // Indonesian + English
                {
                    logger: m => log.info(`OCR Progress: ${m.status} - ${Math.round((m.progress || 0) * 100)}%`)
                }
            );
            return text;
        } catch (error) {
            log.error({ err: error }, 'OCR Error:');
            throw error;
        }
    }

    // Extract keywords from text
    private extractKeywords(text: string): string[] {
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
    private extractSummary(text: string): string | null {
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

    // Extract metadata from text using regex patterns
    extractMetadata(text: string): ExtractedMetadata {
        // Normalize text for better matching
        const normalizedText = text.replace(/\s+/g, ' ').trim();

        // Extract nomor surat (various patterns)
        const nomorPatterns = [
            /(?:Nomor|No\.?)[\s:]+([A-Z0-9][\w.\-\/]+(?:[\s]?[\w.\-\/]+)*)(?=\s*(?:\n|Hal|Perihal|Lampiran|Sifat|$))/i,
            /([A-Z]{1,3}[.\-\/]\d+[.\-\/][A-Z0-9.\-\/]+)/i,
        ];
        let nomorSurat: string | null = null;
        for (const pattern of nomorPatterns) {
            const match = normalizedText.match(pattern);
            if (match) {
                nomorSurat = match[1].trim();
                break;
            }
        }

        // Extract perihal/hal
        const perihalPatterns = [
            /(?:Perihal|Hal)[\s:]+(.+?)(?:(?=\n|Kepada|Yth)|$)/i,
            /(?:Perihal|Hal)[\s:]+([^\n]+)/i,
        ];
        let perihal: string | null = null;
        for (const pattern of perihalPatterns) {
            const match = text.match(pattern);
            if (match) {
                perihal = match[1].trim().substring(0, 500); // Limit length
                break;
            }
        }

        // Extract tanggal (Indonesian date format)
        const bulanMap: Record<string, string> = {
            'januari': '01', 'februari': '02', 'maret': '03', 'april': '04',
            'mei': '05', 'juni': '06', 'juli': '07', 'agustus': '08',
            'september': '09', 'oktober': '10', 'november': '11', 'desember': '12'
        };
        const tanggalPattern = /(\d{1,2})\s+(Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s+(\d{4})/i;
        let tanggalSurat: string | null = null;
        const tanggalMatch = text.match(tanggalPattern);
        if (tanggalMatch) {
            const day = tanggalMatch[1].padStart(2, '0');
            const month = bulanMap[tanggalMatch[2].toLowerCase()];
            const year = tanggalMatch[3];
            tanggalSurat = `${year}-${month}-${day}`;
        }

        // Extract pengirim (Dari: or Pengirim:)
        const pengirimPatterns = [
            /(?:Dari|Pengirim)[\s:]+([^\n]+)/i,
            /(?:a\.n\.|atas nama)[\s.]+([^\n,]+)/i,
            /(?:Kepala|Direktur|Kasubdit|Kabid)\s+([^\n,]+)/i,
        ];
        let pengirim: string | null = null;
        for (const pattern of pengirimPatterns) {
            const match = text.match(pattern);
            if (match) {
                pengirim = match[1].trim().substring(0, 255);
                break;
            }
        }

        // Extract penerima (Kepada/Yth)
        const penerimaPatterns = [
            /(?:Kepada\s+)?Yth\.?[\s:]+([^\n]+)/i,
            /Kepada[\s:]+([^\n]+)/i,
        ];
        let penerima: string | null = null;
        for (const pattern of penerimaPatterns) {
            const match = text.match(pattern);
            if (match) {
                penerima = match[1].trim().substring(0, 500);
                break;
            }
        }

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
                lampiran = match[1].trim().substring(0, 255);
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
                sifatSurat = match[1].trim().toUpperCase().substring(0, 50);
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
                klasifikasiKeamanan = match[1].trim().toUpperCase().substring(0, 100);
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
                jenisSurat = this.formatJenisSurat(match[1]);
                break;
            }
        }

        // Extract keywords
        const keywords = this.extractKeywords(text);

        // Extract summary
        const summary = this.extractSummary(text);

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

    // Format jenis surat to proper case
    private formatJenisSurat(jenis: string): string {
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

    // Process a PDF file - try text extraction first, then OCR if needed
    async processPDF(buffer: Buffer): Promise<OCRResult> {
        try {
            // First try to extract text directly from PDF
            let extractedText = await this.extractTextFromPDF(buffer);

            // If extracted text is too short, the PDF might be scanned/image-based
            if (extractedText.length < 50) {
                log.info('PDF text extraction yielded little text, attempting OCR...');
                // For scanned PDFs, we would need to render pages as images first
                // This is a simplified version - in production, you'd convert PDF pages to images
                extractedText = '[OCR diperlukan untuk dokumen scan - fitur dalam pengembangan]';
            }

            const metadata = this.extractMetadata(extractedText);

            return {
                success: true,
                text: extractedText,
                metadata
            };
        } catch (error: any) {
            log.error({ err: error }, 'PDF processing error:');
            return {
                success: false,
                text: '',
                metadata: {
                    nomorSurat: null,
                    perihal: null,
                    tanggalSurat: null,
                    pengirim: null,
                    extractedText: '',
                    penerima: null,
                    tembusan: [],
                    lampiran: null,
                    sifatSurat: null,
                    klasifikasiKeamanan: null,
                    jenisSurat: null,
                    keywords: [],
                    summary: null
                },
                error: error.message || 'Failed to process PDF'
            };
        }
    }

    // Helper method to serialize metadata as JSON for storage
    serializeMetadata(metadata: ExtractedMetadata): string {
        return JSON.stringify({
            penerima: metadata.penerima,
            tembusan: metadata.tembusan,
            lampiran: metadata.lampiran,
            sifatSurat: metadata.sifatSurat,
            klasifikasiKeamanan: metadata.klasifikasiKeamanan,
            jenisSurat: metadata.jenisSurat,
            keywords: metadata.keywords,
            summary: metadata.summary
        });
    }

    // Helper method to parse serialized metadata
    parseMetadata(jsonString: string): Partial<ExtractedMetadata> {
        try {
            return JSON.parse(jsonString);
        } catch {
            return {};
        }
    }
}

export const ocrService = new OCRService();
export default ocrService;
