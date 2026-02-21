/**
 * Blob Upload Service
 * 
 * Handles client-side file uploads directly to Vercel Blob storage,
 * bypassing the 4.5MB Vercel serverless function body size limit.
 * 
 * Flow:
 * 1. Frontend requests an upload token from /api/client-upload
 * 2. Frontend uploads file directly to Vercel Blob using the token
 * 3. Frontend gets back the blob URL
 * 4. Frontend sends only the URL (not the file) in the form data
 */
import { upload } from '@vercel/blob/client';

/**
 * Upload a file directly to Vercel Blob (client-side upload).
 * This bypasses the 4.5MB serverless function body size limit.
 * 
 * @param {File} file - The file to upload
 * @param {object} options - Upload options
 * @param {string} options.folder - Folder prefix for the file (e.g., 'surat-masuk')
 * @param {function} options.onProgress - Progress callback ({loaded, total, percentage})
 * @returns {Promise<{url: string, downloadUrl: string, pathname: string}>}
 */
export async function uploadFileToBlob(file, { folder = 'uploads', onProgress } = {}) {
    const pathname = `${folder}/${file.name}`;

    const blob = await upload(pathname, file, {
        access: 'public',
        handleUploadUrl: '/api/client-upload',
        multipart: file.size > 4 * 1024 * 1024, // Use multipart for files > 4MB
        onUploadProgress: onProgress,
    });

    return {
        url: blob.url,
        downloadUrl: blob.downloadUrl,
        pathname: blob.pathname,
    };
}

export default { uploadFileToBlob };
