import React, { useState } from 'react';
import { Upload, X, Eye, ChevronDown, FileSpreadsheet, AlertCircle, CheckCircle2 } from 'lucide-react';
import api from '@/services/api';

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
 * unitKerjaId is resolved automatically from the authenticated user's session
 * on the backend, respecting user roles (super_admin, admin_dirjen, admin_sesditjen, user).
 * 
 * Props:
 * - type: 'surat-masuk' | 'surat-keluar'
 * - onImportComplete: () => void (callback to refresh data)
 */
const ImportFromGDrive = ({ type, onImportComplete }) => {
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
        reset();
        setIsOpen(true);
    };

    const handleClose = () => {
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
            const result = await api.post(`/api/import/google-drive/${type}`, {
                spreadsheetUrl,
                sheetName: selectedSheet,
            });

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

    if (!isOpen) {
        return (
            <button
                onClick={handleOpen}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium shadow-sm"
            >
                <Upload className="w-4 h-4" />
                Import dari Google Drive
            </button>
        );
    }

    return (
        <>
            {/* Backdrop */}
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={handleClose}>
                <div
                    className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-blue-600 to-blue-700">
                        <div className="flex items-center gap-3">
                            <FileSpreadsheet className="w-5 h-5 text-white" />
                            <div>
                                <h2 className="text-lg font-semibold text-white">Import {typeLabel}</h2>
                                <p className="text-blue-100 text-xs">Dari Google Spreadsheet</p>
                            </div>
                        </div>
                        <button onClick={handleClose} className="p-1 text-white/80 hover:text-white rounded-lg hover:bg-white/10">
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-6">
                        {error && (
                            <div className="flex items-start gap-2 mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                                <p>{error}</p>
                            </div>
                        )}

                        {/* Step: Input URL */}
                        {step === 'input' && (
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        URL Google Spreadsheet
                                    </label>
                                    <input
                                        type="url"
                                        value={spreadsheetUrl}
                                        onChange={(e) => setSpreadsheetUrl(e.target.value)}
                                        placeholder="https://docs.google.com/spreadsheets/d/..."
                                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                                    />
                                    <p className="mt-2 text-xs text-gray-500">
                                        Pastikan spreadsheet bersifat publik (dapat diakses semua orang)
                                    </p>
                                </div>

                                <button
                                    onClick={fetchSheets}
                                    disabled={isLoading || !spreadsheetUrl}
                                    className="w-full py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium flex items-center justify-center gap-2"
                                >
                                    {isLoading ? (
                                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    ) : (
                                        <ChevronDown className="w-4 h-4" />
                                    )}
                                    Ambil Daftar Sheet
                                </button>
                            </div>
                        )}

                        {/* Step: Select Sheet */}
                        {step === 'sheets' && (
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Pilih Sheet
                                    </label>
                                    {sheets.length > 0 ? (
                                        <div className="space-y-2 max-h-60 overflow-y-auto">
                                            {sheets.map((sheet, idx) => (
                                                <label
                                                    key={idx}
                                                    className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${selectedSheet === sheet.name
                                                        ? 'border-blue-500 bg-blue-50'
                                                        : 'border-gray-200 hover:bg-gray-50'
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
                                                    <span className="text-sm text-gray-700">{sheet.name}</span>
                                                </label>
                                            ))}
                                        </div>
                                    ) : (
                                        <div>
                                            <input
                                                type="text"
                                                value={selectedSheet}
                                                onChange={(e) => setSelectedSheet(e.target.value)}
                                                placeholder="Nama sheet (mis. Surat Masuk 2024)"
                                                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                                            />
                                            <p className="mt-2 text-xs text-gray-500">
                                                Daftar sheet tidak terdeteksi. Ketik nama sheet secara manual.
                                            </p>
                                        </div>
                                    )}
                                </div>

                                <div className="flex gap-3">
                                    <button
                                        onClick={() => setStep('input')}
                                        className="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm"
                                    >
                                        Kembali
                                    </button>
                                    <button
                                        onClick={handlePreview}
                                        disabled={isLoading || !selectedSheet}
                                        className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium flex items-center justify-center gap-2"
                                    >
                                        {isLoading ? (
                                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                        ) : (
                                            <Eye className="w-4 h-4" />
                                        )}
                                        Preview Data
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Step: Preview */}
                        {step === 'preview' && previewData && (
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <p className="text-sm text-gray-600">
                                        Menampilkan <strong>{previewData.rows.length}</strong> dari <strong>{previewData.totalRows}</strong> baris
                                    </p>
                                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
                                        Sheet: {selectedSheet}
                                    </span>
                                </div>

                                <div className="overflow-x-auto border rounded-lg">
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr className="bg-gray-50 border-b">
                                                {previewData.headers.map((h, i) => (
                                                    <th key={i} className="px-3 py-2 text-left font-medium text-gray-600 whitespace-nowrap">
                                                        {h}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {previewData.rows.map((row, ri) => (
                                                <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                                    {row.map((cell, ci) => (
                                                        <td key={ci} className="px-3 py-2 text-gray-700 whitespace-nowrap max-w-[200px] truncate">
                                                            {cell}
                                                        </td>
                                                    ))}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                <div className="flex gap-3">
                                    <button
                                        onClick={() => setStep('sheets')}
                                        className="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm"
                                    >
                                        Kembali
                                    </button>
                                    <button
                                        onClick={handleImport}
                                        className="flex-1 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors text-sm font-medium flex items-center justify-center gap-2"
                                    >
                                        <Upload className="w-4 h-4" />
                                        Import {previewData.totalRows} Baris
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Step: Importing */}
                        {step === 'importing' && (
                            <div className="flex flex-col items-center py-12">
                                <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4" />
                                <p className="text-sm text-gray-600 font-medium">Mengimpor data...</p>
                                <p className="text-xs text-gray-400 mt-1">Harap tunggu, proses ini mungkin memakan waktu</p>
                            </div>
                        )}

                        {/* Step: Result */}
                        {step === 'result' && importResult && (
                            <div className="space-y-4">
                                <div className={`flex items-start gap-3 p-4 rounded-lg ${importResult.importedRows > 0
                                    ? 'bg-emerald-50 border border-emerald-200'
                                    : 'bg-red-50 border border-red-200'
                                    }`}>
                                    {importResult.importedRows > 0 ? (
                                        <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5" />
                                    ) : (
                                        <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
                                    )}
                                    <div>
                                        <p className="font-medium text-gray-800">
                                            {importResult.importedRows > 0 ? 'Import Berhasil!' : 'Import Gagal'}
                                        </p>
                                        <p className="text-sm text-gray-600 mt-1">
                                            {importResult.importedRows} dari {importResult.totalRows} baris berhasil diimpor
                                        </p>
                                        {importResult.skippedRows > 0 && (
                                            <p className="text-sm text-amber-600 mt-1">
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
                                    <div className="border rounded-lg p-3 max-h-40 overflow-y-auto bg-gray-50">
                                        <p className="text-xs font-medium text-gray-500 mb-2">Detail Error:</p>
                                        {importResult.errors.map((err, i) => (
                                            <p key={i} className="text-xs text-red-600 leading-relaxed">{err}</p>
                                        ))}
                                    </div>
                                )}

                                <button
                                    onClick={handleClose}
                                    className="w-full py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium"
                                >
                                    Tutup
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Step indicator */}
                    <div className="px-6 py-3 border-t bg-gray-50 flex items-center justify-center gap-2">
                        {['input', 'sheets', 'preview', 'result'].map((s, i) => (
                            <div
                                key={s}
                                className={`w-2 h-2 rounded-full transition-colors ${step === s || (step === 'importing' && s === 'result')
                                    ? 'bg-blue-600'
                                    : 'bg-gray-300'
                                    }`}
                            />
                        ))}
                    </div>
                </div>
            </div>
        </>
    );
};

export default ImportFromGDrive;
