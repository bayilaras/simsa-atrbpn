import { useState, useEffect } from 'react';
import { WifiOff, Wifi, RefreshCw, CheckCircle } from 'lucide-react';
import { isOnline, onConnectivityChange } from '@/lib/offline-storage';

/**
 * Offline Indicator Component
 * Shows connection status and cached data info
 */
export function OfflineIndicator() {
    const [online, setOnline] = useState(isOnline());
    const [showBanner, setShowBanner] = useState(false);
    const [justReconnected, setJustReconnected] = useState(false);

    useEffect(() => {
        const cleanup = onConnectivityChange((isOnline) => {
            setOnline(isOnline);

            if (isOnline) {
                // Show "back online" message briefly
                setJustReconnected(true);
                setShowBanner(true);
                setTimeout(() => {
                    setJustReconnected(false);
                    setShowBanner(false);
                }, 3000);
            } else {
                // Show offline banner
                setShowBanner(true);
            }
        });

        return cleanup;
    }, []);

    // Don't show anything if online and not just reconnected
    if (online && !showBanner) {
        return null;
    }

    return (
        <div
            className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full shadow-lg flex items-center gap-2 text-sm font-medium transition-all duration-300 ${justReconnected
                    ? 'bg-green-500 text-white'
                    : 'bg-amber-500 text-white'
                }`}
        >
            {justReconnected ? (
                <>
                    <CheckCircle className="h-4 w-4" />
                    <span>Kembali online</span>
                </>
            ) : (
                <>
                    <WifiOff className="h-4 w-4" />
                    <span>Mode offline - menggunakan data tersimpan</span>
                </>
            )}
        </div>
    );
}

/**
 * Compact Offline Badge for header
 */
export function OfflineBadge() {
    const [online, setOnline] = useState(isOnline());

    useEffect(() => {
        const cleanup = onConnectivityChange(setOnline);
        return cleanup;
    }, []);

    if (online) {
        return (
            <div className="flex items-center gap-1 text-xs text-green-600">
                <Wifi className="h-3 w-3" />
                <span className="hidden md:inline">Online</span>
            </div>
        );
    }

    return (
        <div className="flex items-center gap-1 text-xs text-amber-600">
            <WifiOff className="h-3 w-3" />
            <span className="hidden md:inline">Offline</span>
        </div>
    );
}

/**
 * Sync Status Indicator
 */
export function SyncStatus({ lastSynced, isSyncing, onSync }) {
    const formatTime = (timestamp) => {
        if (!timestamp) return 'Belum pernah';
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);

        if (diffMins < 1) return 'Baru saja';
        if (diffMins < 60) return `${diffMins} menit lalu`;
        if (diffMins < 1440) return `${Math.floor(diffMins / 60)} jam lalu`;
        return date.toLocaleDateString('id-ID');
    };

    return (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Terakhir sync: {formatTime(lastSynced)}</span>
            <button
                onClick={onSync}
                disabled={isSyncing || !isOnline()}
                className="p-1 rounded hover:bg-muted disabled:opacity-50"
                title={isOnline() ? 'Sync sekarang' : 'Tidak dapat sync saat offline'}
            >
                <RefreshCw className={`h-3 w-3 ${isSyncing ? 'animate-spin' : ''}`} />
            </button>
        </div>
    );
}

export default OfflineIndicator;
