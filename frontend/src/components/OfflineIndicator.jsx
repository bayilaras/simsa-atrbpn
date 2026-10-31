import { useState, useEffect, useRef } from 'react';
import { WifiOff, CheckCircle } from 'lucide-react';
import { isOnline, onConnectivityChange } from '@/lib/offline-storage';

/**
 * Offline Indicator Component
 * Shows connection status. Sensitive archival data is never cached offline.
 */
export function OfflineIndicator() {
    const [online, setOnline] = useState(isOnline());
    const [showBanner, setShowBanner] = useState(false);
    const [justReconnected, setJustReconnected] = useState(false);
    const dismissTimer = useRef(null);

    useEffect(() => {
        const cleanup = onConnectivityChange((isOnline) => {
            clearTimeout(dismissTimer.current);
            setOnline(isOnline);
            setJustReconnected(isOnline);

            if (isOnline) {
                // Show "back online" message briefly
                setShowBanner(true);
                dismissTimer.current = setTimeout(() => {
                    setJustReconnected(false);
                    setShowBanner(false);
                }, 3000);
            } else {
                // Show offline banner
                setShowBanner(true);
            }
        });

        return () => {
            clearTimeout(dismissTimer.current);
            cleanup();
        };
    }, []);

    // Don't show anything if online and not just reconnected
    if (online && !showBanner) {
        return null;
    }

    return (
        <div
            role="status"
            aria-live="polite"
            className={`fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-lg rounded-lg border px-4 py-3 shadow-sm flex items-center gap-2 text-sm font-medium ${justReconnected
                    ? 'border-green-200 bg-green-50 text-green-950'
                    : 'border-amber-200 bg-amber-50 text-amber-950'
                }`}
        >
            {justReconnected ? (
                <>
                    <CheckCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>Kembali online</span>
                </>
            ) : (
                <>
                    <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>Koneksi terputus. Sambungkan kembali untuk memuat atau menyimpan data arsip.</span>
                </>
            )}
        </div>
    );
}

export default OfflineIndicator;
