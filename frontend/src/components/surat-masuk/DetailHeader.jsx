import { ArrowLeft, MailOpen, Edit, Archive, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TindakLanjutMenu } from '@/components/surat/TindakLanjutMenu';

export function DetailHeader({ surat, onBack, onEdit, onDistribute, onArchive, onTerima, onPenyelesaian, onTautkan, isAdmin }) {
    // Respons lama tanpa aksesMelalui berasal dari jalur pemilik.
    const milik = (surat.aksesMelalui ?? 'owner') === 'owner';
    // aksiDiizinkan dari server (Task 16) adalah gerbang otoritatif; bila belum
    // ada (respons lama), jatuh ke isAdmin lama sebagai fallback.
    const aksi = Array.isArray(surat.aksiDiizinkan) ? surat.aksiDiizinkan : null;
    const bolehEdit = (aksi ? aksi.includes('edit') : isAdmin) && milik;
    const bolehArsip = (aksi ? aksi.includes('arsipkan') : isAdmin) && milik;
    const menu = (variant, className) => (
        <TindakLanjutMenu
            jenis="surat_masuk"
            surat={surat}
            aksiDiizinkan={surat.aksiDiizinkan || []}
            onDisposisi={onDistribute}
            onTerima={onTerima}
            onPenyelesaian={onPenyelesaian}
            onTautkan={onTautkan}
            variant={variant}
            className={className}
        />
    );
    return (
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-600 via-teal-600 to-cyan-600 p-6 md:p-8 text-white shadow-xl">
            {/* Background Pattern */}
            <div className="absolute inset-0 opacity-10">
                <div className="absolute top-0 right-0 w-64 h-64 bg-card rounded-full blur-3xl transform translate-x-1/2 -translate-y-1/2" />
                <div className="absolute bottom-0 left-0 w-48 h-48 bg-card rounded-full blur-3xl transform -translate-x-1/2 translate-y-1/2" />
            </div>

            <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div className="flex items-start gap-4">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="text-white/80 hover:text-white hover:bg-card/10 shrink-0"
                        onClick={onBack}
                    >
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div className="flex items-center gap-4">
                        <div className="bg-card/20 p-3 rounded-xl backdrop-blur-sm shrink-0 hidden sm:flex">
                            <MailOpen className="h-8 w-8" />
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                                <h1 className="text-xl md:text-2xl font-bold">Detail Surat Masuk</h1>
                                {surat.sifatSurat === 'sangat_segera' && (
                                    <Badge className="bg-red-500/90 hover:bg-red-500 text-white border-0">
                                        Sangat Segera
                                    </Badge>
                                )}
                                {surat.sifatSurat === 'segera' && (
                                    <Badge className="bg-orange-500/90 hover:bg-orange-500 text-white border-0">
                                        Segera
                                    </Badge>
                                )}
                            </div>
                            <p className="font-mono text-white/90 text-sm md:text-base truncate">{surat.nomorSurat}</p>
                        </div>
                    </div>
                </div>

                {/* Desktop Actions */}
                <div className="hidden md:flex gap-2">
                    {bolehEdit && (
                        <Button
                            variant="secondary"
                            className="bg-card/20 hover:bg-card/30 text-white border-0 backdrop-blur-sm"
                            onClick={onEdit}
                        >
                            <Edit className="mr-2 h-4 w-4" />
                            Edit
                        </Button>
                    )}
                    {menu('secondary', 'bg-card/20 hover:bg-card/30 text-white border-0 backdrop-blur-sm')}
                    {bolehArsip && !surat.isArchived && (
                        <Button
                            className="bg-card text-emerald-700 dark:text-emerald-300 hover:bg-card/90"
                            onClick={onArchive}
                        >
                            <Archive className="mr-2 h-4 w-4" />
                            Arsipkan
                        </Button>
                    )}
                </div>

                {/* Mobile Actions */}
                <div className="md:hidden flex gap-2">
                    {bolehEdit && (
                        <Button
                            variant="secondary"
                            size="sm"
                            className="bg-card/20 hover:bg-card/30 text-white border-0 flex-1"
                            onClick={onEdit}
                        >
                            <Edit className="mr-2 h-4 w-4" />
                            Edit
                        </Button>
                    )}
                    {menu('secondary', 'bg-card/20 hover:bg-card/30 text-white border-0')}
                    {bolehArsip && !surat.isArchived && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="secondary"
                                    size="icon"
                                    className="bg-card/20 hover:bg-card/30 text-white border-0"
                                    aria-label="Aksi lain"
                                >
                                    <MoreHorizontal className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={onArchive}>
                                    <Archive className="mr-2 h-4 w-4" />
                                    Arsipkan
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                </div>
            </div>
        </div>
    );
}
