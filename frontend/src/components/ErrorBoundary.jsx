import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Error Boundary Component
 * Catches JavaScript errors anywhere in the child component tree
 */

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError() {
        return { hasError: true };
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
                <div className="flex flex-col items-center justify-center min-h-[400px] p-8">
                    <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-500/15 flex items-center justify-center mb-4">
                        <AlertTriangle className="w-8 h-8 text-red-600 dark:text-red-400" />
                    </div>
                    <h2 className="text-2xl font-bold mb-2">Terjadi kesalahan pada halaman ini</h2>
                    <p className="text-muted-foreground mb-6 text-center max-w-md">
                        {this.props.fallbackMessage ||
                            'Halaman tidak dapat ditampilkan karena terjadi kesalahan. Coba lagi, atau hubungi administrator bila masalah berlanjut.'}
                    </p>

                    {import.meta.env.DEV && this.state.error && (
                        <details className="mb-6 w-full max-w-2xl">
                            <summary className="cursor-pointer text-sm text-muted-foreground mb-2">
                                Rincian galat (hanya mode pengembangan)
                            </summary>
                            <pre className="bg-muted p-4 rounded text-xs overflow-auto max-h-60">
                                {this.state.error.toString()}
                                {'\n\n'}
                                {this.state.errorInfo?.componentStack}
                            </pre>
                        </details>
                    )}

                    <div className="flex gap-3">
                        <Button onClick={this.handleReset}>
                            Coba Lagi
                        </Button>
                        <Button variant="outline" onClick={() => window.location.href = '/'}>
                            Ke Dashboard
                        </Button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
