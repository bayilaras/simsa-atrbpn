import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FilePreviewSection } from '../FilePreviewSection';
import { AppConfigContext, DISABLED_FEATURES } from '@/context/app-config-context';

vi.mock('@/lib/cloud-provider-config', () => ({ USE_FIREBASE_AUTH: true }));
vi.mock('@/lib/firebase-client', () => ({
    getFirebaseAppCheckToken: vi.fn().mockResolvedValue('test-app-check'),
    getFirebaseLimitedUseAppCheckToken: vi.fn(),
}));

const surat = { id: 'surat/a', filePath: 'gcs://private-bucket/file.pdf', fileOriginalName: 'arsip.pdf' };

describe('private file preview', () => {
    let createObjectURL;
    let revokeObjectURL;

    beforeEach(() => {
        createObjectURL = vi.fn().mockReturnValue('blob:http://localhost:3000/private-preview');
        revokeObjectURL = vi.fn();
        vi.stubGlobal('URL', class extends URL {
            static createObjectURL = createObjectURL;
            static revokeObjectURL = revokeObjectURL;
        });
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it.each(['surat_masuk', 'surat_keluar'])('loads %s only on demand with App Check and revokes its URL on close', async (entityType) => {
        const blob = new Blob(['%PDF-1.7'], { type: 'application/pdf' });
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true, status: 200, headers: new Headers(), blob: async () => blob,
        });
        vi.stubGlobal('fetch', fetchMock);
        const { unmount } = render(<FilePreviewSection surat={surat} entityType={entityType} />);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(screen.queryByTitle('PDF Preview')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Muat dokumen' }));
        expect(await screen.findByTitle('PDF Preview')).toHaveAttribute('src', 'blob:http://localhost:3000/private-preview#toolbar=1&navpanes=0');
        expect(fetchMock).toHaveBeenCalledWith(`/api/files/${entityType}/surat%2Fa`, expect.objectContaining({
            credentials: 'include', cache: 'no-store',
            headers: expect.objectContaining({ 'X-Firebase-AppCheck': 'test-app-check' }),
        }));
        expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled();
        expect(createObjectURL).toHaveBeenCalledWith(blob);
        unmount();
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost:3000/private-preview');
    });

    it('re-authorizes each download instead of bypassing a view-only grant with the preview blob', async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce({
            ok: true, status: 200, headers: new Headers(),
            blob: async () => new Blob(['pdf'], { type: 'application/pdf' }),
        }).mockResolvedValueOnce({
            ok: false, status: 403, headers: new Headers(),
            json: async () => ({ message: 'Persetujuan hanya mengizinkan penayangan, bukan pengunduhan.' }),
        });
        vi.stubGlobal('fetch', fetchMock);
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
        render(<FilePreviewSection surat={surat} />);
        fireEvent.click(screen.getByRole('button', { name: 'Muat dokumen' }));
        await screen.findByTitle('PDF Preview');
        fireEvent.click(screen.getByRole('button', { name: 'Download' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Persetujuan hanya mengizinkan penayangan');
        expect(fetchMock).toHaveBeenLastCalledWith('/api/files/surat_masuk/surat%2Fa?download=1', expect.objectContaining({
            credentials: 'include', headers: expect.objectContaining({ 'X-Firebase-AppCheck': 'test-app-check' }),
        }));
        expect(click).not.toHaveBeenCalled();
        expect(createObjectURL).toHaveBeenCalledOnce();
    });

    it('downloads independently of preview and retains bytes until cleanup', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true, status: 200, headers: new Headers(),
            blob: async () => new Blob(['pdf'], { type: 'application/pdf' }),
        });
        vi.stubGlobal('fetch', fetchMock);
        createObjectURL.mockReturnValueOnce('blob:download');
        let download;
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
            download = { href: this.href, filename: this.download };
        });
        const { unmount } = render(<FilePreviewSection surat={surat} />);
        fireEvent.click(screen.getByRole('button', { name: 'Download' }));
        await waitFor(() => expect(download).toEqual({ href: 'blob:download', filename: 'arsip.pdf' }));
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(fetchMock.mock.calls[0][0]).toBe('/api/files/surat_masuk/surat%2Fa?download=1');
        expect(screen.queryByTitle('PDF Preview')).not.toBeInTheDocument();
        expect(revokeObjectURL).not.toHaveBeenCalled();
        unmount();
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:download');
        expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:http://localhost:3000/private-preview');
    });

    it('aborts a pending request when the user leaves the document', async () => {
        let signal;
        const fetchMock = vi.fn().mockImplementation((_url, options) => {
            signal = options.signal;
            return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
        });
        vi.stubGlobal('fetch', fetchMock);
        const { unmount } = render(<FilePreviewSection surat={surat} />);
        fireEvent.click(screen.getByRole('button', { name: 'Muat dokumen' }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
        unmount();
        expect(signal.aborted).toBe(true);
        expect(createObjectURL).not.toHaveBeenCalled();
    });

    it('shows access failures and allows retry without exposing a storage locator', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false, status: 403, headers: new Headers(), json: async () => ({ error: 'Dokumen masih dikarantina.' }),
        }));
        render(<FilePreviewSection surat={surat} />);
        fireEvent.click(screen.getByRole('button', { name: 'Muat dokumen' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Dokumen masih dikarantina.');
        expect(screen.getByRole('button', { name: 'Muat dokumen' })).toBeEnabled();
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
        expect(createObjectURL).not.toHaveBeenCalled();
    });

    it('does not render active HTML inline even when its filename ends with .pdf', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true, status: 200, headers: new Headers(),
            blob: async () => new Blob(['<h1>not a PDF</h1>'], { type: 'text/html' }),
        }));
        render(<FilePreviewSection surat={surat} />);
        fireEvent.click(screen.getByRole('button', { name: 'Muat dokumen' }));
        await waitFor(() => expect(createObjectURL).toHaveBeenCalledOnce());
        expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled();
        expect(screen.queryByTitle('PDF Preview')).not.toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Buka di Tab Baru' })).not.toBeInTheDocument();
    });

    it('does not expose original-file controls when runtime capabilities disable files', () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const { container } = render(
            <AppConfigContext.Provider value={{
                features: DISABLED_FEATURES,
                capabilities: { metadata: true, files: false, externalIntegrations: false },
                mode: 'metadata-demo',
                compatible: true,
                loading: false,
            }}>
                <FilePreviewSection surat={surat} />
            </AppConfigContext.Provider>,
        );

        expect(container).toBeEmptyDOMElement();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
