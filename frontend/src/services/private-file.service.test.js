import { describe, expect, it, vi } from 'vitest';
import { readPrivateFileResponse } from './private-file.service';

describe('bounded private document reading', () => {
    it('rejects an oversized Content-Length before reading any bytes', async () => {
        const cancel = vi.fn().mockResolvedValue(undefined);
        const blob = vi.fn();
        await expect(readPrivateFileResponse({
            headers: new Headers({ 'Content-Length': '11' }), body: { cancel }, blob,
        }, { maxBytes: 10 })).rejects.toThrow(/melebihi batas/);
        expect(cancel).toHaveBeenCalledOnce();
        expect(blob).not.toHaveBeenCalled();
    });

    it('bounds chunked responses even when Content-Length is missing or false', async () => {
        const reader = {
            read: vi.fn().mockResolvedValueOnce({ value: new Uint8Array(8) })
                .mockResolvedValueOnce({ value: new Uint8Array(8) }),
            cancel: vi.fn().mockResolvedValue(undefined), releaseLock: vi.fn(),
        };
        await expect(readPrivateFileResponse({
            headers: new Headers({ 'Content-Length': '1' }), body: { getReader: () => reader },
        }, { maxBytes: 10 })).rejects.toThrow(/melebihi batas/);
        expect(reader.cancel).toHaveBeenCalledOnce();
        expect(reader.releaseLock).toHaveBeenCalledOnce();
    });

    it('returns a bounded blob with the backend-verified MIME type', async () => {
        const reader = {
            read: vi.fn().mockResolvedValueOnce({ value: new Uint8Array([37, 80, 68, 70]) })
                .mockResolvedValueOnce({ done: true }),
            cancel: vi.fn(), releaseLock: vi.fn(),
        };
        const result = await readPrivateFileResponse({
            headers: new Headers({ 'Content-Type': 'application/pdf' }), body: { getReader: () => reader },
        }, { maxBytes: 10 });
        expect(result.size).toBe(4);
        expect(result.type).toBe('application/pdf');
        expect(reader.cancel).not.toHaveBeenCalled();
        expect(reader.releaseLock).toHaveBeenCalledOnce();
    });
});
