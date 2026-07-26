import React, { useState } from 'react';
import { Download, FileSpreadsheet, FileText, ChevronDown } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';

/**
 * ExportButton - dropdown for exporting data in Excel/PDF
 * For arsip, supports Formulir 4 (Arsip Aktif) and Formulir 6 (Arsip Inaktif)
 */
const ExportButton = ({ type, filters = {} }) => {
    const [isExporting, setIsExporting] = useState(false);
    const [showDropdown, setShowDropdown] = useState(false);
    const [showArsipSubMenu, setShowArsipSubMenu] = useState(false);

    const handleExport = async (format, formulirType = null) => {
        setIsExporting(true);
        setShowDropdown(false);
        setShowArsipSubMenu(false);

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

            const url = `${API_BASE}/api/export/${type}/${format}?${queryParams}`;

            const response = await fetch(url, {
                method: 'GET',
                credentials: 'include',
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `Export failed with status ${response.status}`);
            }

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
            console.error('Export error:', error);
            alert(`Gagal mengekspor: ${error.message}`);
        } finally {
            setIsExporting(false);
        }
    };

    const isArsip = type === 'arsip';

    return (
        <div className="relative inline-block">
            <button
                onClick={() => setShowDropdown(!showDropdown)}
                disabled={isExporting}
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors text-sm font-medium shadow-sm"
            >
                {isExporting ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                    <Download className="w-4 h-4" />
                )}
                Export
                <ChevronDown className="w-3 h-3" />
            </button>

            {showDropdown && (
                <div className="absolute right-0 mt-2 w-56 bg-card border border-border rounded-lg shadow-xl z-50 overflow-hidden">
                    {isArsip ? (
                        <>
                            {/* Arsip: sub-menu for Formulir type */}
                            <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase border-b bg-muted/50">
                                Formulir 4 — Arsip Aktif
                            </div>
                            <button
                                onClick={() => handleExport('excel', 'formulir4')}
                                className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-foreground hover:bg-emerald-50 dark:bg-emerald-500/15 hover:text-emerald-700 dark:text-emerald-300 transition-colors"
                            >
                                <FileSpreadsheet className="w-4 h-4 text-green-600 dark:text-green-400" />
                                Excel (.xlsx)
                            </button>
                            <button
                                onClick={() => handleExport('pdf', 'formulir4')}
                                className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-foreground hover:bg-red-50 dark:bg-red-500/15 hover:text-red-700 dark:text-red-300 transition-colors"
                            >
                                <FileText className="w-4 h-4 text-red-600" />
                                PDF
                            </button>

                            <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase border-t border-b bg-muted/50">
                                Formulir 6 — Arsip Inaktif
                            </div>
                            <button
                                onClick={() => handleExport('excel', 'formulir6')}
                                className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-foreground hover:bg-emerald-50 dark:bg-emerald-500/15 hover:text-emerald-700 dark:text-emerald-300 transition-colors"
                            >
                                <FileSpreadsheet className="w-4 h-4 text-green-600 dark:text-green-400" />
                                Excel (.xlsx)
                            </button>
                            <button
                                onClick={() => handleExport('pdf', 'formulir6')}
                                className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-foreground hover:bg-red-50 dark:bg-red-500/15 hover:text-red-700 dark:text-red-300 transition-colors"
                            >
                                <FileText className="w-4 h-4 text-red-600" />
                                PDF
                            </button>
                        </>
                    ) : (
                        <>
                            {/* Surat Masuk / Surat Keluar */}
                            <button
                                onClick={() => handleExport('excel')}
                                className="flex items-center gap-3 w-full px-4 py-3 text-sm text-foreground hover:bg-emerald-50 dark:bg-emerald-500/15 hover:text-emerald-700 dark:text-emerald-300 transition-colors"
                            >
                                <FileSpreadsheet className="w-4 h-4 text-green-600 dark:text-green-400" />
                                Export Excel (.xlsx)
                            </button>
                            <button
                                onClick={() => handleExport('pdf')}
                                className="flex items-center gap-3 w-full px-4 py-3 text-sm text-foreground hover:bg-red-50 dark:bg-red-500/15 hover:text-red-700 dark:text-red-300 transition-colors border-t"
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
                    onClick={() => {
                        setShowDropdown(false);
                        setShowArsipSubMenu(false);
                    }}
                />
            )}
        </div>
    );
};

export { ExportButton };
export default ExportButton;
