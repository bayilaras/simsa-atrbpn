import { describe, expect, it } from 'vitest';
import { MULTILINE_FIELDS, sanitizeInput } from '../middlewares/sanitize.middleware';

function jalankan(body: unknown) {
    const req: any = { body };
    sanitizeInput(req, {} as any, () => undefined);
    return req.body;
}

describe('sanitizeInput', () => {
    it('mempertahankan baris baru pada instruksi tetapi tetap membuang tag', () => {
        expect(jalankan({ instruksi: '1. Siapkan data\r\n2.  Koordinasikan <b>dengan</b> PTEP\n\n\n\n3. Laporkan' }).instruksi)
            .toBe('1. Siapkan data\n2. Koordinasikan dengan PTEP\n\n3. Laporkan');
    });

    it('mencakup persis bidang multi-baris §5', () => {
        expect([...MULTILINE_FIELDS].sort()).toEqual(['alasan', 'catatan', 'catatanPenyelesaian', 'instruction', 'instruksi', 'keterangan']);
    });

    it('bidang lain tetap diratakan menjadi satu baris', () => {
        expect(jalankan({ perihal: 'Undangan\n  rapat' }).perihal).toBe('Undangan rapat');
    });

    it('bidang bersarang (disposisi.instruksi) ikut dipertahankan', () => {
        expect(jalankan({ disposisi: { instruksi: 'a\nb', targets: [{ unitKerjaId: ' dir_bppt ' }] } }))
            .toEqual({ disposisi: { instruksi: 'a\nb', targets: [{ unitKerjaId: 'dir_bppt' }] } });
    });
});
