import { useState, useCallback, useRef, useEffect } from 'react';
import { bulkUploadService } from '../services/bulk-upload.service';

export const BULK_UPLOAD_LIMITS = Object.freeze({
    maxFiles: 50,
    maxFileBytes: 50 * 1024 * 1024,
    maxBatchBytes: 100 * 1024 * 1024,
});

// The process endpoint advances one item and permits three requests per minute.
// Keep a small scheduling margin so timer/network jitter around a fixed window
// cannot turn a healthy batch into a stream of 429 responses.
export const OCR_PROCESS_INTERVAL_MS = 20_250;
export const OCR_RETRY_FALLBACK_MS = 60_000;

function readRetryAfter(headers) {
    if (!headers) return null;
    if (typeof headers.get === 'function') {
        return headers.get('Retry-After');
    }
    return headers['retry-after'] ?? headers['Retry-After'] ?? null;
}

export function getOCRRetryDelayMs(error, now = Date.now()) {
    const value = readRetryAfter(error?.response?.headers);
    if (value !== null && value !== '') {
        const seconds = Number(value);
        if (Number.isFinite(seconds) && seconds >= 0) {
            return Math.max(1_000, Math.ceil(seconds * 1_000));
        }

        const retryAt = Date.parse(value);
        if (Number.isFinite(retryAt)) {
            return Math.max(1_000, retryAt - now);
        }
    }
    return OCR_RETRY_FALLBACK_MS;
}

export function validateNewBulkFiles(existingFiles, incomingFiles) {
    const candidates = Array.from(incomingFiles);
    const pdfFiles = candidates.filter(file => file.type === 'application/pdf');
    if (pdfFiles.some(file => file.size > BULK_UPLOAD_LIMITS.maxFileBytes)) {
        return { files: [], error: 'Ukuran satu file tidak boleh melebihi 50 MB' };
    }
    if (existingFiles.length + pdfFiles.length > BULK_UPLOAD_LIMITS.maxFiles) {
        return { files: [], error: 'Maksimum 50 file per upload' };
    }
    const aggregateBytes = [...existingFiles, ...pdfFiles]
        .reduce((total, file) => total + file.size, 0);
    if (aggregateBytes > BULK_UPLOAD_LIMITS.maxBatchBytes) {
        return { files: [], error: 'Ukuran total satu batch tidak boleh melebihi 100 MB' };
    }
    return {
        files: pdfFiles,
        error: pdfFiles.length !== candidates.length
            ? 'Beberapa file diabaikan karena bukan PDF'
            : null,
    };
}

function getUploadErrorMessage(error, fallback) {
    const body = error?.response?.data || error?.data;
    if (body?.error) return body.error;
    if (Array.isArray(body?.errors) && body.errors.length > 0) {
        return body.errors
            .map((item) => typeof item === 'string' ? item : item?.message)
            .filter(Boolean)
            .join('; ');
    }
    return error?.message || fallback;
}

