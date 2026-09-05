import api from './api';

// Matches the largest supported source/bulk-upload file. A corrupt or missing
// Content-Length must not let a preview buffer an unlimited response in memory.
export const MAX_PRIVATE_FILE_BYTES = 50 * 1024 * 1024;

export async function readPrivateFileResponse(response, { maxBytes = MAX_PRIVATE_FILE_BYTES, signal } = {}) {
    const tooLarge = () => new Error(`Dokumen melebihi batas pratinjau ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
    if (Number(response.headers.get('Content-Length')) > maxBytes) {
        await response.body?.cancel();
        throw tooLarge();
    }

    if (!response.body?.getReader) {
        const blob = await response.blob();
        signal?.throwIfAborted();
        if (blob.size > maxBytes) throw tooLarge();
        return blob;
    }

    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
        while (true) {
            signal?.throwIfAborted();
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maxBytes) throw tooLarge();
            chunks.push(value);
        }
        signal?.throwIfAborted();
        return new Blob(chunks, { type: response.headers.get('Content-Type') || 'application/octet-stream' });
    } catch (error) {
        await reader.cancel().catch(() => undefined);
        throw error;
    } finally {
        reader.releaseLock();
    }
}

export async function fetchPrivateFile(endpoint, { signal } = {}) {
    const response = await api.get(endpoint, {}, { responseType: 'response', cache: 'no-store', signal });
    return readPrivateFileResponse(response, { signal });
}
