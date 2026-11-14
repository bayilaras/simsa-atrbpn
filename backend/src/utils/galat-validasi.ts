// Pesan bawaan Zod berbahasa Indonesia berlaku untuk setiap validator.
import '../validators/pesan-zod.js';

/** Teks utama penolakan validasi; rincian per isian ada di `details`. */
export const PESAN_VALIDASI_UMUM = 'Data yang dikirim belum valid. Periksa isian berikut.';

/**
 * Badan respons 400 validasi. `details` tetap berbentuk { field, message } agar
 * formulir dapat menampilkan pesan di samping isiannya.
 */
export function badanGalatValidasi(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>) {
    return {
        success: false as const,
        error: PESAN_VALIDASI_UMUM,
        message: PESAN_VALIDASI_UMUM,
        code: 'VALIDATION_ERROR' as const,
        details: issues.map((issue) => ({
            field: issue.path.map(String).join('.'),
            message: issue.message,
        })),
    };
}
