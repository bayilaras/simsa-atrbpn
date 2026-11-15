import { describe, expect, it } from 'vitest';
import { DataSudahBerubahError } from '../utils/errors.js';
import { publicErrorResponse, publicErrorStatus } from '../utils/public-error.js';
import { pastikanBelumBerubah } from '../utils/versi-rekaman.js';

describe('versi data yang dimuat formulir', () => {
    it('409 dengan kode tetap dan pesan untuk staf', () => {
        const error = new DataSudahBerubahError();
        expect(publicErrorStatus(error)).toBe(409);
        expect(publicErrorResponse(error, 'req-1')).toEqual({
            success: false,
            error: 'DataSudahBerubahError',
            message: 'Data ini sudah diubah pengguna lain sejak Anda membukanya. Muat ulang halaman untuk melihat perubahan terbaru, lalu ulangi perubahan Anda.',
            code: 'DATA_SUDAH_BERUBAH',
            requestId: 'req-1',
        });
    });

    it('membandingkan pada milidetik dan tidak memeriksa bila klien tidak mengirim versi', () => {
        const tersimpan = new Date('2026-03-02T10:00:00.123Z');
        expect(() => pastikanBelumBerubah(tersimpan, new Date(JSON.parse(JSON.stringify(tersimpan))))).not.toThrow();
        expect(() => pastikanBelumBerubah(tersimpan, undefined)).not.toThrow();
        expect(() => pastikanBelumBerubah(tersimpan, new Date('2026-03-02T10:00:00.124Z'))).toThrow(DataSudahBerubahError);
    });
});
