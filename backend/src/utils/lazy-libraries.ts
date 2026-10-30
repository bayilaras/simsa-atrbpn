import type ExcelJS from 'exceljs';
import type QRCode from 'qrcode';

// The spreadsheet, PDF and QR libraries are about 600 module files that only
// exports, imports, print templates and labels use, so they load on first use
// instead of on every cold start. The specifiers stay literal so the
// deployment file tracer still ships each package.
let excelJs: Promise<typeof ExcelJS> | undefined;
let pdfKit: Promise<typeof import('pdfkit')> | undefined;
let qrCode: Promise<typeof QRCode> | undefined;

export const loadExcelJS = () => (excelJs ??= import('exceljs').then(module => module.default));
export const loadPdfKit = () => (pdfKit ??= import('pdfkit').then(module => module.default));
export const loadQRCode = () => (qrCode ??= import('qrcode').then(module => module.default));
