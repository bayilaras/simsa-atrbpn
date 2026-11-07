import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { Download, FileSpreadsheet, FileText, ChevronDown } from 'lucide-react';
import api from '@/services/api';

// Server menolak Formulir 6 tanpa arsip inaktif; itu keterangan, bukan kegagalan.
const KODE_FORMULIR_KOSONG = 'EXPORT_FORMULIR6_EMPTY';
// Jarak minimum menu dari tepi layar, sama dengan gutter halaman di ponsel (px-4).
const TEPI_LAYAR = 16;

/**
 * ExportButton - dropdown for exporting data in Excel/PDF
 * For arsip, supports Formulir 4 (Arsip Aktif) and Formulir 6 (Arsip Inaktif)
 */
const ExportButton = ({ type, filters = {} }) => {
    const [isExporting, setIsExporting] = useState(false);
    const [showDropdown, setShowDropdown] = useState(false);
    const [exportNotice, setExportNotice] = useState(null);
    // Keterangan "untuk filter ini" tidak berlaku lagi setelah filter berganti.
    const kunciFilter = JSON.stringify(filters);
    const [kunciKeterangan, setKunciKeterangan] = useState(kunciFilter);
    if (kunciKeterangan !== kunciFilter) {
        setKunciKeterangan(kunciFilter);
        setExportNotice(null);
    }
    const containerRef = useRef(null);
    const triggerRef = useRef(null);
    const menuRef = useRef(null);
    const formulir4Id = useId();
    const formulir6Id = useId();

    // Menu rata kanan dengan tombol, tetapi di layar sempit tombol bisa berada di
    // kiri sehingga menu terpotong; geser secukupnya agar tetap di dalam layar.
    // Diatur langsung di DOM sebelum digambar, jadi tidak ada lompatan posisi.
    useLayoutEffect(() => {
        if (!showDropdown) return undefined;
        const posisikan = () => {
            const container = containerRef.current;
            const trigger = triggerRef.current;
            const menu = menuRef.current;
            if (!container || !trigger || !menu) return;
            const lebarLayar = document.documentElement.clientWidth || window.innerWidth;
            const lebarMenu = menu.offsetWidth;
            const kiriIdeal = trigger.getBoundingClientRect().right - lebarMenu;
            const kiri = Math.max(TEPI_LAYAR, Math.min(kiriIdeal, lebarLayar - TEPI_LAYAR - lebarMenu));
            menu.style.left = `${kiri - container.getBoundingClientRect().left}px`;
            menu.style.right = 'auto';
        };
        posisikan();
        window.addEventListener('resize', posisikan);
        return () => window.removeEventListener('resize', posisikan);
    }, [showDropdown]);

    const handleExport = async (format, formulirType = null) => {
        setIsExporting(true);
        setShowDropdown(false);
        setExportNotice(null);

        try {
            const queryParams = new URLSearchParams();
            Object.entries(filters).forEach(([key, value]) => {
                if (value !== undefined && value !== null && value !== '' && value !== 'all') {
                    queryParams.set(key, String(value));
                }
            });

            if (formulirType) {
                queryParams.set('formulirType', formulirType);
            }

            const response = await api.get(`/api/export/${type}/${format}`, Object.fromEntries(queryParams), {
                responseType: 'response',
            });

            const contentDisposition = response.headers.get('Content-Disposition');
            let filename = `${type}-export.${format === 'excel' ? 'xlsx' : 'pdf'}`;
            if (contentDisposition) {
                const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
                if (filenameMatch) {
                    filename = filenameMatch[1].replace(/['"]/g, '');
                }
            }

            const blob = await response.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = downloadUrl;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(downloadUrl);
        } catch (error) {
            // api.js sudah mengisi message dari body JSON (termasuk pesan 422) dan
            // memakai teks Indonesia sendiri untuk 401/429.
            setExportNotice({
                message: error?.message || 'Gagal mengekspor. Silakan coba kembali.',
                informational: error?.data?.error === KODE_FORMULIR_KOSONG,
            });
        } finally {
            setIsExporting(false);
        }
    };

    const isArsip = type === 'arsip';

    return (
        <div ref={containerRef} className="relative inline-block">
            <button
                ref={triggerRef}
                onClick={() => setShowDropdown(!showDropdown)}
                disabled={isExporting}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors text-sm font-medium shadow-sm"
            >
                {isExporting ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                    <Download className="w-4 h-4" />
                )}
                Export
                <ChevronDown className="w-3 h-3" />
            </button>

            {/* Wadah status selalu ada: pembaca layar hanya mengumumkan perubahan
                isi live region yang sudah terpasang, bukan region yang baru muncul. */}
            <div role="status" aria-live="polite">
                {exportNotice?.informational && (
                    <p className="mt-2 max-w-sm rounded-md border border-border bg-muted p-3 text-sm text-foreground">
                        {exportNotice.message}
                    </p>
                )}
            </div>
            {exportNotice && !exportNotice.informational && (
                <p role="alert" className="mt-2 max-w-sm rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                    {exportNotice.message}
                </p>
            )}

            {showDropdown && (
                <div ref={menuRef} className={`absolute right-0 mt-2 ${isArsip ? 'w-72' : 'w-56'} max-w-[calc(100vw-2rem)] bg-card border border-border rounded-lg shadow-xl z-50 overflow-hidden`}>
                    {isArsip ? (
                        <>
                            {/* Arsip: sub-menu for Formulir type */}
                            <div role="group" aria-labelledby={formulir4Id}>
                                <div className="px-3 py-2 border-b bg-muted/50">
                                    <p id={formulir4Id} className="text-xs font-semibold text-muted-foreground uppercase">Formulir 4 — Arsip Aktif</p>
                                    <p className="mt-0.5 text-xs text-muted-foreground">Arsip yang belum tercatat inaktif, termasuk yang JRA atau pemicu retensinya belum terverifikasi.</p>
                                </div>
                                <button
                                    onClick={() => handleExport('excel', 'formulir4')}
                                    className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-foreground hover:bg-emerald-50 dark:hover:bg-emerald-500/15 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors"
                                >
                                    <FileSpreadsheet className="w-4 h-4 text-green-600 dark:text-green-400" />
                                    Excel (.xlsx)
                                </button>
                                <button
                                    onClick={() => handleExport('pdf', 'formulir4')}
                                    className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-foreground hover:bg-red-50 dark:hover:bg-red-500/15 hover:text-red-700 dark:hover:text-red-300 transition-colors"
                                >
                                    <FileText className="w-4 h-4 text-red-600" />
                                    PDF
                                </button>
                            </div>

                            <div role="group" aria-labelledby={formulir6Id}>
                                <div className="px-3 py-2 border-t border-b bg-muted/50">
                                    <p id={formulir6Id} className="text-xs font-semibold text-muted-foreground uppercase">Formulir 6 — Arsip Inaktif</p>
                                    <p className="mt-0.5 text-xs text-muted-foreground">Arsip yang masa aktifnya sudah berakhir menurut JRA terverifikasi, atau yang pemindahannya sudah dicatat di SIMSA.</p>
                                </div>
                                <button
                                    onClick={() => handleExport('excel', 'formulir6')}
                                    className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-foreground hover:bg-emerald-50 dark:hover:bg-emerald-500/15 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors"
                                >
                                    <FileSpreadsheet className="w-4 h-4 text-green-600 dark:text-green-400" />
                                    Excel (.xlsx)
                                </button>
                                <button
                                    onClick={() => handleExport('pdf', 'formulir6')}
                                    className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-foreground hover:bg-red-50 dark:hover:bg-red-500/15 hover:text-red-700 dark:hover:text-red-300 transition-colors"
                                >
                                    <FileText className="w-4 h-4 text-red-600" />
                                    PDF
                                </button>
                            </div>
                        </>
                    ) : (
                        <>
                            {/* Surat Masuk / Surat Keluar */}
                            <button
                                onClick={() => handleExport('excel')}
                                className="flex items-center gap-3 w-full px-4 py-3 text-sm text-foreground hover:bg-emerald-50 dark:hover:bg-emerald-500/15 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors"
                            >
                                <FileSpreadsheet className="w-4 h-4 text-green-600 dark:text-green-400" />
                                Export Excel (.xlsx)
                            </button>
                            <button
                                onClick={() => handleExport('pdf')}
                                className="flex items-center gap-3 w-full px-4 py-3 text-sm text-foreground hover:bg-red-50 dark:hover:bg-red-500/15 hover:text-red-700 dark:hover:text-red-300 transition-colors border-t"
                            >
                                <FileText className="w-4 h-4 text-red-600" />
                                Export PDF
                            </button>
                        </>
                    )}
                </div>
            )}

            {/* Backdrop to close dropdown */}
            {showDropdown && (
                <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowDropdown(false)}
                />
            )}
        </div>
    );
};

export { ExportButton };
export default ExportButton;
