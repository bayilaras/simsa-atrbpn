import { Link } from 'react-router-dom';
import { format, formatDistanceToNow } from 'date-fns';
import { id as localeId } from 'date-fns/locale';
import { CheckCircle, Clock, Archive, Eye, Edit, Send, Reply } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

export function StatusSidebar({ surat, onEdit, onReply, onDistribute, onArchive, isAdmin }) {
    const formatDate = (dateString) => {
        if (!dateString) return '-';
        try {
            return format(new Date(dateString), 'dd MMMM yyyy', { locale: localeId });
        } catch {
            return dateString;
        }
    };

    const formatRelativeTime = (dateString) => {
        if (!dateString) return '';
        try {
            return formatDistanceToNow(new Date(dateString), { addSuffix: true, locale: localeId });
        } catch {
            return '';
        }
    };

    return (
        <div className="space-y-6">
            {/* Status Card */}
            <Card className="shadow-sm overflow-hidden">
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Status</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                    {/* Reply Status */}
                    <div className={`flex items-center gap-3 p-3 rounded-xl transition-colors ${surat.status === 'sudah_dibalas'
                        ? 'bg-green-50 dark:bg-green-950/30 border border-green-100 dark:border-green-900/50'
                        : 'bg-orange-50 dark:bg-orange-950/30 border border-orange-100 dark:border-orange-900/50'
                        }`}>
                        <div className={`p-2 rounded-full ${surat.status === 'sudah_dibalas'
                            ? 'bg-green-100 dark:bg-green-900/50'
                            : 'bg-orange-100 dark:bg-orange-900/50'
                            }`}>
                            {surat.status === 'sudah_dibalas' ? (
                                <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                            ) : (
                                <Clock className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                            )}
                        </div>
                        <div>
                            <p className={`font-medium text-sm ${surat.status === 'sudah_dibalas'
                                ? 'text-green-700 dark:text-green-300'
                                : 'text-orange-700 dark:text-orange-300'
                                }`}>
                                {surat.status === 'sudah_dibalas' ? 'Sudah Dibalas' : 'Belum Dibalas'}
                            </p>
                            <p className="text-xs text-muted-foreground">Status balasan</p>
                        </div>
                    </div>

                    {/* Archive Status */}
                    <div className={`flex items-center gap-3 p-3 rounded-xl transition-colors ${surat.isArchived
                        ? 'bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/50'
                        : 'bg-muted/50 dark:bg-foreground/30 border border-border dark:border-gray-800'
                        }`}>
                        <div className={`p-2 rounded-full ${surat.isArchived
                            ? 'bg-emerald-100 dark:bg-emerald-900/50'
                            : 'bg-muted dark:bg-foreground'
                            }`}>
                            <Archive className={`h-4 w-4 ${surat.isArchived
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-muted-foreground'
                                }`} />
                        </div>
                        <div>
                            <p className={`font-medium text-sm ${surat.isArchived
                                ? 'text-emerald-700 dark:text-emerald-300'
                                : 'text-muted-foreground dark:text-muted-foreground'
                                }`}>
                                {surat.isArchived ? 'Sudah Diarsipkan' : 'Belum Diarsipkan'}
                            </p>
                            <p className="text-xs text-muted-foreground">Status arsip</p>
                        </div>
                    </div>

                    {surat.isArchived && surat.arsipId && (
                        <Button variant="outline" className="w-full" size="sm" asChild>
                            <Link to={`/arsip?id=${surat.arsipId}`}>
                                <Eye className="mr-2 h-4 w-4" />
                                Lihat di Arsip
                            </Link>
                        </Button>
                    )}
                </CardContent>
            </Card>

            {/* Metadata Card */}
            <Card className="shadow-sm">
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Metadata</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm pt-0">
                    <div className="flex justify-between items-start">
                        <span className="text-muted-foreground">Dibuat pada</span>
                        <div className="text-right">
                            <span className="block">{formatDate(surat.createdAt)}</span>
                            <span className="text-xs text-muted-foreground">{formatRelativeTime(surat.createdAt)}</span>
                        </div>
                    </div>
                    <Separator />
                    <div className="flex justify-between items-start">
                        <span className="text-muted-foreground">Diubah pada</span>
                        <div className="text-right">
                            <span className="block">{formatDate(surat.updatedAt)}</span>
                            <span className="text-xs text-muted-foreground">{formatRelativeTime(surat.updatedAt)}</span>
                        </div>
                    </div>
                    {surat.unitKerjaId && (
                        <>
                            <Separator />
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Unit Kerja</span>
                                <Badge variant="outline">{surat.unitKerjaId}</Badge>
                            </div>
                        </>
                    )}
                </CardContent>
            </Card>

            {/* Quick Actions Card - Admin only */}
            {isAdmin && (
                <Card className="shadow-sm">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base">Aksi Cepat</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 pt-0">
                        <Button
                            variant="outline"
                            className="w-full justify-start hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-300 transition-colors"
                            onClick={onEdit}
                        >
                            <Edit className="mr-2 h-4 w-4" />
                            Edit Surat
                        </Button>
                        <Button
                            variant="outline"
                            className="w-full justify-start hover:bg-amber-50 dark:bg-amber-500/15 hover:text-amber-700 dark:text-amber-300 hover:border-amber-200 dark:hover:bg-amber-950/30 dark:hover:text-amber-300 transition-colors"
                            onClick={onReply}
                        >
                            <Reply className="mr-2 h-4 w-4" />
                            Balas Surat
                        </Button>
                        <Button
                            variant="outline"
                            className="w-full justify-start hover:bg-blue-50 dark:bg-blue-500/15 hover:text-blue-700 dark:text-blue-300 hover:border-blue-200 dark:hover:bg-blue-950/30 dark:hover:text-blue-300 transition-colors"
                            onClick={onDistribute}
                        >
                            <Send className="mr-2 h-4 w-4" />
                            Distribusikan
                        </Button>
                        {!surat.isArchived && (
                            <Button
                                variant="outline"
                                className="w-full justify-start hover:bg-purple-50 dark:bg-purple-500/15 hover:text-purple-700 dark:text-purple-300 hover:border-purple-200 dark:hover:bg-purple-950/30 dark:hover:text-purple-300 transition-colors"
                                onClick={onArchive}
                            >
                                <Archive className="mr-2 h-4 w-4" />
                                Arsipkan
                            </Button>
                        )}
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
