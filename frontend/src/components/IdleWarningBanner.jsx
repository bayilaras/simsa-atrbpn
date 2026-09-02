import { useAuth } from '../context/AuthContext';
import { AlertTriangle, X } from 'lucide-react';

export function IdleWarningBanner() {
    const { idleWarning, dismissIdleWarning, signOut } = useAuth();

    if (!idleWarning) return null;

    return (
        <div
            role="alert"
            aria-live="assertive"
            className="fixed top-0 left-0 right-0 z-[100] bg-amber-500 text-amber-950 px-4 py-3 shadow-lg animate-in slide-in-from-top duration-300"
        >
            <div className="flex items-center justify-center gap-3 max-w-4xl mx-auto">
                <AlertTriangle className="h-5 w-5 shrink-0" />
                <span className="text-sm font-medium">
                    Sesi Anda akan berakhir dalam 5 menit karena tidak ada aktivitas.
                </span>
                <button
                    onClick={dismissIdleWarning}
                    className="ml-2 px-3 py-1 text-xs font-semibold bg-amber-700 text-white rounded hover:bg-amber-800 transition-colors"
                >
                    Tetap Masuk
                </button>
                <button
                    onClick={signOut}
                    className="px-3 py-1 text-xs font-semibold bg-card/20 text-amber-950 rounded hover:bg-card/30 transition-colors"
                >
                    Keluar Sekarang
                </button>
                <button
                    onClick={dismissIdleWarning}
                    className="ml-1 p-1 rounded hover:bg-amber-600 transition-colors"
                    aria-label="Tutup peringatan"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>
        </div>
    );
}
