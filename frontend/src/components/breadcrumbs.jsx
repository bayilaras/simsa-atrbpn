import { useLocation, Link } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';

const routeNameMap = {
    'surat': 'Surat',
    'masuk': 'Masuk',
    'keluar': 'Keluar',
    'tambah': 'Tambah',
    'arsip': 'Arsip',
    'laporan': 'Laporan',
    'audit-log': 'Audit Log',
    'record-access-grants': 'Persetujuan Akses Rekod',
    'integrations': 'Integrasi',
    'srikandi': 'SRIKANDI',
    'users': 'User Management',
    'master': 'Master Data',
    'klasifikasi': 'Klasifikasi Arsip',
    'jra': 'Jadwal Retensi',
    'regulatory-rules': 'Versi Aturan',
    'retention-governance': 'Tata Kelola Retensi',
    'storage-locations': 'Lokasi Penyimpanan',
    'archive-lending': 'Peminjaman Arsip',
    'dosir': 'Pemberkasan Perkara',
    'retention': 'Manajemen Retensi',
    'bulk-upload': 'Bulk Upload',
    'settings': 'Pengaturan',
};

export function Breadcrumbs() {
    const location = useLocation();
    const pathnames = location.pathname.split('/').filter((x) => x);

    // Helper to check if string is a UUID-like or numeric ID
    const isId = (str) => {
        const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
        const numericRegex = /^\d+$/;
        return uuidRegex.test(str) || (numericRegex.test(str) && str.length > 5);
    };

    if (pathnames.length === 0) {
        return null;
    }

    return (
        <nav aria-label="Breadcrumb" className="flex items-center space-x-2 text-sm text-muted-foreground mb-4 overflow-x-auto whitespace-nowrap pb-1">
            <Link to="/" className="hover:text-foreground transition-colors flex items-center gap-1">
                <Home className="h-4 w-4" />
                <span className="sr-only md:not-sr-only">Dashboard</span>
            </Link>

            {pathnames.map((value, index) => {
                const to = `/${pathnames.slice(0, index + 1).join('/')}`;
                const isLast = index === pathnames.length - 1;

                let name = routeNameMap[value];

                // Handle IDs
                if (!name) {
                    if (isId(value)) {
                        name = 'Detail';
                    } else if (value === 'edit') {
                        name = 'Edit';
                    } else {
                        // Fallback: Capitalize first letter
                        name = value.charAt(0).toUpperCase() + value.slice(1).replace(/-/g, ' ');
                    }
                }

                return (
                    <div key={to} className="flex items-center space-x-2">
                        <ChevronRight className="h-4 w-4 text-muted-foreground/50 flex-shrink-0" />
                        {isLast ? (
                            <span className="font-medium text-foreground">{name}</span>
                        ) : (
                            <Link to={to} className="hover:text-foreground transition-colors">
                                {name}
                            </Link>
                        )}
                    </div>
                );
            })}
        </nav>
    );
}