export function useOCRUpload(unitKerjaId) {
    const [files, setFiles] = useState([]);
    const [batchId, setBatchId] = useState(null);
    const [batch, setBatch] = useState(null);
    const [isUploading, setIsUploading] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [restoredUnitKerjaId, setRestoredUnitKerjaId] = useState(null);
    const [error, setError] = useState(null);

    const pollingRef = useRef(null);
    const pollingGenerationRef = useRef(0);
    const resumeRequestRef = useRef(0);
    const uploadGenerationRef = useRef(0);
    const stopPolling = useCallback(() => {
        pollingGenerationRef.current += 1;
        if (pollingRef.current) {
            clearTimeout(pollingRef.current);
            pollingRef.current = null;
        }
    }, []);

    // Add files
    const addFiles = useCallback((newFiles) => {
        const validation = validateNewBulkFiles(files, newFiles);
        if (validation.files.length === 0 && validation.error) {
            setError(validation.error);
            return;
        }
        setFiles((prev) => [...prev, ...validation.files]);
        setError(validation.error);
    }, [files]);

    // Remove file
    const removeFile = useCallback((index) => {
        setFiles((prev) => prev.filter((_, i) => i !== index));
    }, []);

    // Clear all files
    const clearFiles = useCallback(async () => {
        // Invalidate an upload response that may already be in flight. The
        // request itself cannot be reliably aborted once the server has begun
        // persisting Blob objects, so its completion path performs a best-effort
        // tombstone instead of reviving the cleared batch in local state.
        uploadGenerationRef.current += 1;
        resumeRequestRef.current += 1;
        stopPolling();
        setIsUploading(false);
        setIsProcessing(false);
        setRestoredUnitKerjaId(unitKerjaId || null);
        if (batchId) {
            try {
                await bulkUploadService.cancelBatch(batchId);
            } catch (err) {
                setError(getUploadErrorMessage(err, 'Gagal membatalkan batch'));
                return false;
            }
        }
        setFiles([]);
        setBatchId(null);
        setBatch(null);
        setError(null);
        return true;
    }, [batchId, stopPolling, unitKerjaId]);

    // Upload files
    const upload = useCallback(async () => {
        if (!unitKerjaId) {
            setError('Pilih unit kerja tujuan sebelum mengunggah arsip');
            return null;
        }
        if (files.length === 0) {
            setError('Tidak ada file untuk diupload');
            return null;
        }

        // A slow recovery request must never overwrite a newly-created batch.
        // The separate upload generation lets clearFiles invalidate this
        // request without confusing it with durable-batch recovery requests.
        const uploadGeneration = uploadGenerationRef.current + 1;
        uploadGenerationRef.current = uploadGeneration;
        resumeRequestRef.current += 1;
        setRestoredUnitKerjaId(unitKerjaId);
        setIsUploading(true);
        setError(null);

        try {
            const result = await bulkUploadService.uploadFiles(files, unitKerjaId);
            if (uploadGenerationRef.current !== uploadGeneration) {
                if (result?.batchId) {
                    try {
                        await bulkUploadService.cancelBatch(result.batchId);
                    } catch (cancelError) {
                        console.warn('Failed to tombstone stale bulk-upload batch:', cancelError);
                    }
                }
                return null;
            }
            setBatchId(result.batchId);
            setIsUploading(false);
            setIsProcessing(true);
            return result.batchId;
        } catch (err) {
            const activeBatch = err?.response?.data?.data?.activeBatch;
            if (uploadGenerationRef.current !== uploadGeneration) {
                // A conflict points at a pre-existing batch, possibly active in
                // another tab. Ignore it here; only a successful response proves
                // this stale request created the batch that should be tombstoned.
                return null;
            }
            if (err?.status === 409 && activeBatch) {
                setFiles([]);
                setBatchId(activeBatch.batchId);
                setBatch(activeBatch);
                setIsProcessing(['pending', 'processing'].includes(activeBatch.status));
                setError('Batch aktif yang sudah tersimpan telah dipulihkan');
                setIsUploading(false);
                return activeBatch.batchId;
            }
            setError(getUploadErrorMessage(err, 'Upload gagal'));
            setIsUploading(false);
            return null;
        }
    }, [files, unitKerjaId]);

    // Recover the newest durable batch for the selected owner/unit. Completed
    // batches reopen in review mode; unfinished batches resume sequential OCR.
    useEffect(() => {
        const requestId = resumeRequestRef.current + 1;
        resumeRequestRef.current = requestId;
        let cancelled = false;

        stopPolling();

        if (!unitKerjaId) {
            return () => { cancelled = true; };
        }

        bulkUploadService.getLatestActiveBatch(unitKerjaId)
            .then((activeBatch) => {
                if (cancelled || resumeRequestRef.current !== requestId) return;
                setFiles([]);
                setBatchId(activeBatch?.batchId || null);
                setBatch(activeBatch || null);
                setIsProcessing(Boolean(
                    activeBatch && ['pending', 'processing'].includes(activeBatch.status),
                ));
                setError(null);
                setRestoredUnitKerjaId(unitKerjaId);
            })
            .catch((err) => {
                if (!cancelled && resumeRequestRef.current === requestId) {
                    setFiles([]);
                    setBatchId(null);
                    setBatch(null);
                    setIsProcessing(false);
                    setError(getUploadErrorMessage(err, 'Gagal memulihkan batch aktif'));
                    setRestoredUnitKerjaId(unitKerjaId);
                }
            });

        return () => { cancelled = true; };
    }, [unitKerjaId, stopPolling]);

    const isResuming = Boolean(unitKerjaId) && restoredUnitKerjaId !== unitKerjaId;
    const scopedBatch = restoredUnitKerjaId === unitKerjaId ? batch : null;
    const scopedBatchId = restoredUnitKerjaId === unitKerjaId ? batchId : null;
    const scopedIsProcessing = restoredUnitKerjaId === unitKerjaId ? isProcessing : false;

    // Poll batch status
    const pollBatchStatus = useCallback(async (id, generation) => {
        try {
            const result = await bulkUploadService.processBatch(id);
            if (pollingGenerationRef.current !== generation) {
                return { terminal: true, delayMs: 0 };
            }
            setBatch(result);

            if (['completed', 'partial'].includes(result.status)) {
                setIsProcessing(false);
                stopPolling();
                return { terminal: true, delayMs: 0 };
            }
            return { terminal: false, delayMs: OCR_PROCESS_INTERVAL_MS };
        } catch (err) {
            if (pollingGenerationRef.current !== generation) {
                return { terminal: true, delayMs: 0 };
            }
            const status = err?.status || err?.response?.status;
            if (status === 404 || status === 409) {
                setBatchId(null);
                setBatch(null);
                setIsProcessing(false);
                setError(status === 404
                    ? 'Batch tidak lagi tersedia. Muat ulang atau unggah batch baru.'
                    : 'Batch sudah ditutup atau kedaluwarsa. Unggah batch baru bila diperlukan.');
                stopPolling();
                return { terminal: true, delayMs: 0 };
            }
            // 429 covers the per-user request limiter; 503 covers the
            // database-backed global Tesseract semaphore. Both responses are
            // explicitly retryable and provide the same Retry-After contract.
            if (status === 429 || status === 503) {
                return { terminal: false, delayMs: getOCRRetryDelayMs(err) };
            }
            console.error('Error polling batch status:', err);
            return { terminal: false, delayMs: OCR_PROCESS_INTERVAL_MS };
        }
    }, [stopPolling]);

    // Start polling when batchId changes
    useEffect(() => {
        if (batchId && isProcessing) {
            let cancelled = false;
            const generation = pollingGenerationRef.current + 1;
            pollingGenerationRef.current = generation;
            const pollSequentially = async () => {
                const outcome = await pollBatchStatus(batchId, generation);
                if (
                    !cancelled
                    && pollingGenerationRef.current === generation
                    && !outcome.terminal
                ) {
                    pollingRef.current = window.setTimeout(
                        pollSequentially,
                        outcome.delayMs,
                    );
                }
            };
            pollingRef.current = window.setTimeout(pollSequentially, 0);

            return () => {
                cancelled = true;
                if (pollingGenerationRef.current === generation) {
                    pollingGenerationRef.current += 1;
                }
                if (pollingRef.current) {
                    clearTimeout(pollingRef.current);
                    pollingRef.current = null;
                }
            };
        }
    }, [batchId, isProcessing, pollBatchStatus]);

    // Confirm batch
    const confirmBatch = useCallback(async (confirmedItems) => {
        if (!batchId) {
            setError('Tidak ada batch untuk dikonfirmasi');
            return null;
        }

        try {
            const result = await bulkUploadService.confirmBatch(batchId, confirmedItems);
            return result;
        } catch (err) {
            setError(getUploadErrorMessage(err, 'Gagal menyimpan arsip'));
            return null;
        }
    }, [batchId]);

    // Calculate progress
    const progress = scopedBatch ? {
        total: scopedBatch.totalFiles,
        processed: scopedBatch.processedFiles,
        completed: scopedBatch.items?.filter((i) => i.status === 'completed').length || 0,
        failed: scopedBatch.items?.filter((i) => i.status === 'failed').length || 0,
        percentage: scopedBatch.totalFiles > 0
            ? Math.round((scopedBatch.processedFiles / scopedBatch.totalFiles) * 100)
            : 0,
    } : null;

    return {
        files,
        batch: scopedBatch,
        batchId: scopedBatchId,
        isUploading,
        isProcessing: scopedIsProcessing,
        isResuming,
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
