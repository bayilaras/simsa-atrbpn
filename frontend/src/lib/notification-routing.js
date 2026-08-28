const ROUTES = {
    distribusi: '/distribusi',
    'verifikasi-retensi': '/retention-governance',
    appraisal: '/retention-governance',
    penyusutan: '/penyusutan',
    'penyerahan-permanen': '/retention-governance',
};

export function notificationRoute(notification) {
    if (notification?.category === 'surat-masuk') {
        return notification.referenceId ? `/surat/masuk/${notification.referenceId}` : '/surat/masuk';
    }
    if (notification?.category === 'arsip-retensi') {
        return notification.referenceId ? `/arsip/detail/${notification.referenceId}` : '/retention';
    }
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
