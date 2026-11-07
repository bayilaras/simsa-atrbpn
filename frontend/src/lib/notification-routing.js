const ROUTES = {
    distribusi: '/distribusi',
    'verifikasi-retensi': '/retention-governance',
    appraisal: '/retention-governance',
    penyusutan: '/penyusutan',
    'penyerahan-permanen': '/retention-governance',
};

// Usulan penyusutan yang dibuat sebelum modulnya dimatikan tetap dapat muncul
// sebagai notifikasi; arahkan ke Manajemen Retensi, bukan halaman modul mati.
// Hanya nilai false eksplisit yang menandai modul mati, sama dengan sidebar.
const OPTIONAL_MODULE_FALLBACKS = {
    penyusutan: { capability: 'advancedArchiveWorkflows', route: '/retention' },
};

export function notificationRoute(notification, capabilities) {
    if (notification?.category === 'surat-masuk') {
        return notification.referenceId ? `/surat/masuk/${notification.referenceId}` : '/surat/masuk';
    }
    if (notification?.category === 'arsip-retensi') {
        return notification.referenceId ? `/arsip/detail/${notification.referenceId}` : '/retention';
    }
    const fallback = OPTIONAL_MODULE_FALLBACKS[notification?.category];
    if (fallback && capabilities?.[fallback.capability] === false) return fallback.route;
    return ROUTES[notification?.category] || '/';
}

export const WORKFLOW_NOTIFICATION_CATEGORIES = [
    'distribusi',
    'verifikasi-retensi',
    'appraisal',
    'penyusutan',
    'penyerahan-permanen',
];

export function notificationMatchesFilter(notification, categoryFilter) {
    if (!categoryFilter || categoryFilter === 'all') return true;
    if (categoryFilter === 'workflow') {
        return WORKFLOW_NOTIFICATION_CATEGORIES.includes(notification?.category);
    }
    return notification?.category === categoryFilter;
}
