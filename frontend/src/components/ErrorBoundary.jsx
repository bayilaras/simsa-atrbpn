import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { adalahGalatMuatHalaman } from '@/lib/muat-halaman';

const muatUlangHalaman = () => window.location.reload();

/**
 * Layar galat berbahasa Indonesia, dipakai ErrorBoundary dan errorElement rute.
 *
 * - Galat biasa: "Coba Lagi" (bila `onCobaLagi` ada) dan "Ke Dashboard".
 * - Berkas halaman gagal dimuat (lib/muat-halaman.js): "Coba Lagi" tidak dapat
 *   memulihkannya, jadi tombol utamanya "Muat ulang halaman".
 * - `tanpaDashboard` untuk halaman di luar ruang kerja (halaman masuk, panduan
 *   tanpa sesi): tautan Dashboard diganti "Muat ulang halaman".
 */
export function HalamanGalat({
    error,
    componentStack,
    fallbackMessage,
    onCobaLagi,
    tanpaDashboard = false,
    muatUlang = muatUlangHalaman,
}) {
    const gagalMuat = adalahGalatMuatHalaman(error);
    const bisaCobaLagi = Boolean(onCobaLagi) && !gagalMuat;

    return (
        <div className="flex flex-col items-center justify-center min-h-[400px] p-8">
            <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-500/15 flex items-center justify-center mb-4">
                <AlertTriangle className="w-8 h-8 text-red-600 dark:text-red-400" aria-hidden="true" />
            </div>
            <h2 className="text-2xl font-bold mb-2 text-center">
                {gagalMuat ? 'Halaman belum dapat dimuat' : 'Terjadi kesalahan pada halaman ini'}
            </h2>
            <p className="text-muted-foreground mb-6 text-center max-w-md">
                {gagalMuat
                    ? 'Halaman ini belum dapat dimuat. Periksa koneksi internet Anda, lalu muat ulang halaman. Hubungi administrator bila masalah berlanjut.'
                    : fallbackMessage
                        || 'Halaman tidak dapat ditampilkan karena terjadi kesalahan. Coba lagi, atau hubungi administrator bila masalah berlanjut.'}
            </p>

            {import.meta.env.DEV && error && (
                <details className="mb-6 w-full max-w-2xl">
                    <summary className="cursor-pointer text-sm text-muted-foreground mb-2">
                        Rincian galat (hanya mode pengembangan)
                    </summary>
                    <pre className="bg-muted p-4 rounded text-xs overflow-auto max-h-60">
                        {String(error)}
                        {'\n\n'}
                        {componentStack}
                    </pre>
                </details>
            )}

            <div className="flex flex-wrap justify-center gap-3">
                {bisaCobaLagi
                    ? <Button onClick={onCobaLagi}>Coba Lagi</Button>
                    : <Button onClick={muatUlang}>Muat ulang halaman</Button>}
                {!tanpaDashboard && (
                    <Button variant="outline" onClick={() => { window.location.href = '/'; }}>
                        Ke Dashboard
                    </Button>
                )}
                {tanpaDashboard && bisaCobaLagi && (
                    <Button variant="outline" onClick={muatUlang}>Muat ulang halaman</Button>
                )}
            </div>
        </div>
    );
}

/**
 * Error Boundary Component
 * Catches JavaScript errors anywhere in the child component tree.
 *
 * `resetKey`: saat nilainya berganti (mis. pengguna membuka menu lain), layar
 * galat ditutup dan isi yang baru ditampilkan; tanpa itu layar galat menetap
 * sampai "Coba Lagi" ditekan.
 */
class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null, resetKey: props.resetKey };
    }

    static getDerivedStateFromProps(props, state) {
        if (Object.is(props.resetKey, state.resetKey)) return null;
        return { hasError: false, error: null, errorInfo: null, resetKey: props.resetKey };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error('Error caught by boundary:', error, errorInfo);
        this.setState({
            error,
            errorInfo
        });
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null, errorInfo: null });
        if (this.props.onReset) {
            this.props.onReset();
        }
    };

    render() {
        if (this.state.hasError) {
            return (
                <HalamanGalat
                    error={this.state.error}
                    componentStack={this.state.errorInfo?.componentStack}
                    fallbackMessage={this.props.fallbackMessage}
                    onCobaLagi={this.handleReset}
                    tanpaDashboard={this.props.tanpaDashboard}
                    muatUlang={this.props.muatUlang}
                />
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
