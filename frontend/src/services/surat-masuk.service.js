import api from './api';
import { uploadFileToBlob } from './blob-upload.service';

export const suratMasukService = {
    // List surat masuk with pagination and filters
    async getAll({
        unitKerjaId,
        tahun,
        status,
        search,
        jenisSurat,
        sifatSurat,
        disposisi,
        tanggalDari,
        tanggalSampai,
        page = 1,
        limit = 20,
    } = {}) {
        const response = await api.get('/api/surat-masuk', {
            unitKerjaId,
            tahun,
            status,
            search,
            jenisSurat,
            sifatSurat,
            disposisi,
            tanggalDari,
            tanggalSampai,
            page,
            limit,
        });
        return response;
    },

    // Get single surat masuk by ID
    async getById(id) {
        const response = await api.get(`/api/surat-masuk/${id}`);
        return response.data;
    },

    // Get statistics
    async getStats({ unitKerjaId, tahun } = {}) {
        const response = await api.get('/api/surat-masuk/stats', { unitKerjaId, tahun });
        return response.data;
    },

    // Get next number
    async getNextNumber({ unitKerjaId, tahun, tanggalSurat } = {}) {
        const response = await api.get('/api/surat-masuk/next-number', {
            unitKerjaId,
            tahun,
            tanggalSurat,
        });
        return response.data;
    },

    // Create new surat masuk (supports file upload via Vercel Blob)
    async create(data, file = null) {
        // If a file is provided, upload it directly to Vercel Blob first
        // This bypasses the 4.5MB Vercel serverless function body size limit
        let fileUrl = null;
        let fileOriginalName = null;

        if (file) {
            try {
                const blob = await uploadFileToBlob(file, { folder: 'surat-masuk' });
                fileUrl = blob.url;
                fileOriginalName = file.name;
            } catch (uploadError) {
                console.error('Blob upload failed:', uploadError);
                throw uploadError instanceof Error ? uploadError : new Error('Gagal mengunggah file. Silakan coba lagi.', { cause: uploadError });
            }
        }

        // Send form data as JSON (no file in the request body)
        const payload = {
            ...data,
            ...(fileUrl && { filePath: fileUrl }),
            ...(fileOriginalName && { fileOriginalName }),
        };

        // Registering a file includes server-side streaming and hash checks.
        const response = await api.post('/api/surat-masuk', payload, ...(payload.filePath ? [{ timeoutMs: 60_000 }] : []));
        return response;
    },

    // Update surat masuk (supports file upload via Vercel Blob)
    async update(id, data, file = null) {
        // If a new file is provided, upload it to Blob first
        let fileUrl = null;
        let fileOriginalName = null;

        if (file) {
            try {
                const blob = await uploadFileToBlob(file, { folder: 'surat-masuk' });
                fileUrl = blob.url;
                fileOriginalName = file.name;
            } catch (uploadError) {
                console.error('Blob upload failed:', uploadError);
                throw uploadError instanceof Error ? uploadError : new Error('Gagal mengunggah file. Silakan coba lagi.', { cause: uploadError });
            }
        }

        // Send as JSON (no file in request body)
        const payload = {
            ...data,
            ...(fileUrl && { filePath: fileUrl }),
            ...(fileOriginalName && { fileOriginalName }),
        };

        const response = await api.put(`/api/surat-masuk/${id}`, payload, ...(payload.filePath ? [{ timeoutMs: 60_000 }] : []));
        return response.data;
    },

    // Delete surat masuk
    async delete(id) {
        await api.delete(`/api/surat-masuk/${id}`);
    },

    // Archive surat masuk (creates arsip record with full metadata)
    async archive(id, metadata = {}) {
        const response = await api.post(`/api/surat-masuk/${id}/archive-full`, metadata);
        return response.data;
    },

    // Get belum dibalas (untuk pilihan Surat Keluar)
    async getBelumDibalas({ unitKerjaId, search, page = 1, limit = 10 } = {}) {
        const response = await api.get('/api/surat-masuk', {
            unitKerjaId,
            status: 'belum_dibalas',
            search,
            page,
            limit,
        });
        return response;
    },
};

export default suratMasukService;
