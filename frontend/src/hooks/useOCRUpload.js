import { useState, useCallback, useRef, useEffect } from 'react';
import { bulkUploadService } from '../services/bulk-upload.service';

export function useOCRUpload(unitKerjaId) {
    const [files, setFiles] = useState([]);
    const [batchId, setBatchId] = useState(null);
    const [batch, setBatch] = useState(null);
    const [isUploading, setIsUploading] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState(null);

    const pollingRef = useRef(null);

    // Add files
    const addFiles = useCallback((newFiles) => {
        const pdfFiles = Array.from(newFiles).filter(
            (file) => file.type === 'application/pdf'
        );

        if (pdfFiles.length !== newFiles.length) {
            setError('Beberapa file diabaikan karena bukan PDF');
        }

        if (files.length + pdfFiles.length > 50) {
            setError('Maksimum 50 file per upload');
            return;
        }

        setFiles((prev) => [...prev, ...pdfFiles]);
        setError(null);
    }, [files.length]);

    // Remove file
    const removeFile = useCallback((index) => {
        setFiles((prev) => prev.filter((_, i) => i !== index));
    }, []);

    // Clear all files
    const clearFiles = useCallback(() => {
        setFiles([]);
        setBatchId(null);
        setBatch(null);
        setError(null);
    }, []);

    // Upload files
    const upload = useCallback(async (folderId = null) => {
        if (files.length === 0) {
            setError('Tidak ada file untuk diupload');
            return null;
        }

        setIsUploading(true);
        setError(null);

        try {
            const result = await bulkUploadService.uploadFiles(files, unitKerjaId, folderId);
            setBatchId(result.data.batchId);
            setIsUploading(false);
            setIsProcessing(true);
            return result.data.batchId;
        } catch (err) {
            setError(err.response?.data?.error || 'Upload gagal');
            setIsUploading(false);
            return null;
        }
    }, [files, unitKerjaId]);

    // Poll batch status
    const pollBatchStatus = useCallback(async (id) => {
        try {
            const result = await bulkUploadService.getBatchStatus(id);
            setBatch(result.data);

            if (['completed', 'partial'].includes(result.data.status)) {
                setIsProcessing(false);
                if (pollingRef.current) {
                    clearInterval(pollingRef.current);
                    pollingRef.current = null;
                }
            }
        } catch (err) {
            console.error('Error polling batch status:', err);
        }
    }, []);

    // Start polling when batchId changes
    useEffect(() => {
        if (batchId && isProcessing) {
            // Initial poll
            pollBatchStatus(batchId);

            // Poll every 2 seconds
            pollingRef.current = setInterval(() => {
                pollBatchStatus(batchId);
            }, 2000);

            return () => {
                if (pollingRef.current) {
                    clearInterval(pollingRef.current);
                }
            };
        }
    }, [batchId, isProcessing, pollBatchStatus]);

    // Confirm batch
    const confirmBatch = useCallback(async (confirmedItems, folderId = null) => {
        if (!batchId) {
            setError('Tidak ada batch untuk dikonfirmasi');
            return null;
        }

        try {
            const result = await bulkUploadService.confirmBatch(batchId, confirmedItems, folderId);
            return result.data;
        } catch (err) {
            setError(err.response?.data?.error || 'Gagal menyimpan arsip');
            return null;
        }
    }, [batchId]);

    // Calculate progress
    const progress = batch ? {
        total: batch.totalFiles,
        processed: batch.processedFiles,
        completed: batch.items?.filter((i) => i.status === 'completed').length || 0,
        failed: batch.items?.filter((i) => i.status === 'failed').length || 0,
        percentage: batch.totalFiles > 0
            ? Math.round((batch.processedFiles / batch.totalFiles) * 100)
            : 0,
    } : null;

    return {
        files,
        batch,
        batchId,
        isUploading,
        isProcessing,
        error,
        progress,
        addFiles,
        removeFile,
        clearFiles,
        upload,
        confirmBatch,
        setError,
    };
}

export default useOCRUpload;
