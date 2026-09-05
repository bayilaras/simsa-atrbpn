import { useEffect, useRef, useState } from 'react';
import { FileText, Download, ExternalLink, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { fetchPrivateFile } from '@/services/private-file.service';
import { useAppConfig } from '@/context/app-config-context';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

function PrivateFilePreview({ surat, entityType }) {
    const [file, setFile] = useState(null);
    const [loading, setLoading] = useState(null);
    const [error, setError] = useState('');
    const request = useRef(null);
    const objectUrl = useRef(null);
    const downloadUrls = useRef(new Map());
    const fileName = surat.fileOriginalName || 'dokumen-lampiran';
    const endpoint = `/api/files/${entityType}/${encodeURIComponent(surat.id)}`;

    useEffect(() => () => {
        request.current?.abort();
        if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
        for (const [url, timer] of downloadUrls.current) {
            window.clearTimeout(timer);
            URL.revokeObjectURL(url);
        }
        downloadUrls.current.clear();
    }, []);

    const loadFile = async () => {
        if (request.current) return;
        const controller = new AbortController();
        request.current = controller;
        setLoading('preview');
        setError('');
        try {
            const blob = await fetchPrivateFile(endpoint, {
                signal: controller.signal,
            });
            if (controller.signal.aborted) return;
            const url = URL.createObjectURL(blob);
            objectUrl.current = url;
            setFile({ url, type: blob.type.split(';', 1)[0].toLowerCase() });
        } catch (failure) {
            if (!controller.signal.aborted) setError(failure.message || 'Dokumen belum dapat dimuat.');
        } finally {
            if (!controller.signal.aborted) {
                request.current = null;
                setLoading(null);
            }
        }
    };

    const downloadFile = async () => {
        if (request.current) return;
        const controller = new AbortController();
        request.current = controller;
        setLoading('download');
        setError('');
        try {
            // A view grant is not a download grant. Re-authorize and audit the
            // explicit download on the server instead of reusing preview bytes.
            const blob = await fetchPrivateFile(`${endpoint}?download=1`, { signal: controller.signal });
            if (controller.signal.aborted) return;
            const url = URL.createObjectURL(blob);
            // Keep the bytes alive long enough for the browser to start saving.
            // The timeout and unmount cleanup both release the object URL.
            const timer = window.setTimeout(() => {
                URL.revokeObjectURL(url);
                downloadUrls.current.delete(url);
            }, 60_000);
            downloadUrls.current.set(url, timer);
            const link = document.createElement('a');
            try {
                link.href = url;
                link.download = fileName;
                document.body.appendChild(link);
                link.click();
            } finally {
                link.remove();
            }
        } catch (failure) {
            if (!controller.signal.aborted) setError(failure.message || 'Dokumen belum dapat diunduh.');
        } finally {
            if (!controller.signal.aborted) {
                request.current = null;
                setLoading(null);
            }
        }
    };

    const canPreview = file?.type === 'application/pdf' || IMAGE_TYPES.has(file?.type);

    return (
        <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden">
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    Dokumen Lampiran
                </CardTitle>
                <CardDescription>
                    <span className="font-mono text-xs bg-muted px-2 py-1 rounded">{fileName}</span>
                </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
                {error && <p role="alert" className="p-4 text-sm text-destructive">{error}</p>}
                <div className="border-t bg-muted/20">
                    {!file ? (
                        <div className="flex flex-col items-center gap-3 p-8">
                            <p className="text-sm text-muted-foreground">Muat pratinjau atau langsung unduh dokumen. Maksimum 50 MB.</p>
                            <Button type="button" variant="outline" onClick={loadFile} disabled={Boolean(loading)}>
                                {loading === 'preview' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {loading === 'preview' ? 'Memuat dokumen...' : 'Muat dokumen'}
                            </Button>
                        </div>
                    ) : file.type === 'application/pdf' ? (
                        <iframe src={`${file.url}#toolbar=1&navpanes=0`} className="w-full h-[600px]" title="PDF Preview" />
                    ) : IMAGE_TYPES.has(file.type) ? (
                        <div className="flex justify-center p-6">
                            <img src={file.url} alt={fileName} className="max-w-full max-h-[600px] object-contain rounded-lg shadow-xl" />
                        </div>
                    ) : (
                        <p className="p-8 text-center text-muted-foreground">Preview tidak tersedia untuk file ini. Download untuk melihat isi dokumen.</p>
                    )}
                </div>
                <div className="flex gap-2 p-4 border-t bg-muted/10">
                    <Button type="button" variant="outline" className="flex-1" onClick={downloadFile} disabled={Boolean(loading)}>
                        <Download className="mr-2 h-4 w-4" />{loading === 'download' ? 'Mengunduh...' : 'Download'}
                    </Button>
                    {canPreview && (
                        <Button variant="outline" className="flex-1" asChild>
                            <a href={file.url} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="mr-2 h-4 w-4" />Buka di Tab Baru
                            </a>
                        </Button>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

export function FilePreviewSection({ surat, entityType = 'surat_masuk' }) {
    const { capabilities } = useAppConfig();
    if (!capabilities.files || !surat?.filePath) return null;
    return <PrivateFilePreview key={`${entityType}:${surat.id}:${surat.filePath}`} surat={surat} entityType={entityType} />;
}
