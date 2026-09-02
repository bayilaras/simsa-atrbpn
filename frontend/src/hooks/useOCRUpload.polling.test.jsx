import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({
    uploadFiles: vi.fn(),
    getLatestActiveBatch: vi.fn(),
    processBatch: vi.fn(),
    confirmBatch: vi.fn(),
    cancelBatch: vi.fn(),
}));

vi.mock('../services/bulk-upload.service', () => ({ bulkUploadService: service }));

import {
    OCR_PROCESS_INTERVAL_MS,
    useOCRUpload,
} from './useOCRUpload';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

describe('useOCRUpload sequential processing', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        service.uploadFiles.mockResolvedValue({ batchId: 'batch-1' });
        service.getLatestActiveBatch.mockResolvedValue(null);
        service.cancelBatch.mockResolvedValue({ blobsFailed: 0 });
    });

    afterEach(() => vi.useRealTimers());

    it('never overlaps OCR requests and cancels future polling on unmount', async () => {
        const first = deferred();
        const second = deferred();
        service.processBatch
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        const { result, unmount } = renderHook(() => useOCRUpload('unit-a'));

        act(() => result.current.addFiles([
            new File(['%PDF-'], 'archive.pdf', { type: 'application/pdf' }),
        ]));
        await act(() => result.current.upload());
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        expect(service.processBatch).toHaveBeenCalledTimes(1);

        await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
        expect(service.processBatch).toHaveBeenCalledTimes(1);

        await act(async () => {
            first.resolve({ status: 'processing', items: [], totalFiles: 1, processedFiles: 0 });
            await Promise.resolve();
        });
        await act(async () => { await vi.advanceTimersByTimeAsync(OCR_PROCESS_INTERVAL_MS); });
        expect(service.processBatch).toHaveBeenCalledTimes(2);

        unmount();
        second.resolve({ status: 'processing', items: [], totalFiles: 1, processedFiles: 0 });
        await act(async () => { await Promise.resolve(); });
        await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
        expect(service.processBatch).toHaveBeenCalledTimes(2);
    });

    it('restores a completed durable batch after mount without mutating OCR state', async () => {
        service.getLatestActiveBatch.mockResolvedValue({
            batchId: 'persisted-batch',
            status: 'completed',
            totalFiles: 1,
            processedFiles: 1,
            items: [{ id: 'item-1', status: 'completed' }],
        });

        const { result } = renderHook(() => useOCRUpload('unit-a'));
        await act(async () => { await Promise.resolve(); });

        expect(service.getLatestActiveBatch).toHaveBeenCalledWith('unit-a');
        expect(result.current.batchId).toBe('persisted-batch');
        expect(result.current.batch).toMatchObject({ status: 'completed' });
        expect(result.current.isResuming).toBe(false);
        expect(result.current.isProcessing).toBe(false);
        expect(service.processBatch).not.toHaveBeenCalled();
    });

    it('resumes sequential processing for a persisted unfinished batch', async () => {
        service.getLatestActiveBatch.mockResolvedValue({
            batchId: 'persisted-batch',
            status: 'pending',
            totalFiles: 1,
            processedFiles: 0,
            items: [{ id: 'item-1', status: 'pending' }],
        });
        service.processBatch.mockResolvedValue({
            batchId: 'persisted-batch',
            status: 'completed',
            totalFiles: 1,
            processedFiles: 1,
            items: [{ id: 'item-1', status: 'completed' }],
        });

        const { result } = renderHook(() => useOCRUpload('unit-a'));
        await act(async () => { await Promise.resolve(); });
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });

        expect(service.processBatch).toHaveBeenCalledTimes(1);
        expect(result.current.batch).toMatchObject({ status: 'completed' });
        expect(result.current.isProcessing).toBe(false);
    });

    it('ignores a stale recovery response after the selected unit changes', async () => {
        const stale = deferred();
        service.getLatestActiveBatch
            .mockReturnValueOnce(stale.promise)
            .mockResolvedValueOnce({
                batchId: 'batch-unit-b',
                status: 'completed',
                totalFiles: 1,
                processedFiles: 1,
                items: [{ id: 'item-b', status: 'completed' }],
            });

        const { result, rerender } = renderHook(
            ({ unitKerjaId }) => useOCRUpload(unitKerjaId),
            { initialProps: { unitKerjaId: 'unit-a' } },
        );
        rerender({ unitKerjaId: 'unit-b' });
        await act(async () => { await Promise.resolve(); });
        expect(result.current.batchId).toBe('batch-unit-b');

        await act(async () => {
            stale.resolve({
                batchId: 'stale-unit-a',
                status: 'completed',
                totalFiles: 1,
                processedFiles: 1,
                items: [{ id: 'item-a', status: 'completed' }],
            });
            await Promise.resolve();
        });
        expect(result.current.batchId).toBe('batch-unit-b');
    });

    it('recovers the existing batch returned by a concurrent-upload conflict', async () => {
        const activeBatch = {
            batchId: 'existing-batch',
            status: 'completed',
            totalFiles: 1,
            processedFiles: 1,
            items: [{ id: 'existing-item', status: 'completed' }],
        };
        service.uploadFiles.mockRejectedValue(Object.assign(new Error('Conflict'), {
            status: 409,
            response: { data: { data: { activeBatch } } },
        }));
        const { result } = renderHook(() => useOCRUpload('unit-a'));
        await act(async () => { await Promise.resolve(); });
        act(() => result.current.addFiles([
            new File(['%PDF-'], 'archive.pdf', { type: 'application/pdf' }),
        ]));

        await act(() => result.current.upload());

        expect(result.current.batchId).toBe('existing-batch');
        expect(result.current.batch).toMatchObject({ status: 'completed' });
        expect(result.current.error).toMatch(/dipulihkan/);
    });

    it('tombstones an upload that finishes after the user clears local state', async () => {
        const pendingUpload = deferred();
        service.uploadFiles.mockReturnValueOnce(pendingUpload.promise);
        const { result } = renderHook(() => useOCRUpload('unit-a'));
        await act(async () => { await Promise.resolve(); });
        act(() => result.current.addFiles([
            new File(['%PDF-'], 'archive.pdf', { type: 'application/pdf' }),
        ]));

        let uploadPromise;
        act(() => {
            uploadPromise = result.current.upload();
        });
        expect(result.current.isUploading).toBe(true);

        await act(() => result.current.clearFiles());
        expect(result.current.files).toEqual([]);
        expect(result.current.isUploading).toBe(false);

        await act(async () => {
            pendingUpload.resolve({ batchId: 'stale-batch' });
            await uploadPromise;
        });

        expect(service.cancelBatch).toHaveBeenCalledWith('stale-batch');
        expect(result.current.batchId).toBeNull();
        expect(result.current.batch).toBeNull();
        expect(result.current.isProcessing).toBe(false);
        expect(service.processBatch).not.toHaveBeenCalled();
    });

    it('does not adopt or cancel a pre-existing batch from a stale upload conflict', async () => {
        const pendingUpload = deferred();
        service.uploadFiles.mockReturnValueOnce(pendingUpload.promise);
        const { result } = renderHook(() => useOCRUpload('unit-a'));
        await act(async () => { await Promise.resolve(); });
        act(() => result.current.addFiles([
            new File(['%PDF-'], 'archive.pdf', { type: 'application/pdf' }),
        ]));

        let uploadPromise;
        act(() => {
            uploadPromise = result.current.upload();
        });
        await act(() => result.current.clearFiles());

        await act(async () => {
            pendingUpload.reject(Object.assign(new Error('Conflict'), {
                status: 409,
                response: {
                    data: {
                        data: {
                            activeBatch: { batchId: 'stale-existing-batch', status: 'pending' },
                        },
                    },
                },
            }));
            await uploadPromise;
        });

        expect(service.cancelBatch).not.toHaveBeenCalled();
        expect(result.current.batchId).toBeNull();
        expect(result.current.isProcessing).toBe(false);
    });

    it.each([404, 409])('stops polling and clears an unavailable batch on HTTP %s', async (status) => {
        service.getLatestActiveBatch.mockResolvedValue({
            batchId: 'unavailable-batch',
            status: 'pending',
            totalFiles: 1,
            processedFiles: 0,
            items: [{ id: 'item-1', status: 'pending' }],
        });
        service.processBatch.mockRejectedValue(Object.assign(new Error('unsafe detail'), { status }));

        const { result } = renderHook(() => useOCRUpload('unit-a'));
        await act(async () => { await Promise.resolve(); });
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });

        expect(service.processBatch).toHaveBeenCalledTimes(1);
        expect(result.current.batch).toBeNull();
        expect(result.current.batchId).toBeNull();
        expect(result.current.isProcessing).toBe(false);
        expect(result.current.error).not.toContain('unsafe detail');

        await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
        expect(service.processBatch).toHaveBeenCalledTimes(1);
    });

    it.each([429, 503])(
        'honors Retry-After before continuing after a retryable OCR HTTP %s response',
        async (status) => {
            service.getLatestActiveBatch.mockResolvedValue({
                batchId: 'rate-limited-batch',
                status: 'pending',
                totalFiles: 1,
                processedFiles: 0,
                items: [{ id: 'item-1', status: 'pending' }],
            });
            service.processBatch
                .mockRejectedValueOnce(Object.assign(new Error('rate limited'), {
                    status,
                    response: {
                        status,
                        headers: new Headers({ 'Retry-After': '30' }),
                    },
                }))
                .mockResolvedValueOnce({
                    batchId: 'rate-limited-batch',
                    status: 'completed',
                    totalFiles: 1,
                    processedFiles: 1,
                    items: [{ id: 'item-1', status: 'completed' }],
                });

            const { result } = renderHook(() => useOCRUpload('unit-a'));
            await act(async () => { await Promise.resolve(); });
            await act(async () => { await vi.advanceTimersByTimeAsync(0); });
            expect(service.processBatch).toHaveBeenCalledTimes(1);

            await act(async () => { await vi.advanceTimersByTimeAsync(29_999); });
            expect(service.processBatch).toHaveBeenCalledTimes(1);

            await act(async () => { await vi.advanceTimersByTimeAsync(1); });
            expect(service.processBatch).toHaveBeenCalledTimes(2);
            expect(result.current.batch).toMatchObject({ status: 'completed' });
            expect(result.current.isProcessing).toBe(false);
        },
    );

    it('does not expose the previous unit processing state after unit scope is cleared', async () => {
        service.getLatestActiveBatch.mockResolvedValue({
            batchId: 'unit-a-batch',
            status: 'pending',
            totalFiles: 1,
            processedFiles: 0,
            items: [{ id: 'item-a', status: 'pending' }],
        });
        const { result, rerender } = renderHook(
            ({ unitKerjaId }) => useOCRUpload(unitKerjaId),
            { initialProps: { unitKerjaId: 'unit-a' } },
        );
        await act(async () => { await Promise.resolve(); });
        expect(result.current.isProcessing).toBe(true);

        rerender({ unitKerjaId: null });

        expect(result.current.batch).toBeNull();
        expect(result.current.batchId).toBeNull();
        expect(result.current.isProcessing).toBe(false);
        expect(result.current.isResuming).toBe(false);
    });
});
