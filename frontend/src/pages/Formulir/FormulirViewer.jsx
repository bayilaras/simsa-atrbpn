import { lazy } from 'react';
import { Link, useParams } from 'react-router-dom';
import ErrorBoundary from '@/components/ErrorBoundary';
import { getFormulirMetadata } from './formulir-metadata';

// The print route's Suspense boundary waits for just the selected template.
// Keep the other 32 documents out of its initial module graph.
const Formulir1 = lazy(() => import('@/components/formulir/Formulir1'));
const Formulir2 = lazy(() => import('@/components/formulir/Formulir2'));
const Formulir3 = lazy(() => import('@/components/formulir/Formulir3'));
const Formulir4 = lazy(() => import('@/components/formulir/Formulir4'));
const Formulir5 = lazy(() => import('@/components/formulir/Formulir5'));
const Formulir6 = lazy(() => import('@/components/formulir/Formulir6'));
const Formulir7 = lazy(() => import('@/components/formulir/Formulir7'));
const Formulir8 = lazy(() => import('@/components/formulir/Formulir8'));
const Formulir9 = lazy(() => import('@/components/formulir/Formulir9'));
const Formulir10 = lazy(() => import('@/components/formulir/Formulir10'));
const Formulir11 = lazy(() => import('@/components/formulir/Formulir11'));
const Formulir12 = lazy(() => import('@/components/formulir/Formulir12'));
const Formulir13 = lazy(() => import('@/components/formulir/Formulir13'));
const Formulir14 = lazy(() => import('@/components/formulir/Formulir14'));
const Formulir15 = lazy(() => import('@/components/formulir/Formulir15'));
const Formulir16 = lazy(() => import('@/components/formulir/Formulir16'));
const Formulir17 = lazy(() => import('@/components/formulir/Formulir17'));
const Formulir18 = lazy(() => import('@/components/formulir/Formulir18'));
const Formulir19 = lazy(() => import('@/components/formulir/Formulir19'));
const Formulir20 = lazy(() => import('@/components/formulir/Formulir20'));
const Formulir21 = lazy(() => import('@/components/formulir/Formulir21'));
const Formulir22 = lazy(() => import('@/components/formulir/Formulir22'));
const Formulir23 = lazy(() => import('@/components/formulir/Formulir23'));
const Formulir24 = lazy(() => import('@/components/formulir/Formulir24'));
const Formulir25 = lazy(() => import('@/components/formulir/Formulir25'));
const Formulir26 = lazy(() => import('@/components/formulir/Formulir26'));
const Formulir27 = lazy(() => import('@/components/formulir/Formulir27'));
const Formulir28 = lazy(() => import('@/components/formulir/Formulir28'));
const Formulir29 = lazy(() => import('@/components/formulir/Formulir29'));
const Formulir30 = lazy(() => import('@/components/formulir/Formulir30'));
const Formulir31 = lazy(() => import('@/components/formulir/Formulir31'));
const Formulir32 = lazy(() => import('@/components/formulir/Formulir32'));
const Formulir33 = lazy(() => import('@/components/formulir/Formulir33'));

const FormulirTemplate = () => {
    const { id } = useParams();
    const formId = parseInt(id);
    const metadata = getFormulirMetadata(formId);

    // Map IDs to components
    const renderForm = () => {
        switch (formId) {
            case 1:
                return <Formulir1 />;
            case 2:
                return <Formulir2 />;
            case 3:
                return <Formulir3 />;
            case 4:
                return <Formulir4 />;
            case 5:
                return <Formulir5 />;
            case 6:
                return <Formulir6 />;
            case 7:
                return <Formulir7 />;
            case 8:
                return <Formulir8 />;
            case 9:
                return <Formulir9 />;
            case 10:
                return <Formulir10 />;
            case 11:
                return <Formulir11 />;
            case 12:
                return <Formulir12 />;
            case 13:
                return <Formulir13 />;
            case 14:
                return <Formulir14 />;
            case 15:
                return <Formulir15 />;
            case 16:
                return <Formulir16 />;
            case 17:
                return <Formulir17 />;
            case 18:
                return <Formulir18 />;
            case 19:
                return <Formulir19 />;
            case 20:
                return <Formulir20 />;
            case 21:
                return <Formulir21 />;
            case 22:
                return <Formulir22 />;
            case 23:
                return <Formulir23 />;
            case 24:
                return <Formulir24 />;
            case 25:
                return <Formulir25 />;
            case 26:
                return <Formulir26 />;
            case 27:
                return <Formulir27 />;
            case 28:
                return <Formulir28 />;
            case 29:
                return <Formulir29 />;
            case 30:
                return <Formulir30 />;
            case 31:
                return <Formulir31 />;
            case 32:
                return <Formulir32 />;
            case 33:
                return <Formulir33 />;
            default:
                return <div>Formulir tidak ditemukan</div>;
        }
    };

    const handlePrint = () => {
        window.print();
    };

    return (
        <div className="form-viewer relative min-h-screen">
            <div className="fixed left-4 right-4 top-4 z-50 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background/95 p-3 shadow-lg backdrop-blur print:hidden">
                <div>
                    <p className="font-semibold">Template Referensi Kosong</p>
                    <p className="text-xs text-muted-foreground">Pratinjau ini tidak terisi dari data aplikasi.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    {metadata && (
                        <Link
                            to={metadata.path}
                            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
                        >
                            {metadata.label}
                        </Link>
                    )}
                <button
                    onClick={handlePrint}
                    className="flex items-center gap-2 px-4 py-2 bg-foreground text-white rounded-md hover:bg-foreground transition-colors shadow-lg"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="6 9 6 2 18 2 18 9"></polyline>
                        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                        <rect x="6" y="14" width="12" height="8"></rect>
                    </svg>
                    Cetak Template Kosong
                </button>
                </div>
            </div>
            {renderForm()}
        </div>
    );
};

const FormulirViewer = () => (
    <ErrorBoundary
        fallbackMessage="Template tidak dapat dimuat. Muat ulang halaman untuk mencoba kembali."
        onReset={() => window.location.reload()}
    >
        <FormulirTemplate />
    </ErrorBoundary>
);

export default FormulirViewer;
