import Formulir1 from '@/components/formulir/Formulir1';
import Formulir2 from '@/components/formulir/Formulir2';
import Formulir3 from '@/components/formulir/Formulir3';
import Formulir4 from '@/components/formulir/Formulir4';
import Formulir5 from '@/components/formulir/Formulir5';
import Formulir6 from '@/components/formulir/Formulir6';
import Formulir7 from '@/components/formulir/Formulir7';
import Formulir8 from '@/components/formulir/Formulir8';
import Formulir9 from '@/components/formulir/Formulir9';
import Formulir10 from '@/components/formulir/Formulir10';
import Formulir11 from '@/components/formulir/Formulir11';
import Formulir12 from '@/components/formulir/Formulir12';
import Formulir13 from '@/components/formulir/Formulir13';
import Formulir14 from '@/components/formulir/Formulir14';
import Formulir15 from '@/components/formulir/Formulir15';
import Formulir16 from '@/components/formulir/Formulir16';
import Formulir17 from '@/components/formulir/Formulir17';
import Formulir18 from '@/components/formulir/Formulir18';
import Formulir19 from '@/components/formulir/Formulir19';
import Formulir20 from '@/components/formulir/Formulir20';
import Formulir21 from '@/components/formulir/Formulir21';
import Formulir22 from '@/components/formulir/Formulir22';
import Formulir23 from '@/components/formulir/Formulir23';
import Formulir24 from '@/components/formulir/Formulir24';
import Formulir25 from '@/components/formulir/Formulir25';
import Formulir26 from '@/components/formulir/Formulir26';
import Formulir27 from '@/components/formulir/Formulir27';
import Formulir28 from '@/components/formulir/Formulir28';
import Formulir29 from '@/components/formulir/Formulir29';
import Formulir30 from '@/components/formulir/Formulir30';
import Formulir31 from '@/components/formulir/Formulir31';
import Formulir32 from '@/components/formulir/Formulir32';
import Formulir33 from '@/components/formulir/Formulir33';
import { Link, useParams } from 'react-router-dom';
import { getFormulirMetadata } from './formulir-metadata';

const FormulirViewer = () => {
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

export default FormulirViewer;
