import PDFDocument from 'pdfkit';
import { createCanvas } from '@napi-rs/canvas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OCRService } from '../services/ocr.service';

afterEach(() => {
    vi.unstubAllEnvs();
});

async function buildPdf(
    draw: (document: PDFKit.PDFDocument) => void,
): Promise<Buffer> {
    const document = new PDFDocument({ size: 'A4', compress: false });
    const chunks: Buffer[] = [];
    document.on('data', chunk => chunks.push(Buffer.from(chunk)));
    const completed = new Promise<void>((resolve, reject) => {
        document.once('end', resolve);
        document.once('error', reject);
    });
    draw(document);
    document.end();
    await completed;
    return Buffer.concat(chunks);
}

describe('OCRService PDF processing', () => {
    it('keeps a real PDF text layer on the extraction path without invoking scan OCR', async () => {
        const service = new OCRService();
        const scanSpy = vi.spyOn(service, 'extractTextFromScannedPDF');
        const pdf = await buildPdf(document => {
            document.fontSize(13).text(
                'Nomor: TU.01/123/VIII/2026\n'
                + 'Perihal: Pengelolaan arsip terpadu\n'
                + 'Isi surat ini cukup panjang untuk membuktikan ekstraksi text layer PDF berjalan.',
            );
        });

        const result = await service.processPDF(pdf);

        expect(result.success).toBe(true);
        expect(result.text).toContain('Pengelolaan arsip terpadu');
        expect(result.text).not.toContain('fitur dalam pengembangan');
        expect(scanSpy).not.toHaveBeenCalled();
    });

    it('renders an image-only PDF before accepting actual OCR output', async () => {
        const service = new OCRService();
        const recognizedText = 'Nomor TU.02/456/VIII/2026 hasil OCR nyata untuk dokumen scan dan pengelolaan arsip.';
        const recognize = vi.fn().mockResolvedValue({ data: { text: recognizedText } });
        const terminate = vi.fn().mockResolvedValue({});
        vi.spyOn(service as any, 'createWorker').mockResolvedValue({ recognize, terminate });

        const image = createCanvas(1200, 500);
        const context = image.getContext('2d');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, image.width, image.height);
        context.fillStyle = '#000000';
        context.font = '36px sans-serif';
        context.fillText('Dokumen hasil pemindaian tanpa text layer', 50, 150);
        const png = image.toBuffer('image/png');
        const pdf = await buildPdf(document => {
            document.image(png, 40, 100, { fit: [515, 250] });
        });

        const result = await service.processPDF(pdf);

        expect(result.success).toBe(true);
        expect(result.text).toBe(recognizedText);
        expect(recognize).toHaveBeenCalledTimes(1);
        expect(Buffer.isBuffer(recognize.mock.calls[0][0])).toBe(true);
        expect(terminate).toHaveBeenCalled();
    });

    it('fails closed when scan OCR cannot run and never returns placeholder success', async () => {
        const service = new OCRService();
        vi.spyOn(service, 'extractTextFromPDF').mockResolvedValue('');
        vi.spyOn(service, 'extractTextFromScannedPDF')
            .mockRejectedValue(new Error('native renderer detail'));

        const result = await service.processPDF(Buffer.from('%PDF-test'));

        expect(result.success).toBe(false);
        expect(result.text).toBe('');
        expect(result.metadata.extractedText).toBe('');
        expect(result.error).toBe('Dokumen PDF tidak dapat diproses dengan aman');
        expect(JSON.stringify(result)).not.toContain('fitur dalam pengembangan');
        expect(JSON.stringify(result)).not.toContain('native renderer detail');
    });

    it('rejects OCR output that is too short to be meaningful', async () => {
        const service = new OCRService();
        vi.spyOn(service, 'extractTextFromPDF').mockResolvedValue('');
        vi.spyOn(service, 'extractTextFromScannedPDF').mockResolvedValue('noise');

        const result = await service.processPDF(Buffer.from('%PDF-test'));

        expect(result.success).toBe(false);
        expect(result.text).toBe('');
        expect(result.error).toBe('Dokumen tidak menghasilkan teks yang cukup');
    });

    it('fails closed in production when controlled language data is not configured', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('OCR_TESSDATA_PATH', '');
        const service = new OCRService();

        await expect(service.performOCR(Buffer.from('valid-image-bytes')))
            .rejects.toThrow('Data bahasa OCR belum dikonfigurasi pada server');
    });

    it('terminates an active Tesseract worker and preserves the abort reason', async () => {
        const service = new OCRService();
        const controller = new AbortController();
        const ownershipLost = new Error('OCR lease ownership lost');
        let signalRecognitionStarted!: () => void;
        const recognitionStarted = new Promise<void>((resolve) => {
            signalRecognitionStarted = resolve;
        });
        const recognize = vi.fn(() => {
            signalRecognitionStarted();
            return new Promise<never>(() => undefined);
        });
        const terminate = vi.fn().mockResolvedValue(undefined);
        vi.spyOn(service as any, 'createWorker').mockResolvedValue({ recognize, terminate });

        const processing = service.performOCR(
            Buffer.from('valid-image-bytes'),
            controller.signal,
        );
        await recognitionStarted;
        controller.abort(ownershipLost);

        await expect(processing).rejects.toBe(ownershipLost);
        expect(terminate).toHaveBeenCalled();
    });
});
