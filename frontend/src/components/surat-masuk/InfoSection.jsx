import { FileText, Calendar, Hash, Building, User, Sparkles, Link2, ExternalLink, Send } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { format } from 'date-fns';
import { id as localeId } from 'date-fns/locale';
import { useAppConfig } from '@/context/app-config-context';
import { SuratRetentionSummary } from '@/components/SuratRetentionSummary';

const SIFAT_LABELS = new Map([
    ['biasa', 'Biasa'],
    ['biasa/terbuka', 'Biasa/Terbuka'],
    ['terbuka', 'Terbuka'],
    ['segera', 'Segera'],
    ['sangat_segera', 'Sangat Segera'],
    ['undangan', 'Undangan'],
    ['penting', 'Penting'],
    ['terbatas', 'Terbatas'],
    ['rahasia', 'Rahasia'],
    ['sangat_rahasia', 'Sangat Rahasia'],
]);
const SIFAT_DESTRUCTIVE = new Set(['sangat_segera', 'rahasia', 'sangat_rahasia']);
const SIFAT_EMPHASIS = new Set(['segera', 'terbatas']);

// Normalisasi sama dengan normalizeSecurityClassification (backend) tanpa
// pemetaan kelas, agar nilai impor seperti "Sangat Segera" atau "RAHASIA"
// tidak tampil sebagai "Biasa".
function sifatKey(value) {
    const raw = typeof value === 'string' && value.length > 0 ? value : 'biasa';
    return raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function sifatBadge(value) {
    const key = sifatKey(value);
    const fallback = typeof value === 'string' && value.trim() ? value.trim() : 'Biasa';
    return {
        label: SIFAT_LABELS.get(key) || fallback,
        variant: SIFAT_DESTRUCTIVE.has(key) ? 'destructive' : SIFAT_EMPHASIS.has(key) ? 'default' : 'secondary',
    };
}

function disposisiLabels(value) {
    if (!Array.isArray(value)) return [];
    return value
        .filter((label) => typeof label === 'string' && label.trim().length > 0)
        .map((label) => label.trim());
}

export function InfoSection({ surat }) {
    const { capabilities } = useAppConfig();
    const formatDate = (dateString) => {
        if (!dateString) return '-';
        try {
            return format(new Date(dateString), 'dd MMMM yyyy', { locale: localeId });
        } catch {
            return dateString;
        }
    };
    const sifat = sifatBadge(surat.sifatSurat);
    const disposisi = disposisiLabels(surat.disposisi);
    const keterangan = typeof surat.keterangan === 'string' ? surat.keterangan.trim() : '';
    const noAgenda = surat.noUrut !== null && surat.noUrut !== undefined && surat.noUrut !== ''
        ? String(surat.noUrut)
        : '-';

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
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">No. Agenda</label>
                        <p className="flex items-center gap-2 text-sm">
                            <Hash className="h-4 w-4 text-blue-600" />
                            <span>{noAgenda}</span>
                        </p>
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
                        <Badge variant={sifat.variant} className="mt-1">
                            {sifat.label}
                        </Badge>
                    </div>
                    <div className="space-y-1 col-span-2 sm:col-span-1">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Klasifikasi</label>
                        <p className="text-sm font-medium">{surat.klasifikasiKode || surat.klasifikasi || '-'}</p>
                        {surat.klasifikasiUraian && <p className="text-sm text-muted-foreground">{surat.klasifikasiUraian}</p>}
                    </div>
                </div>

                {/* Disposisi (label tampilan; routing ada di Kotak Disposisi) */}
                <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                        <Send className="h-3 w-3" />
                        Disposisi
                    </label>
                    {disposisi.length > 0 ? (
                        <ul aria-label="Disposisi" className="flex flex-wrap gap-2">
                            {disposisi.map((label, index) => (
                                <li key={`${index}-${label}`}>
                                    <Badge variant="outline">{label}</Badge>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-sm text-muted-foreground italic">Belum ada disposisi</p>
                    )}
                </div>

                <SuratRetentionSummary surat={surat} />

                {/* Link Dokumen */}
                {capabilities.files && surat.linkDokumen && (
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

                {/* Keterangan */}
                {keterangan && (
                    <>
                        <Separator />
                        <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Keterangan</label>
                            <div className="bg-amber-50 dark:bg-amber-950/30 p-4 rounded-lg border border-amber-100 dark:border-amber-900/50">
                                <p className="text-sm leading-relaxed whitespace-pre-line">{keterangan}</p>
                            </div>
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
}
