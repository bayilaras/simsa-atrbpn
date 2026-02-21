import { FileText, Download, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { API_BASE_URL } from '@/services/api';

export function FilePreviewSection({ surat }) {
    const getFileUrl = (filePath) => {
        if (!filePath) return null;
        if (filePath.startsWith('http')) return filePath;
        // Vercel Blob files stored as "blob:{url}" — use URL directly (public access)
        if (filePath.startsWith('blob:')) {
            return filePath.replace('blob:', '');
        }
        // Legacy Google Drive files stored as "gdrive:{fileId}" — route through proxy
        if (filePath.startsWith('gdrive:')) {
            const fileId = filePath.replace('gdrive:', '');
            return `/api/drive-file/${fileId}`;
        }
        // Legacy: local uploads go through Vercel proxy rewrite
        if (filePath.startsWith('/uploads')) return filePath;
        return `${API_BASE_URL}${filePath}`;
    };

    const getFileExtension = (filename) => {
        if (!filename) return '';
        return filename.split('.').pop()?.toLowerCase() || '';
    };

    const isPdf = (filename) => {
        return getFileExtension(filename) === 'pdf';
    };

    const isImage = (filename) => {
        const ext = getFileExtension(filename);
        return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
    };

    const fileUrl = getFileUrl(surat.filePath);
    const fileName = surat.fileOriginalName || surat.filePath?.split('/').pop();

    if (!fileUrl) return null;

    return (
        <Card className="shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden">
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-blue-600" />
                    Dokumen Lampiran
                </CardTitle>
                <CardDescription className="flex items-center gap-2">
                    <span className="font-mono text-xs bg-muted px-2 py-1 rounded">{fileName}</span>
                </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
                {/* File Preview */}
                <div className="border-t bg-muted/20">
                    {isPdf(fileName) ? (
                        <iframe
                            src={`${fileUrl}#toolbar=1&navpanes=0`}
                            className="w-full h-[600px]"
                            title="PDF Preview"
                        />
                    ) : isImage(fileName) ? (
                        <div className="flex justify-center p-6 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2220%22%20height%3D%2220%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cdefs%3E%3Cpattern%20id%3D%22grid%22%20width%3D%2220%22%20height%3D%2220%22%20patternUnits%3D%22userSpaceOnUse%22%3E%3Crect%20width%3D%2210%22%20height%3D%2210%22%20fill%3D%22%23f0f0f0%22%2F%3E%3Crect%20x%3D%2210%22%20y%3D%2210%22%20width%3D%2210%22%20height%3D%2210%22%20fill%3D%22%23f0f0f0%22%2F%3E%3C%2Fpattern%3E%3C%2Fdefs%3E%3Crect%20fill%3D%22url(%23grid)%22%20width%3D%22100%25%22%20height%3D%22100%25%22%2F%3E%3C%2Fsvg%3E')]">
                            <img
                                src={fileUrl}
                                alt={fileName}
                                className="max-w-full max-h-[600px] object-contain rounded-lg shadow-xl"
                            />
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-16">
                            <div className="bg-muted p-4 rounded-full mb-4">
                                <FileText className="h-12 w-12 text-muted-foreground" />
                            </div>
                            <p className="text-muted-foreground mb-2">Preview tidak tersedia untuk file ini</p>
                            <p className="text-sm text-muted-foreground">Download file untuk melihat isi dokumen</p>
                        </div>
                    )}
                </div>

                {/* Download/Open Buttons */}
                <div className="flex gap-2 p-4 border-t bg-muted/10">
                    <Button variant="outline" className="flex-1" asChild>
                        <a href={fileUrl} download={fileName}>
                            <Download className="mr-2 h-4 w-4" />
                            Download
                        </a>
                    </Button>
                    <Button variant="outline" className="flex-1" asChild>
                        <a href={fileUrl} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="mr-2 h-4 w-4" />
                            Buka di Tab Baru
                        </a>
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
