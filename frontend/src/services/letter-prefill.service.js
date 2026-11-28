import api from './api';

/**
 * Isian formulir surat yang dibaca server dari teks surat. Teksnya diambil di
 * peramban dari PDF yang dipilih (lib/teks-pdf.js); berkasnya tidak dikirim.
 * Server tidak menyimpan teks itu dan hasilnya hanya usulan isian.
 */
export const letterPrefillService = {
    async bacaIsian(teks, { signal } = {}) {
        const response = await api.post('/api/letter-prefill', { extractedText: teks }, { signal });
        return response?.data ?? {};
    },
};

export default letterPrefillService;
