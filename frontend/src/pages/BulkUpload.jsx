import React, { useState, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useOCRUpload } from '@/hooks/useOCRUpload';
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
    CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
    Upload,
    File,
    X,
    Check,
    AlertCircle,
    Loader2,
    FileText,
    ChevronLeft,
    Edit,
    Save,
    CloudUpload,
    Trash2,
    FileType
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function BulkUpload() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const fileInputRef = useRef(null);
    const [dragActive, setDragActive] = useState(false);
    const [editingItem, setEditingItem] = useState(null);
    const [editedData, setEditedData] = useState({});

    const {
        files,
        batch,
        isUploading,
        isProcessing,
        error,
        progress,
        addFiles,
        removeFile,
        clearFiles,
        upload,
        confirmBatch,
        setError,
    } = useOCRUpload(user?.unitKerjaId);

    // Drag handlers
    const handleDrag = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'dragenter' || e.type === 'dragover') {
            setDragActive(true);
        } else if (e.type === 'dragleave') {
            setDragActive(false);
        }
    }, []);

    const handleDrop = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            addFiles(e.dataTransfer.files);
        }
    }, [addFiles]);

    const handleFileSelect = useCallback((e) => {
        if (e.target.files && e.target.files.length > 0) {
            addFiles(e.target.files);
        }
    }, [addFiles]);

    const handleUpload = async () => {
        await upload();
    };

    const handleConfirm = async () => {
        if (!batch) return;

        const items = batch.items
            .filter((item) => item.status === 'completed')
            .map((item) => {
                const edited = editedData[item.id] || {};
                return {
                    itemId: item.id,
                    nomorBerkas: edited.nomorBerkas || item.metadata?.nomorSurat || '',
                    uraianBerkas: edited.uraianBerkas || item.metadata?.perihal || '',
                    kodeKlasifikasi: edited.kodeKlasifikasi || '',
                    tahun: edited.tahun || new Date().getFullYear(),
                    jenisArsip: edited.jenisArsip || 'masuk',
                };
            });

        const result = await confirmBatch(items);
        if (result) {
            navigate('/arsip', {
                state: { message: `${result.created} arsip berhasil disimpan` }
            });
        }
    };

    const startEditing = (item) => {
        setEditingItem(item.id);
        setEditedData((prev) => ({
            ...prev,
            [item.id]: prev[item.id] || {
                nomorBerkas: item.metadata?.nomorSurat || '',
                uraianBerkas: item.metadata?.perihal || '',
                tahun: new Date().getFullYear(),
                jenisArsip: 'masuk',
            },
        }));
    };

    const updateEditedData = (itemId, field, value) => {
        setEditedData((prev) => ({
            ...prev,
            [itemId]: {
                ...prev[itemId],
                [field]: value,
            },
        }));
    };

    const formatFileSize = (bytes) => {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };

    return (
        <div className="space-y-6">
            {/* Hero Header */}
            <div className="rounded-xl overflow-hidden bg-gradient-to-r from-blue-600 to-indigo-700 p-8 text-white shadow-lg relative">
                <div className="absolute top-0 right-0 p-4 opacity-10">
                    <CloudUpload className="h-64 w-64" />
                </div>
                <div className="relative z-10">
                    <div className="flex items-center gap-3 mb-2">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => navigate('/arsip')}
                            className="text-white/80 hover:text-white hover:bg-card/20 -ml-2"
                        >
                            <ChevronLeft className="h-5 w-5" />
                        </Button>
                        <h1 className="text-3xl font-bold">Bulk Upload & OCR</h1>
                    </div>
                    <p className="text-blue-100 max-w-2xl text-lg">
                        Upload banyak file PDF sekaligus, sistem akan otomatis mengekstrak informasi dan menyiapkan draft arsip untuk Anda.
                    </p>
                </div>
            </div>

            {error && (
                <Alert variant="destructive" className="animate-in fade-in slide-in-from-top-2">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            <AnimatePresence mode="wait">
                {/* Upload Phase */}
                {!batch && !isProcessing && (
                    <motion.div
                        key="upload"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                    >
                        <Card className="border-2 border-dashed border-border dark:border-gray-800 shadow-sm hover:border-blue-400 dark:hover:border-blue-500 transition-colors bg-card/50 dark:bg-foreground/50 backdrop-blur-sm">
                            <CardContent className="p-10">
                                <div
                                    className={`
                                        flex flex-col items-center justify-center p-12 text-center cursor-pointer rounded-2xl transition-all duration-300
                                        ${dragActive ? 'bg-blue-50/80 border-blue-500 dark:bg-blue-900/20' : 'bg-muted/50 dark:bg-foreground/50 hover:bg-muted/50 dark:hover:bg-foreground'}
                                    `}
                                    onDragEnter={handleDrag}
                                    onDragLeave={handleDrag}
                                    onDragOver={handleDrag}
                                    onDrop={handleDrop}
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept=".pdf,application/pdf"
                                        multiple
                                        onChange={handleFileSelect}
                                        className="hidden"
                                    />
                                    <div className={`p-4 rounded-full mb-4 ${dragActive ? 'bg-blue-100 text-blue-600 dark:text-blue-400' : 'bg-blue-50 text-blue-500 dark:bg-blue-900/30'}`}>
                                        <CloudUpload className="h-10 w-10" />
                                    </div>
                                    <h3 className="text-xl font-semibold mb-2 text-foreground dark:text-gray-100">
                                        Drag & drop file PDF di sini
                                    </h3>
                                    <p className="text-muted-foreground dark:text-muted-foreground mb-6 max-w-sm">
                                        atau klik untuk memilih file dari komputer Anda (Maksimal 50 file)
                                    </p>
                                    <Button variant="outline" className="border-blue-200 hover:bg-blue-50 hover:text-blue-600 dark:text-blue-400 dark:border-blue-800 dark:hover:bg-blue-900/50">
                                        Pilih File
                                    </Button>
                                </div>

                                {files.length > 0 && (
                                    <div className="mt-8 space-y-4">
                                        <div className="flex items-center justify-between">
                                            <h4 className="font-medium text-foreground dark:text-gray-300">File Terpilih ({files.length})</h4>
                                            <Button variant="ghost" size="sm" onClick={clearFiles} className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">
                                                Hapus Semua
                                            </Button>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                            {files.map((file, index) => (
                                                <div key={index} className="flex items-center p-3 bg-card dark:bg-foreground rounded-lg border border-border dark:border-gray-800 shadow-sm group hover:shadow-md transition-shadow">
                                                    <div className="p-2 bg-red-50 dark:bg-red-900/20 text-red-500 rounded mr-3">
                                                        <FileText className="h-4 w-4" />
                                                    </div>
                                                    <div className="flex-1 min-w-0 mr-2">
                                                        <p className="text-sm font-medium truncate text-foreground dark:text-gray-100">{file.name}</p>
                                                        <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                                                    </div>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            removeFile(index);
                                                        }}
                                                    >
                                                        <X className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="flex justify-end pt-4 border-t mt-6">
                                            <Button
                                                onClick={handleUpload}
                                                disabled={isUploading}
                                                className="bg-primary hover:bg-primary text-white min-w-[150px]"
                                                size="lg"
                                            >
                                                {isUploading ? (
                                                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                                                ) : (
                                                    <Upload className="h-5 w-5 mr-2" />
                                                )}
                                                Mulai Upload
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </motion.div>
                )}

                {/* Processing Phase */}
                {(isProcessing || isUploading) && (
                    <motion.div
                        key="processing"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="max-w-xl mx-auto mt-12"
                    >
                        <Card className="shadow-lg border-blue-100 dark:border-blue-900">
                            <CardContent className="p-8 text-center space-y-6">
                                <div className="relative inline-flex items-center justify-center">
                                    <div className="absolute inset-0 bg-blue-100 dark:bg-blue-900/30 rounded-full animate-ping opacity-75"></div>
                                    <div className="relative p-4 bg-blue-50 dark:bg-blue-900/50 rounded-full text-blue-600 dark:text-blue-400">
                                        <Loader2 className="h-10 w-10 animate-spin" />
                                    </div>
                                </div>
                                <div>
                                    <h3 className="text-xl font-bold text-foreground dark:text-gray-100 mb-2">
                                        {isUploading ? 'Mengupload File...' : 'Memproses OCR Metadata...'}
                                    </h3>
                                    <p className="text-muted-foreground dark:text-muted-foreground">
                                        Sistem sedang membaca isi dokumen Anda secara otomatis.
                                    </p>
                                </div>
                                <div className="space-y-2">
                                    <div className="flex justify-between text-sm text-muted-foreground dark:text-muted-foreground px-1">
                                        <span>Progress</span>
                                        <span>{progress?.percentage || 0}%</span>
                                    </div>
                                    <Progress value={progress?.percentage || 0} className="h-2 w-full" />
                                    <p className="text-xs text-muted-foreground text-right">
                                        {progress?.processed || 0} dari {progress?.total || files.length} file selesai
                                    </p>
                                </div>
                            </CardContent>
                        </Card>
                    </motion.div>
                )}

                {/* Results Phase */}
                {batch && !isProcessing && !isUploading && (
                    <motion.div
                        key="results"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="space-y-6"
                    >
                        <Card className="border-none shadow-md bg-card/50 dark:bg-foreground/50 backdrop-blur-sm">
                            <CardHeader className="flex flex-row items-center justify-between">
                                <div>
                                    <CardTitle className="flex items-center gap-2">
                                        <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                                        Hasil Ekstraksi Data
                                    </CardTitle>
                                    <CardDescription>
                                        Review metadata yang berhasil diekstrak sebelum disimpan ke arsip.
                                    </CardDescription>
                                </div>
                                <div className="flex items-center gap-3">
                                    <Badge variant="outline" className="bg-green-50 dark:bg-green-500/15 text-green-700 dark:text-green-300 border-green-200 px-3 py-1">
                                        <Check className="h-3 w-3 mr-1" />
                                        {progress?.completed || 0} Berhasil
                                    </Badge>
                                    {(progress?.failed || 0) > 0 && (
                                        <Badge variant="outline" className="bg-red-50 text-red-700 dark:text-red-300 border-red-200 px-3 py-1">
                                            <AlertCircle className="h-3 w-3 mr-1" />
                                            {progress.failed} Gagal
                                        </Badge>
                                    )}
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-1 gap-4">
                                    {batch.items.map((item) => (
                                        <motion.div
                                            key={item.id}
                                            layout
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            className={`
                                                relative border rounded-lg overflow-hidden transition-all
                                                ${editingItem === item.id
                                                    ? 'border-blue-400 ring-2 ring-blue-100 bg-card dark:bg-foreground shadow-md transform scale-[1.01]'
                                                    : 'border-border hover:border-blue-300 bg-card/60 dark:bg-foreground/60 dark:border-gray-800'
                                                }
                                            `}
                                        >
                                            {/* Item Header / Preview */}
                                            <div className="flex flex-col md:flex-row md:items-center p-4 gap-4">
                                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                                    <div className={`p-2 rounded-lg ${item.status === 'completed' ? 'bg-blue-50 text-blue-600 dark:text-blue-400' : 'bg-red-50 text-red-500'}`}>
                                                        <FileType className="h-5 w-5" />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="text-sm font-medium text-foreground dark:text-gray-100 truncate w-full" title={item.fileName}>
                                                            {item.fileName}
                                                        </p>
                                                        {item.status === 'completed' && editingItem !== item.id && (
                                                            <div className="flex flex-wrap gap-2 mt-1 text-xs text-muted-foreground">
                                                                <Badge variant="secondary" className="text-[10px] h-5 font-normal">
                                                                    {editedData[item.id]?.nomorBerkas || item.metadata?.nomorSurat || 'No Surat'}
                                                                </Badge>
                                                                <span className="truncate max-w-[200px] opacity-75">
                                                                    {editedData[item.id]?.uraianBerkas || item.metadata?.perihal || 'No Perihal'}
                                                                </span>
                                                            </div>
                                                        )}
                                                        {item.status === 'failed' && (
                                                            <p className="text-xs text-red-500 mt-1">{item.error || 'Gagal memproses file'}</p>
                                                        )}
                                                    </div>
                                                </div>

                                                {item.status === 'completed' && editingItem !== item.id && (
                                                    <div className="flex items-center gap-2 self-end md:self-auto">
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => startEditing(item)}
                                                            className="h-8 gap-2 hover:text-blue-600 dark:text-blue-400 hover:border-blue-200"
                                                        >
                                                            <Edit className="h-3 w-3" />
                                                            Edit Data
                                                        </Button>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Edit Form */}
                                            {editingItem === item.id && (
                                                <div className="p-4 bg-muted/50 dark:bg-foreground/20 border-t space-y-4 animate-in slide-in-from-top-2 duration-200">
                                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                                        <div className="space-y-2">
                                                            <Label className="text-xs font-semibold text-muted-foreground">Nomor Surat</Label>
                                                            <Input
                                                                value={editedData[item.id]?.nomorBerkas || ''}
                                                                onChange={(e) => updateEditedData(item.id, 'nomorBerkas', e.target.value)}
                                                                placeholder="Nomor..."
                                                                className="h-9"
                                                            />
                                                        </div>
                                                        <div className="space-y-2 lg:col-span-2">
                                                            <Label className="text-xs font-semibold text-muted-foreground">Perihal / Uraian</Label>
                                                            <Input
                                                                value={editedData[item.id]?.uraianBerkas || ''}
                                                                onChange={(e) => updateEditedData(item.id, 'uraianBerkas', e.target.value)}
                                                                placeholder="Perihal..."
                                                                className="h-9"
                                                            />
                                                        </div>
                                                        <div className="space-y-2">
                                                            <Label className="text-xs font-semibold text-muted-foreground">Tahun</Label>
                                                            <Input
                                                                type="number"
                                                                value={editedData[item.id]?.tahun || new Date().getFullYear()}
                                                                onChange={(e) => updateEditedData(item.id, 'tahun', parseInt(e.target.value))}
                                                                className="h-9"
                                                            />
                                                        </div>
                                                        <div className="space-y-2">
                                                            <Label className="text-xs font-semibold text-muted-foreground">Jenis Arsip</Label>
                                                            <Select
                                                                value={editedData[item.id]?.jenisArsip || 'masuk'}
                                                                onValueChange={(v) => updateEditedData(item.id, 'jenisArsip', v)}
                                                            >
                                                                <SelectTrigger className="h-9">
                                                                    <SelectValue />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    <SelectItem value="masuk">Surat Masuk</SelectItem>
                                                                    <SelectItem value="keluar">Surat Keluar</SelectItem>
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                    </div>
                                                    <div className="flex justify-end gap-2 pt-2">
                                                        <Button
                                                            size="sm"
                                                            onClick={() => setEditingItem(null)}
                                                            className="bg-primary hover:bg-primary text-white"
                                                        >
                                                            <Check className="h-3 w-3 mr-1.5" />
                                                            Selesai Edit
                                                        </Button>
                                                    </div>
                                                </div>
                                            )}
                                        </motion.div>
                                    ))}
                                </div>
                            </CardContent>
                            <CardFooter className="flex justify-between border-t bg-muted/50 dark:bg-foreground/50 p-6 rounded-b-lg">
                                <Button variant="ghost" onClick={clearFiles} className="text-muted-foreground hover:text-red-500">
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    Batal & Hapus
                                </Button>
                                <Button
                                    onClick={handleConfirm}
                                    disabled={progress?.completed === 0}
                                    className="bg-green-600 hover:bg-green-700 text-white min-w-[200px]"
                                    size="lg"
                                >
                                    <Save className="h-4 w-4 mr-2" />
                                    Simpan {progress?.completed || 0} Arsip
                                </Button>
                            </CardFooter>
                        </Card>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
