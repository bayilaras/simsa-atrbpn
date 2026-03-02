import { ArrowLeft, MailOpen, Edit, Send, Archive, MoreHorizontal, Reply } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Link } from 'react-router-dom';

export function DetailHeader({ surat, onBack, onEdit, onReply, onDistribute, onArchive, isAdmin }) {
    return (
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-600 via-teal-600 to-cyan-600 p-6 md:p-8 text-white shadow-xl">
            {/* Background Pattern */}
            <div className="absolute inset-0 opacity-10">
                <div className="absolute top-0 right-0 w-64 h-64 bg-white rounded-full blur-3xl transform translate-x-1/2 -translate-y-1/2" />
                <div className="absolute bottom-0 left-0 w-48 h-48 bg-white rounded-full blur-3xl transform -translate-x-1/2 translate-y-1/2" />
            </div>

            <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div className="flex items-start gap-4">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="text-white/80 hover:text-white hover:bg-white/10 shrink-0"
                        onClick={onBack}
                    >
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div className="flex items-center gap-4">
                        <div className="bg-white/20 p-3 rounded-xl backdrop-blur-sm shrink-0 hidden sm:flex">
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
                {isAdmin && (
                    <div className="hidden md:flex gap-2">
                        <Button
                            variant="secondary"
                            className="bg-white/20 hover:bg-white/30 text-white border-0 backdrop-blur-sm"
                            onClick={onEdit}
                        >
                            <Edit className="mr-2 h-4 w-4" />
                            Edit
                        </Button>
                        <Button
                            variant="secondary"
                            className="bg-white/20 hover:bg-white/30 text-white border-0 backdrop-blur-sm"
                            onClick={onReply}
                        >
                            <Reply className="mr-2 h-4 w-4" />
                            Balas Surat
                        </Button>
                        <Button
                            variant="secondary"
                            className="bg-white/20 hover:bg-white/30 text-white border-0 backdrop-blur-sm"
                            onClick={onDistribute}
                        >
                            <Send className="mr-2 h-4 w-4" />
                            Distribusi
                        </Button>
                        {!surat.isArchived && (
                            <Button
                                className="bg-white text-emerald-700 hover:bg-white/90"
                                onClick={onArchive}
                            >
                                <Archive className="mr-2 h-4 w-4" />
                                Arsipkan
                            </Button>
                        )}
                    </div>
                )}

                {/* Mobile Actions */}
                {isAdmin && (
                    <div className="md:hidden flex gap-2">
                        <Button
                            variant="secondary"
                            size="sm"
                            className="bg-white/20 hover:bg-white/30 text-white border-0 flex-1"
                            onClick={onEdit}
                        >
                            <Edit className="mr-2 h-4 w-4" />
                            Edit
                        </Button>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="secondary"
                                    size="icon"
                                    className="bg-white/20 hover:bg-white/30 text-white border-0"
                                >
                                    <MoreHorizontal className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={onReply}>
                                    <Reply className="mr-2 h-4 w-4" />
                                    Balas Surat
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={onDistribute}>
                                    <Send className="mr-2 h-4 w-4" />
                                    Distribusikan
                                </DropdownMenuItem>
                                {!surat.isArchived && (
                                    <DropdownMenuItem onClick={onArchive}>
                                        <Archive className="mr-2 h-4 w-4" />
                                        Arsipkan
                                    </DropdownMenuItem>
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                )}
            </div>
        </div>
    );
}
