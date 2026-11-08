import { describe, expect, it } from 'vitest';
import {
    createArsipVitalSchema,
    KATEGORI_ARSIP_VITAL,
    updateArsipVitalSchema,
} from '../validators/schemas';

const base = {
    arsipId: '11111111-1111-4111-8111-111111111111',
    unitKerjaId: 'ditjen',
    kategoriVital: 'aset',
    tingkatKekritisan: 'kritis',
};

const blankOptionalFields = {
    alasanPenetapan: '',
    metodeProteksi: '',
    lokasiBackup: '',
    mediaBackup: '',
    jadwalBackup: '',
    tanggalPenetapan: '',
    tanggalReviewSelanjutnya: '',
    penanggungJawab: '   ',
};

describe('arsip vital categories', () => {
    it('uses the category keys offered by the designation form', () => {
        expect(KATEGORI_ARSIP_VITAL).toEqual(['aset', 'hukum', 'personal', 'keuangan', 'kebijakan']);
    });

    it.each(KATEGORI_ARSIP_VITAL)('accepts the category %s on create and update', kategoriVital => {
        expect(createArsipVitalSchema.safeParse({ ...base, kategoriVital }).success).toBe(true);
        expect(updateArsipVitalSchema.safeParse({ kategoriVital }).success).toBe(true);
    });

    it.each(['hak_keperdataan', 'operasional', 'keamanan', 'lainnya', '', null])(
        'rejects the unknown category %j on create and update',
        kategoriVital => {
            expect(createArsipVitalSchema.safeParse({ ...base, kategoriVital }).success).toBe(false);
            expect(updateArsipVitalSchema.safeParse({ kategoriVital }).success).toBe(false);
        },
    );
});

describe('arsip vital optional fields', () => {
    it('treats blank optional inputs on create as not provided', () => {
        const parsed = createArsipVitalSchema.parse({ ...base, ...blankOptionalFields, statusProteksi: 'belum_diproteksi' });

        expect(parsed).toEqual({ ...base, statusProteksi: 'belum_diproteksi' });
        for (const field of Object.keys(blankOptionalFields)) {
            expect(parsed[field as keyof typeof parsed]).toBeUndefined();
        }
    });

    it('treats blank optional inputs on update as unchanged', () => {
        const parsed = updateArsipVitalSchema.parse(blankOptionalFields);

        expect(Object.values(parsed).every(value => value === undefined)).toBe(true);
    });

    it('clears optional fields sent as null on update', () => {
        const cleared = {
            alasanPenetapan: null,
            metodeProteksi: null,
            lokasiBackup: null,
            mediaBackup: null,
            jadwalBackup: null,
            tanggalPenetapan: null,
            tanggalReviewSelanjutnya: null,
            penanggungJawab: null,
        };

        expect(updateArsipVitalSchema.parse(cleared)).toEqual(cleared);
    });

    it('keeps supplied optional values, including every protection method', () => {
        const values = {
            alasanPenetapan: 'Bukti kepemilikan aset',
            lokasiBackup: 'Ruang arsip',
            mediaBackup: 'Microfilm',
            jadwalBackup: 'bulanan',
            tanggalPenetapan: '2026-11-08',
            tanggalReviewSelanjutnya: '2027-11-08',
            penanggungJawab: 'Petugas arsip',
        };
        for (const metodeProteksi of ['duplikasi', 'dispersal', 'vault', 'digital_backup']) {
            expect(createArsipVitalSchema.parse({ ...base, ...values, metodeProteksi }))
                .toMatchObject({ ...values, metodeProteksi });
            expect(updateArsipVitalSchema.parse({ ...values, metodeProteksi })).toEqual({ ...values, metodeProteksi });
        }
    });

    it.each([
        ['metodeProteksi', 'lainnya'],
        ['jadwalBackup', 'sewindu'],
        ['tanggalPenetapan', '2026-02-31'],
        ['tanggalReviewSelanjutnya', '08-11-2027'],
        ['lokasiBackup', 'x'.repeat(256)],
    ])('still rejects an invalid %s', (field, value) => {
        expect(createArsipVitalSchema.safeParse({ ...base, [field]: value }).success).toBe(false);
        expect(updateArsipVitalSchema.safeParse({ [field]: value }).success).toBe(false);
    });

    it.each(['arsipId', 'kategoriVital', 'tingkatKekritisan'])('still requires %s on create', field => {
        const { [field as keyof typeof base]: _omitted, ...rest } = base;
        expect(createArsipVitalSchema.safeParse(rest).success).toBe(false);
        expect(createArsipVitalSchema.safeParse({ ...rest, [field]: '' }).success).toBe(false);
    });

    it.each(['tingkatKekritisan', 'statusProteksi'])('does not clear the required field %s on update', field => {
        expect(updateArsipVitalSchema.safeParse({ [field]: '' }).success).toBe(false);
        expect(updateArsipVitalSchema.safeParse({ [field]: null }).success).toBe(false);
    });
});
