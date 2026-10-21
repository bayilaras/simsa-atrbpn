import { useEffect, useRef, useState } from 'react';
import { Upload, X, Eye, ChevronDown, FileSpreadsheet, AlertCircle, CheckCircle2 } from 'lucide-react';
import api from '@/services/api';
import { addImportPart, buildGoogleSheetsImportPayload, emptyImportTotals, IMPORT_PART_TIMEOUT_MS } from '@/lib/google-sheets-import';
import { runResumableImport, unfinishedImportNotice } from '@/lib/resumable-import';
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
 *
 * Long sheets are imported in parts: the server stops starting rows after a
 * time budget and returns where to continue, and the dialog sends the next
 * part until the server reports the end.
 */
const ImportFromGDriveFlow = ({ type, unitKerjaId, onImportComplete }) => {
    const { capabilities } = useAppConfig();
    const [isOpen, setIsOpen] = useState(false);
    const [step, setStep] = useState('input'); // input, sheets, preview, importing, result
    const [spreadsheetUrl, setSpreadsheetUrl] = useState('');
    const [sheets, setSheets] = useState([]);
    const [selectedGid, setSelectedGid] = useState('');
    const [previewData, setPreviewData] = useState(null);
    const [importResult, setImportResult] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const requestRef = useRef(0);
    const busyRef = useRef(false);
    const [retryUntil, setRetryUntil] = useState({ sheets: 0, preview: 0, import: 0 });
    const [now, setNow] = useState(() => Date.now());
    const [progress, setProgress] = useState(null);
    // When a rate-limited later part is sent again automatically.
    const [continueAt, setContinueAt] = useState(0);
    const [stopping, setStopping] = useState(false);
    const stopRef = useRef(false);
    const action = step === 'input' ? 'sheets' : step === 'sheets' ? 'preview' : 'import';
    const retrySeconds = Math.max(0, Math.ceil((retryUntil[action] - now) / 1000));
    const continueSeconds = Math.max(0, Math.ceil((continueAt - now) / 1000));

    useEffect(() => () => { requestRef.current += 1; }, []);
    useEffect(() => {
        const until = Math.max(...Object.values(retryUntil), continueAt);
        if (!isOpen || until <= Date.now()) return;
        const timer = window.setInterval(() => {
            const time = Date.now();
            setNow(time);
            if (time >= until) window.clearInterval(timer);
        }, 1000);
        return () => window.clearInterval(timer);
    }, [isOpen, retryUntil, continueAt]);

    const typeLabel = type === 'surat-masuk' ? 'Surat Masuk' : 'Surat Keluar';
    const selectedName = sheets.find(sheet => sheet.gid === selectedGid)?.name || '';
    const duplicateOnly = importResult?.success === true && importResult.importedRows === 0
        && importResult.duplicateRows > 0 && !importResult.skippedRows && !importResult.errors?.length;
    const resultCompleted = importResult?.importedRows > 0 || duplicateOnly;

    const invalidatePreview = () => {
        requestRef.current += 1;
        busyRef.current = false;
        setIsLoading(false);
        setPreviewData(null);
        setError('');
    };

    const handleRequestError = (err, operation) => {
        setError(err.message || 'Permintaan gagal. Silakan coba lagi.');
        if ((err.status || err.response?.status) === 429) {
            const reported = Number(err.data?.retryAfterSeconds ?? err.response?.data?.retryAfterSeconds
                ?? err.response?.headers?.get?.('Retry-After'));
            const seconds = Number.isFinite(reported) && reported > 0 ? Math.ceil(reported) : 60;
            const time = Date.now();
            setNow(time);
            setRetryUntil(previous => ({ ...previous, [operation]: time + seconds * 1000 }));
        }
    };

    const reset = () => {
        invalidatePreview();
        setStep('input');
        setSpreadsheetUrl('');
        setSheets([]);
        setSelectedGid('');
        setPreviewData(null);
        setImportResult(null);
        setIsLoading(false);
        setError('');
        setNow(Date.now());
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
        if (busyRef.current || retryUntil.sheets > Date.now()) return;
        if (!spreadsheetUrl) {
            setError('Masukkan URL Google Spreadsheet');
            return;
        }

        const request = ++requestRef.current;
        busyRef.current = true;
        setIsLoading(true);
        setError('');
        setPreviewData(null);

        try {
            const data = await api.get('/api/import/google-drive/sheets', {
                url: spreadsheetUrl,
            });

            if (request !== requestRef.current) return;
            // Tabs are chosen by gid. When the tab list is unreadable, only the
            // tab named by the pasted link is offered: a typed name could
            // silently resolve to the first tab.
            const detected = Array.isArray(data.sheets) ? data.sheets : [];
            const linkedMissing = data.linkedGid && !detected.some(sheet => sheet.gid === data.linkedGid);
            const options = linkedMissing
                ? [...detected, { gid: data.linkedGid, name: `Lembar dari tautan (gid ${data.linkedGid})` }] : detected;
            setSheets(options);
            setSelectedGid((options.find(sheet => sheet.gid === data.linkedGid) || options[0])?.gid || '');
            setStep('sheets');
        } catch (err) {
            if (request === requestRef.current) handleRequestError(err, 'sheets');
        } finally {
            if (request === requestRef.current) {
                busyRef.current = false;
                setIsLoading(false);
            }
        }
    };

    // Step 2: Preview data from selected sheet (POST — api client sends CSRF token automatically)
    const handlePreview = async () => {
        if (busyRef.current || retryUntil.preview > Date.now()) return;
        if (!selectedGid) {
            setError('Pilih sheet yang akan diimpor');
            return;
        }

        const request = ++requestRef.current;
        busyRef.current = true;
        setIsLoading(true);
        setError('');
        setPreviewData(null);

        try {
            const data = await api.post('/api/import/google-drive/preview', {
                spreadsheetUrl,
                gid: selectedGid,
                maxRows: 10,
                type,
            });

            if (request !== requestRef.current) return;
            if (data.importType !== type || !Array.isArray(data.mapping) || !data.mapping.length
                || !Number.isInteger(data.headerRow) || data.headerRow < 1) {
                throw new Error('Pemetaan kolom belum dapat diverifikasi. Periksa pratinjau kembali.');
            }
            setPreviewData(data);
            setStep('preview');
        } catch (err) {
            if (request === requestRef.current) handleRequestError(err, 'preview');
        } finally {
            if (request === requestRef.current) {
                busyRef.current = false;
                setIsLoading(false);
            }
        }
    };

    // Step 3: Execute import (POST — api client sends CSRF token automatically)
    // The backend verifies the selected destination against the authenticated user's scope.
    const handleImport = async () => {
        if (busyRef.current || retryUntil.import > Date.now() || previewData?.importType !== type) return;
        const request = ++requestRef.current;
        busyRef.current = true;
        stopRef.current = false;
        setStopping(false);
        setStep('importing');
        setError('');
        const source = buildGoogleSheetsImportPayload(spreadsheetUrl, selectedGid, unitKerjaId);
        let totals = emptyImportTotals(previewData.totalRows);
        setProgress(totals);

        try {
            const outcome = await runResumableImport({
                sendPart: position => api.post(`/api/import/google-drive/${type}`, { ...source, ...position },
                    { timeoutMs: IMPORT_PART_TIMEOUT_MS }),
                onPart: part => { totals = addImportPart(totals, part); setProgress(totals); },
                onWait: until => { setNow(Date.now()); setContinueAt(until); },
                shouldStop: () => stopRef.current,
                isCurrent: () => request === requestRef.current,
            });
            if (outcome.cancelled) return;
            const notice = unfinishedImportNotice(outcome, totals);
            const result = notice ? { ...totals, notice } : totals;
            setImportResult(result);
            setStep('result');

            if (result.importedRows > 0 && onImportComplete) {
                onImportComplete();
            }
        } catch (err) {
            if (request === requestRef.current) {
                handleRequestError(err, 'import');
                setStep('preview');
            }
        } finally {
            if (request === requestRef.current) {
                busyRef.current = false;
                setContinueAt(0);
            }
        }
    };

    const requestStop = () => {
        stopRef.current = true;
        setStopping(true);
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
                        {retrySeconds > 0 && <p role="status" className="mb-4 text-sm text-muted-foreground">
                            Permintaan ini dapat dicoba lagi dalam {retrySeconds} detik.
                        </p>}

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
                                        onChange={(e) => {
                                            invalidatePreview();
                                            setSpreadsheetUrl(e.target.value);
                                            setSheets([]);
                                            setSelectedGid('');
                                        }}
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
                                    disabled={isLoading || retrySeconds > 0 || !spreadsheetUrl}
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
                                            {sheets.map((sheet) => (
                                                <label
                                                    key={sheet.gid}
                                                    className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${selectedGid === sheet.gid
                                                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/15'
                                                        : 'border-border hover:bg-muted/50'
                                                        }`}
                                                >
                                                    <input
                                                        type="radio"
                                                        name="sheet"
                                                        value={sheet.gid}
                                                        checked={selectedGid === sheet.gid}
                                                        onChange={() => { invalidatePreview(); setSelectedGid(sheet.gid); }}
                                                        className="text-blue-600"
                                                    />
                                                    <span className="text-sm text-foreground">{sheet.name}</span>
                                                </label>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-sm text-muted-foreground">
                                            Daftar lembar tidak terdeteksi. Buka tab yang ingin diimpor di Google Sheets,
                                            salin tautan dari tab tersebut (berisi <code>gid=</code>), lalu tempel pada langkah sebelumnya.
                                        </p>
                                    )}
                                </fieldset>

                                <div className="flex flex-col-reverse gap-3 sm:flex-row">
                                    <button
                                        type="button"
                                        onClick={() => { invalidatePreview(); setStep('input'); }}
                                        className="min-h-11 flex-1 rounded-lg border border-border py-2.5 text-sm text-foreground transition-colors hover:bg-muted/50"
                                    >
                                        Kembali
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handlePreview}
                                        disabled={isLoading || retrySeconds > 0 || !selectedGid}
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
                                <div className="space-y-2">
                                    <p className="text-sm font-medium">Tujuan: {typeLabel}</p>
                                    <p className="text-xs text-muted-foreground">Judul ditemukan pada baris data ke-{previewData.headerRow} (baris kosong tidak dihitung).</p>
                                    <p className="text-sm text-muted-foreground">Setiap baris perlu tanggal surat yang valid (YYYY-MM-DD atau DD/MM/YYYY). Jika nomor surat kosong atau “-”, isi perihal serta pengirim atau tujuan (untuk surat keluar, tautan dokumen juga cukup) agar data dapat dikenali saat impor ulang.</p>
                                    <div className="overflow-x-auto rounded-lg border">
                                        <table className="w-full text-sm">
                                            <caption className="p-2 text-left font-medium">Pemetaan kolom ke data SIMSA</caption>
                                            <thead><tr className="border-b bg-muted/50">
                                                <th className="px-3 py-2 text-left">Kolom lembar kerja</th>
                                                <th className="px-3 py-2 text-left">Data SIMSA</th>
                                            </tr></thead>
                                            <tbody>{previewData.mapping.map(item => <tr key={item.field} className="border-b last:border-0">
                                                <td className="px-3 py-2">Kolom {item.columnIndex + 1}: {item.header}</td>
                                                <td className="px-3 py-2">{item.label}</td>
                                            </tr>)}</tbody>
                                        </table>
                                    </div>
                                </div>
                                <div className="flex items-center justify-between">
                                    <p className="text-sm text-muted-foreground">
                                        Menampilkan <strong>{previewData.rows.length}</strong> dari <strong>{previewData.totalRows}</strong> baris
                                    </p>
                                    <span className="text-xs bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 px-2 py-1 rounded-full">
                                        Lembar: {selectedName}
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
                                        onClick={() => { invalidatePreview(); setStep('sheets'); }}
                                        className="min-h-11 flex-1 rounded-lg border border-border py-2.5 text-sm text-foreground transition-colors hover:bg-muted/50"
                                    >
                                        Kembali
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleImport}
                                        disabled={retrySeconds > 0 || previewData.totalRows < 1}
                                        className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                                    >
                                        <Upload aria-hidden="true" className="w-4 h-4" />
                                        Impor {previewData.totalRows} baris
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Step: Importing */}
                        {step === 'importing' && (
                            <div className="flex flex-col items-center py-12">
                                <div aria-hidden="true" className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4" />
                                <div role="status" aria-live="polite" className="flex w-full flex-col items-center text-center">
                                    <p className="text-sm text-muted-foreground font-medium">Mengimpor data...</p>
                                    {progress && <>
                                        <div role="progressbar" aria-label="Kemajuan impor" aria-valuemin={0}
                                            aria-valuemax={progress.totalRows} aria-valuenow={progress.processedRows}
                                            className="mt-4 h-2 w-full max-w-sm overflow-hidden rounded-full bg-muted">
                                            <div className="h-full bg-primary transition-[width]"
                                                style={{ width: `${progress.totalRows ? Math.round(progress.processedRows / progress.totalRows * 100) : 0}%` }} />
                                        </div>
                                        <p className="mt-2 text-sm text-foreground">{`${progress.processedRows} dari ${progress.totalRows} baris diproses`}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {`Tersimpan ${progress.importedRows} · duplikat ${progress.duplicateRows} · dilewati ${progress.skippedRows}`}
                                        </p>
                                    </>}
                                    {continueSeconds > 0 && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                                        Batas permintaan impor tercapai; dilanjutkan otomatis dalam {continueSeconds} detik.
                                    </p>}
                                </div>
                                <p className="mt-3 max-w-sm text-center text-xs text-muted-foreground">
                                    Biarkan jendela ini terbuka. Lembar yang panjang diimpor per bagian; baris yang sudah tersimpan tetap tercatat bila impor dihentikan.
                                </p>
                                <button type="button" onClick={requestStop} disabled={stopping}
                                    className="mt-4 min-h-11 rounded-lg border border-border px-4 py-2 text-sm text-foreground transition-colors hover:bg-muted/50 disabled:opacity-50">
                                    {stopping ? 'Menghentikan setelah bagian ini…' : 'Hentikan setelah bagian ini'}
                                </button>
                            </div>
                        )}

                        {/* Step: Result */}
                        {step === 'result' && importResult && (
                            <div role="status" aria-live="polite" className="space-y-4">
                                <div className={`flex items-start gap-3 p-4 rounded-lg ${importResult.notice
                                    ? 'bg-amber-50 dark:bg-amber-500/15 border border-amber-200'
                                    : resultCompleted
                                        ? 'bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200'
                                        : 'bg-red-50 dark:bg-red-500/15 border border-red-200'
                                    }`}>
                                    {resultCompleted && !importResult.notice ? (
                                        <CheckCircle2 aria-hidden="true" className="w-5 h-5 text-emerald-600 dark:text-emerald-400 mt-0.5" />
                                    ) : (
                                        <AlertCircle aria-hidden="true" className={`w-5 h-5 mt-0.5 ${importResult.notice ? 'text-amber-600' : 'text-red-600'}`} />
                                    )}
                                    <div>
                                        <p className="font-medium text-foreground">
                                            {importResult.notice ? 'Impor belum selesai'
                                                : duplicateOnly ? 'Semua data sudah ada' : importResult.importedRows > 0 ? 'Impor berhasil!' : 'Impor gagal'}
                                        </p>
                                        {importResult.notice && (
                                            <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">{importResult.notice}</p>
                                        )}
                                        <p className="text-sm text-muted-foreground mt-1">
                                            {duplicateOnly ? 'Seluruh baris sudah tercatat; tidak ada data baru yang ditambahkan.'
                                                : `${importResult.importedRows} dari ${importResult.totalRows} baris berhasil diimpor`}
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

// A verified preview belongs to one record type and destination unit.
const ImportFromGDrive = props => <ImportFromGDriveFlow
    key={JSON.stringify([props.type, props.unitKerjaId])} {...props} />;

export default ImportFromGDrive;
