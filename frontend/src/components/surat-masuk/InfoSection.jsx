import { FileText, Calendar, Clock, Building, User, Sparkles, Link2, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { format } from 'date-fns';
import { id as localeId } from 'date-fns/locale';

export function InfoSection({ surat }) {
    const formatDate = (dateString) => {
        if (!dateString) return '-';
        try {
            return format(new Date(dateString), 'dd MMMM yyyy', { locale: localeId });
        } catch {
            return dateString;
        }
    };

    return (
        <Card className="shadow-sm hover:shadow-md transition-shadow duration-200">
            <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-emerald-600" />
                    Informasi Surat
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* Perihal Highlight Section */}
                <div className="bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30 p-4 rounded-xl border border-emerald-100 dark:border-emerald-900/50">
                    <label className="text-xs uppercase tracking-wider font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                        <Sparkles className="h-3 w-3" />
                        Perihal
                    </label>
                    <p className="text-lg font-semibold text-foreground dark:text-white mt-1 leading-relaxed">
                        {surat.perihal}
                    </p>
                </div>

                {/* Details Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1 p-3 bg-muted/30 rounded-lg">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Nomor Surat</label>
                        <p className="font-mono text-sm bg-background px-3 py-2 rounded-md border">{surat.nomorSurat}</p>
                    </div>
                    <div className="space-y-1 p-3 bg-muted/30 rounded-lg">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tanggal Surat</label>
                        <p className="flex items-center gap-2 text-sm">
                            <Calendar className="h-4 w-4 text-emerald-600" />
                            {formatDate(surat.tanggalSurat)}
                        </p>
                    </div>
                    <div className="space-y-1 p-3 bg-muted/30 rounded-lg">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tanggal Diterima</label>
                        <p className="flex items-center gap-2 text-sm">
                            <Clock className="h-4 w-4 text-blue-600" />
                            {formatDate(surat.tanggalDiterima)}
                        </p>
                    </div>
                    <div className="space-y-1 p-3 bg-muted/30 rounded-lg">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">No. Agenda</label>
                        <p className="text-sm">{surat.noAgenda || <span className="text-muted-foreground italic">Belum ada</span>}</p>
                    </div>
                </div>

                <Separator />

                {/* Sender/Recipient */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2 p-4 border rounded-xl bg-gradient-to-br from-blue-50/50 to-indigo-50/50 dark:from-blue-950/20 dark:to-indigo-950/20">
                        <label className="text-xs font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wide flex items-center gap-1">
                            <Building className="h-3 w-3" />
                            Dari
                        </label>
                        <p className="font-medium">{surat.dari}</p>
                    </div>
                    <div className="space-y-2 p-4 border rounded-xl bg-gradient-to-br from-purple-50/50 to-pink-50/50 dark:from-purple-950/20 dark:to-pink-950/20">
                        <label className="text-xs font-semibold text-purple-700 dark:text-purple-400 uppercase tracking-wide flex items-center gap-1">
                            <User className="h-3 w-3" />
                            Kepada
                        </label>
                        <p className="font-medium">{surat.kepada || <span className="text-muted-foreground italic">-</span>}</p>
                    </div>
                </div>

                {/* Type & Classification */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Jenis Surat</label>
                        <p className="text-sm font-medium">{surat.jenisSurat || '-'}</p>
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Sifat Surat</label>
                        <Badge
                            variant={surat.sifatSurat === 'sangat_segera' ? 'destructive' : surat.sifatSurat === 'segera' ? 'default' : 'secondary'}
                            className="mt-1"
                        >
                            {surat.sifatSurat === 'sangat_segera' ? 'Sangat Segera' :
                                surat.sifatSurat === 'segera' ? 'Segera' : 'Biasa'}
                        </Badge>
                    </div>
                    <div className="space-y-1 col-span-2 sm:col-span-1">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Klasifikasi</label>
                        <p className="text-sm font-medium">{surat.klasifikasi || '-'}</p>
                    </div>
                </div>

                {/* Link Dokumen */}
                {surat.linkDokumen && (
                    <>
                        <Separator />
                        <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Link Dokumen</label>
                            <a
                                href={surat.linkDokumen}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-100 dark:border-blue-900/50 hover:bg-blue-100 dark:hover:bg-blue-950/50 transition-colors group"
                            >
                                <div className="bg-blue-500 p-2 rounded-lg">
                                    <Link2 className="h-4 w-4 text-white" />
                                </div>
                                <span className="text-blue-700 dark:text-blue-300 group-hover:underline truncate flex-1">
                                    {surat.linkDokumen}
                                </span>
                                <ExternalLink className="h-4 w-4 text-blue-500 shrink-0" />
                            </a>
                        </div>
                    </>
                )}

                {/* Catatan */}
                {surat.catatan && (
                    <>
                        <Separator />
                        <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Catatan</label>
                            <div className="bg-amber-50 dark:bg-amber-950/30 p-4 rounded-lg border border-amber-100 dark:border-amber-900/50">
                                <p className="text-sm leading-relaxed">{surat.catatan}</p>
                            </div>
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
}
