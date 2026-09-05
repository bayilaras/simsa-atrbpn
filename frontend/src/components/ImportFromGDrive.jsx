import { useState } from 'react';
import { Upload, X, Eye, ChevronDown, FileSpreadsheet, AlertCircle, CheckCircle2 } from 'lucide-react';
import api from '@/services/api';
import { buildGoogleSheetsImportPayload } from '@/lib/google-sheets-import';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useAppConfig } from '@/context/app-config-context';

/**
 * ImportFromGDrive — Modal component for importing data from Google Spreadsheets
 * Supports importing Surat Masuk and Surat Keluar from public Google Sheets.
 * 
 * Uses the centralized api client which automatically handles:
 * - CSRF token (X-CSRF-Token header)
 * - Credentials (cookies/sessions)
 * - Content-Type headers
 * - Error handling (401 redirect, rate limiting, etc.)
 * 
 * Props:
 * - type: 'surat-masuk' | 'surat-keluar'
 * - unitKerjaId: concrete destination unit (required)
 * - onImportComplete: () => void (callback to refresh data)
 */
const ImportFromGDrive = ({ type, unitKerjaId, onImportComplete }) => {
    const { capabilities } = useAppConfig();
    const [isOpen, setIsOpen] = useState(false);
    const [step, setStep] = useState('input'); // input, sheets, preview, importing, result
    const [spreadsheetUrl, setSpreadsheetUrl] = useState('');
    const [sheets, setSheets] = useState([]);
    const [selectedSheet, setSelectedSheet] = useState('');
    const [previewData, setPreviewData] = useState(null);
    const [importResult, setImportResult] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    const typeLabel = type === 'surat-masuk' ? 'Surat Masuk' : 'Surat Keluar';

    const reset = () => {
        setStep('input');
        setSpreadsheetUrl('');
        setSheets([]);
        setSelectedSheet('');
        setPreviewData(null);
        setImportResult(null);
        setIsLoading(false);
        setError('');
    };

    const handleOpen = () => {
        if (!unitKerjaId) return;
        reset();
        setIsOpen(true);
    };

    const handleClose = () => {
        if (step === 'importing') return;
        setIsOpen(false);
        reset();
    };

    // Step 1: Fetch available sheets (GET request — no CSRF needed, but api client handles it)
    const fetchSheets = async () => {
        if (!spreadsheetUrl) {
            setError('Masukkan URL Google Spreadsheet');
            return;
        }

        setIsLoading(true);
        setError('');

        try {
            const data = await api.get('/api/import/google-drive/sheets', {
                url: spreadsheetUrl,
            });

            setSheets(data.sheets || []);

            if (data.sheets && data.sheets.length > 0) {
                setSelectedSheet(data.sheets[0].name);
                setStep('sheets');
            } else {
                // No sheets found, let user type sheet name manually
                setStep('sheets');
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    // Step 2: Preview data from selected sheet (POST — api client sends CSRF token automatically)
    const handlePreview = async () => {
        if (!selectedSheet) {
            setError('Pilih sheet yang akan diimpor');
            return;
        }

        setIsLoading(true);
        setError('');

        try {
            const data = await api.post('/api/import/google-drive/preview', {
                spreadsheetUrl,
                sheetName: selectedSheet,
                maxRows: 10,
            });

            setPreviewData(data);
            setStep('preview');
        } catch (err) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    // Step 3: Execute import (POST — api client sends CSRF token automatically)
    // unitKerjaId is resolved from the authenticated user's session on the backend
    const handleImport = async () => {
        setStep('importing');
        setError('');

        try {
            const result = await api.post(
                `/api/import/google-drive/${type}`,
                buildGoogleSheetsImportPayload(spreadsheetUrl, selectedSheet, unitKerjaId),
            );

            setImportResult(result);
            setStep('result');

            if (result.importedRows > 0 && onImportComplete) {
                onImportComplete();
            }
        } catch (err) {
            setError(err.message);
            setStep('preview');
        }
    };

    if (!capabilities.externalIntegrations) return null;

    return (
        <>
            <button
                type="button"
                onClick={handleOpen}
                disabled={!unitKerjaId}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg border bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground shadow-sm transition-colors hover:bg-secondary/80 disabled:cursor-not-allowed disabled:opacity-50"
            >
                <Upload aria-hidden="true" className="w-4 h-4" />
                Impor dari Google Sheets
            </button>
            <Dialog open={isOpen} onOpenChange={(open) => !open && step !== 'importing' && handleClose()}>
                <DialogContent
                    showCloseButton={false}
                    onEscapeKeyDown={(event) => step === 'importing' && event.preventDefault()}
                    onInteractOutside={(event) => step === 'importing' && event.preventDefault()}
                    className="flex h-[min(90dvh,52rem)] w-full max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between border-b bg-gradient-to-r from-blue-600 to-blue-700 px-4 py-4 sm:px-6">
                        <div className="flex items-center gap-3">
                            <FileSpreadsheet aria-hidden="true" className="w-5 h-5 text-white" />
                            <div>
                                <DialogTitle className="text-lg font-semibold text-white">Impor {typeLabel}</DialogTitle>
                                <DialogDescription className="text-xs text-blue-100">Dari Google Spreadsheet</DialogDescription>
                            </div>
                        </div>
                        <button type="button" onClick={handleClose} disabled={step === 'importing'} aria-label={step === 'importing' ? 'Impor sedang berlangsung' : 'Tutup dialog impor'} className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-white/80 hover:bg-card/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-40">
                            <X aria-hidden="true" className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-4 sm:p-6">
                        {error && (
                            <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/15 dark:text-red-300">
                                <AlertCircle aria-hidden="true" className="w-4 h-4 mt-0.5 shrink-0" />
                                <p>{error}</p>
                            </div>
                        )}

                        {/* Step: Input URL */}
                        {step === 'input' && (
                            <div className="space-y-4">
                                <div>
                                    <label htmlFor="google-spreadsheet-url" className="block text-sm font-medium text-foreground mb-2">
                                        URL Google Spreadsheet
                                    </label>
                                    <input
                                        id="google-spreadsheet-url"
                                        type="url"
                                        value={spreadsheetUrl}
                                        onChange={(e) => setSpreadsheetUrl(e.target.value)}
                                        placeholder="https://docs.google.com/spreadsheets/d/..."
                                        autoComplete="url"
                                        required
                                        aria-describedby="google-spreadsheet-help"
                                        className="min-h-11 w-full rounded-lg border border-border px-4 py-2.5 text-sm focus:border-blue-500 focus:ring-2 focus:ring-ring"
                                    />
                                    <p id="google-spreadsheet-help" className="mt-2 text-xs text-muted-foreground">
                                        Lembar kerja perlu dapat diakses selama impor. Gunakan hanya data dan tautan yang telah diizinkan untuk dibagikan.
                                    </p>
                                </div>

                                <button
                                    type="button"
                                    onClick={fetchSheets}
                                    disabled={isLoading || !spreadsheetUrl}
                                    className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                                >
                                    {isLoading ? (
                                        <div aria-hidden="true" className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    ) : (
                                        <ChevronDown aria-hidden="true" className="w-4 h-4" />
                                    )}
                                    {isLoading ? 'Mengambil daftar lembar...' : 'Ambil daftar lembar'}
                                </button>
                            </div>
                        )}

                        {/* Step: Select Sheet */}
                        {step === 'sheets' && (
                            <div className="space-y-4">
                                <fieldset>
                                    <legend className="block text-sm font-medium text-foreground mb-2">
                                        Pilih lembar kerja
                                    </legend>
                                    {sheets.length > 0 ? (
                                        <div className="space-y-2 max-h-60 overflow-y-auto">
                                            {sheets.map((sheet, idx) => (
                                                <label
                                                    key={idx}
                                                    className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${selectedSheet === sheet.name
                                                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/15'
                                                        : 'border-border hover:bg-muted/50'
                                                        }`}
                                                >
                                                    <input
                                                        type="radio"
                                                        name="sheet"
                                                        value={sheet.name}
                                                        checked={selectedSheet === sheet.name}
                                                        onChange={() => setSelectedSheet(sheet.name)}
                                                        className="text-blue-600"
                                                    />
                                                    <span className="text-sm text-foreground">{sheet.name}</span>
                                                </label>
                                            ))}
                                        </div>
                                    ) : (
                                        <div>
                                            <label htmlFor="manual-sheet-name" className="sr-only">Nama lembar kerja</label>
                                            <input
                                                id="manual-sheet-name"
                                                type="text"
                                                value={selectedSheet}
                                                onChange={(e) => setSelectedSheet(e.target.value)}
                                                placeholder="Nama lembar (mis. Surat Masuk 2024)"
                                                className="min-h-11 w-full rounded-lg border border-border px-4 py-2.5 text-sm focus:border-blue-500 focus:ring-2 focus:ring-ring"
                                            />
                                            <p className="mt-2 text-xs text-muted-foreground">
                                                Daftar lembar tidak terdeteksi. Ketik nama lembar secara manual.
                                            </p>
                                        </div>
                                    )}
                                </fieldset>

                                <div className="flex flex-col-reverse gap-3 sm:flex-row">
                                    <button
                                        type="button"
                                        onClick={() => setStep('input')}
                                        className="min-h-11 flex-1 rounded-lg border border-border py-2.5 text-sm text-foreground transition-colors hover:bg-muted/50"
                                    >
                                        Kembali
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handlePreview}
                                        disabled={isLoading || !selectedSheet}
                                        className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                                    >
                                        {isLoading ? (
                                            <div aria-hidden="true" className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                        ) : (
                                            <Eye aria-hidden="true" className="w-4 h-4" />
                                        )}
                                        {isLoading ? 'Menyiapkan pratinjau...' : 'Pratinjau data'}
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Step: Preview */}
                        {step === 'preview' && previewData && (
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <p className="text-sm text-muted-foreground">
                                        Menampilkan <strong>{previewData.rows.length}</strong> dari <strong>{previewData.totalRows}</strong> baris
                                    </p>
                                    <span className="text-xs bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 px-2 py-1 rounded-full">
                                        Lembar: {selectedSheet}
                                    </span>
                                </div>

                                <div className="overflow-x-auto border rounded-lg">
                                    <table className="w-full text-xs">
                                        <caption className="sr-only">Pratinjau data yang akan diimpor</caption>
                                        <thead>
                                            <tr className="bg-muted/50 border-b">
                                                {previewData.headers.map((h, i) => (
                                                    <th key={i} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">
                                                        {h}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {previewData.rows.map((row, ri) => (
                                                <tr key={ri} className={ri % 2 === 0 ? 'bg-card' : 'bg-muted/50'}>
                                                    {row.map((cell, ci) => (
                                                        <td key={ci} className="px-3 py-2 text-foreground whitespace-nowrap max-w-[200px] truncate">
                                                            {cell}
                                                        </td>
                                                    ))}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                <div className="flex flex-col-reverse gap-3 sm:flex-row">
                                    <button
                                        type="button"
                                        onClick={() => setStep('sheets')}
                                        className="min-h-11 flex-1 rounded-lg border border-border py-2.5 text-sm text-foreground transition-colors hover:bg-muted/50"
                                    >
                                        Kembali
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleImport}
                                        className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
                                    >
                                        <Upload aria-hidden="true" className="w-4 h-4" />
                                        Impor {previewData.totalRows} baris
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Step: Importing */}
                        {step === 'importing' && (
                            <div role="status" aria-live="polite" className="flex flex-col items-center py-12">
                                <div aria-hidden="true" className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4" />
                                <p className="text-sm text-muted-foreground font-medium">Mengimpor data...</p>
                                <p className="text-xs text-muted-foreground mt-1">Harap tunggu, proses ini mungkin memakan waktu</p>
                            </div>
                        )}

                        {/* Step: Result */}
                        {step === 'result' && importResult && (
                            <div role="status" aria-live="polite" className="space-y-4">
                                <div className={`flex items-start gap-3 p-4 rounded-lg ${importResult.importedRows > 0
                                    ? 'bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200'
                                    : 'bg-red-50 dark:bg-red-500/15 border border-red-200'
                                    }`}>
                                    {importResult.importedRows > 0 ? (
                                        <CheckCircle2 aria-hidden="true" className="w-5 h-5 text-emerald-600 dark:text-emerald-400 mt-0.5" />
                                    ) : (
                                        <AlertCircle aria-hidden="true" className="w-5 h-5 text-red-600 mt-0.5" />
                                    )}
                                    <div>
                                        <p className="font-medium text-foreground">
                                            {importResult.importedRows > 0 ? 'Impor berhasil!' : 'Impor gagal'}
                                        </p>
                                        <p className="text-sm text-muted-foreground mt-1">
                                            {importResult.importedRows} dari {importResult.totalRows} baris berhasil diimpor
                                        </p>
                                        {importResult.skippedRows > 0 && (
                                            <p className="text-sm text-amber-600 dark:text-amber-400 mt-1">
                                                {importResult.skippedRows} baris dilewati (data tidak valid/kosong)
                                            </p>
                                        )}
                                        {importResult.duplicateRows > 0 && (
                                            <p className="text-sm text-blue-600 mt-1">
                                                {importResult.duplicateRows} baris duplikat dilewati (sudah ada di sistem)
                                            </p>
                                        )}
                                    </div>
                                </div>

                                {importResult.errors && importResult.errors.length > 0 && (
                                    <div className="border rounded-lg p-3 max-h-40 overflow-y-auto bg-muted/50">
                                        <p className="text-xs font-medium text-muted-foreground mb-2">Rincian kesalahan:</p>
                                        {importResult.errors.map((err, i) => (
                                            <p key={i} className="text-xs text-red-600 leading-relaxed">{err}</p>
                                        ))}
                                    </div>
                                )}

                                <button
                                    type="button"
                                    onClick={handleClose}
                                    className="min-h-11 w-full rounded-lg bg-muted py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/80"
                                >
                                    Tutup
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Step indicator */}
                    <div aria-hidden="true" className="px-6 py-3 border-t bg-muted/50 flex items-center justify-center gap-2">
                        {['input', 'sheets', 'preview', 'result'].map((s) => (
                            <div
                                key={s}
                                className={`w-2 h-2 rounded-full transition-colors ${step === s || (step === 'importing' && s === 'result')
                                    ? 'bg-primary'
                                    : 'bg-gray-300'
                                    }`}
                            />
                        ))}
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
};

export default ImportFromGDrive;
