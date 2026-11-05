import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from 'react-router-dom';
import { useAppConfig } from '@/context/app-config-context';
import { formulirMetadata, isFormulirModuleAvailable } from './formulir-metadata';

const FormulirIndex = () => {
    const { capabilities } = useAppConfig();
    return (
        <div className="p-6">
            <h1 className="text-2xl font-bold">Template Referensi Kosong</h1>
            <p className="mb-6 mt-2 max-w-3xl text-sm text-muted-foreground">
                Formulir di halaman ini adalah contoh tata letak kosong dan tidak mengambil data transaksi. Gunakan tombol modul terintegrasi untuk membuat keluaran berbasis data aplikasi.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {formulirMetadata.map((form) => (
                    <Card key={form.id} className="hover:shadow-lg transition-shadow">
                        <CardHeader>
                            <Badge variant="outline" className="mb-2 w-fit">Template Referensi Kosong</Badge>
                            <CardTitle className="text-lg">{form.name}</CardTitle>
                            <CardDescription>Tidak terisi otomatis dari data aplikasi.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            <Link to={`/formulir/cetak/${form.id}`} target="_blank">
                                <Button variant="outline" className="w-full">
                                    Lihat Template Kosong
                                </Button>
                            </Link>
                            {isFormulirModuleAvailable(form, capabilities) ? (
                                <Button asChild className="w-full">
                                    <Link to={form.path}>{form.label}</Link>
                                </Button>
                            ) : (
                                <p className="text-sm text-muted-foreground">
                                    Modul {form.moduleName} belum diaktifkan. Template tetap dapat dilihat dan dicetak untuk diisi manual.
                                </p>
                            )}
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    );
};

export default FormulirIndex;
