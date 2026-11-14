import { describe, expect, it } from 'vitest';
import { sanitizeMultipartInput } from '../../middlewares/sanitize.middleware.js';
import suratMasukRouter from '../surat-masuk.routes';
import suratKeluarRouter from '../surat-keluar.routes';
import penyusutanRouter from '../penyusutan.routes';
import regulatoryRuleSetRouter from '../regulatory-rule-set.routes';
import uploadRouter from '../upload.routes';

// sanitizeInput global berjalan sebelum parser unggah, jadi setiap rute
// multipart yang membaca isian teks wajib menyaring tepat setelah parsernya.
const rute = [
    ['surat masuk buat', suratMasukRouter, 'post', '/'],
    ['surat masuk ubah', suratMasukRouter, 'put', '/:id'],
    ['surat keluar buat', suratKeluarRouter, 'post', '/'],
    ['surat keluar ubah', suratKeluarRouter, 'put', '/:id'],
    ['bukti pelaksanaan penyusutan', penyusutanRouter, 'post', '/:id/evidence'],
    ['PDF sumber aturan', regulatoryRuleSetRouter, 'post', '/:id/source-document/verify'],
    ['lampiran surat/arsip', uploadRouter, 'post', '/:suratType/:suratId'],
] as const;

describe('rute multipart menyaring isian teks', () => {
    it.each(rute)('%s: penyaring tepat setelah parser unggah', (_label, router, metode, path) => {
        const layer = (router as any).stack.find((item: any) => item.route?.path === path && item.route.methods[metode]);
        expect(layer).toBeDefined();
        const handlers = layer.route.stack.map((item: any) => item.handle);
        const posisi = handlers.indexOf(sanitizeMultipartInput);
        expect(posisi).toBeGreaterThan(0);
        expect(handlers[posisi - 1].name).toMatch(/^(multerMiddleware|receiveSourceDocument)$/);
    });
});
