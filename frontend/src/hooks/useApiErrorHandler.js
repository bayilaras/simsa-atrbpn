import { useCallback } from 'react';
import { useToast } from './use-toast';

/**
 * Custom hook for handling API errors consistently across the app.
 * Categorizes errors and displays appropriate toast notifications.
 *
 * Usage:
 *   const { handleError } = useApiErrorHandler();
 *   try { await api.post('/api/...', data); }
 *   catch (err) { handleError(err, 'Gagal menyimpan surat'); }
 */
export function useApiErrorHandler() {
    const { toast } = useToast();

    const handleError = useCallback((error, fallbackMessage = 'Terjadi kesalahan') => {
        const message = error?.message || fallbackMessage;

        // Categorize error for appropriate styling
        let variant = 'destructive';
        let title = 'Error';

        if (message.includes('koneksi') || message.includes('terhubung')) {
            title = 'Koneksi Terputus';
            variant = 'destructive';
        } else if (message.includes('izin') || message.includes('Forbidden')) {
            title = 'Akses Ditolak';
        } else if (message.includes('Terlalu banyak')) {
            title = 'Batas Permintaan';
            variant = 'destructive';
        } else if (message.includes('Sesi telah berakhir')) {
            // 401 is already handled in api.js with redirect, but show a toast too
            title = 'Sesi Berakhir';
        } else if (message.includes('server')) {
            title = 'Kesalahan Server';
        }

        toast({
            title,
            description: message,
            variant,
        });

        // Log for debugging in development
        if (import.meta.env.DEV) {
            console.error(`[ApiError] ${title}:`, error);
        }
    }, [toast]);

    return { handleError };
}

export default useApiErrorHandler;
