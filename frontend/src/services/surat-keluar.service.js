import api from './api';
import { uploadFileToBlob } from './blob-upload.service';

export const suratKeluarService = {
    // List surat keluar with pagination and filters
    async getAll({ unitKerjaId, tahun, naskahDinas, search, tanggalDari, tanggalSampai, page = 1, limit = 20 } = {}) {
        const response = await api.get('/api/surat-keluar', {
            unitKerjaId,
            tahun,
            naskahDinas,
            search,
            tanggalDari,
            tanggalSampai,
            page,
            limit,
        });
        return response;
    },

    // Get single surat keluar by ID
    async getById(id) {
        const response = await api.get(`/api/surat-keluar/${id}`);
        return response.data;
    },

    // Get next number for new surat
    async getNextNumber({ unitKerjaId, tahun, tanggalSurat, naskahDinas } = {}) {
        const response = await api.get('/api/surat-keluar/next-number', {
            unitKerjaId,
            tahun,
            tanggalSurat,
            naskahDinas,
        });
        return response.data;
    },

    // Get statistics
    async getStats({ unitKerjaId, tahun } = {}) {
        const response = await api.get('/api/surat-keluar/stats', { unitKerjaId, tahun });
        return response.data;
    },

    // Create new surat keluar (supports file upload via Vercel Blob)
    async create(data, file = null) {
        // Upload file to Vercel Blob first if present
        let fileUrl = null;
        let fileOriginalName = null;

        if (file) {
            try {
                const blob = await uploadFileToBlob(file, { folder: 'surat-keluar' });
                fileUrl = blob.url;
                fileOriginalName = file.name;
            } catch (uploadError) {
                console.error('Blob upload failed:', uploadError);
                throw new Error('Gagal mengunggah file. Silakan coba lagi.');
            }
        }

        // Send as JSON (no file in request body)
        const payload = {
            ...data,
            ...(fileUrl && { filePath: fileUrl }),
            ...(fileOriginalName && { fileOriginalName }),
        };

        const response = await api.post('/api/surat-keluar', payload);
        return response;
    },

    // Update surat keluar (supports file upload via Vercel Blob)
    async update(id, data, file = null) {
        let fileUrl = null;
        let fileOriginalName = null;

        if (file) {
            try {
                const blob = await uploadFileToBlob(file, { folder: 'surat-keluar' });
                fileUrl = blob.url;
                fileOriginalName = file.name;
            } catch (uploadError) {
                console.error('Blob upload failed:', uploadError);
                throw new Error('Gagal mengunggah file. Silakan coba lagi.');
            }
        }

        const payload = {
            ...data,
            ...(fileUrl && { filePath: fileUrl }),
            ...(fileOriginalName && { fileOriginalName }),
        };

        const response = await api.put(`/api/surat-keluar/${id}`, payload);
        return response.data;
    },

    // Delete surat keluar
    async delete(id) {
        await api.delete(`/api/surat-keluar/${id}`);
    },

    // Archive surat keluar (creates arsip record with full metadata)
    async archive(id, metadata = {}) {
        const response = await api.post(`/api/surat-keluar/${id}/archive-full`, metadata);
        return response.data;
    },
};

export default suratKeluarService;
