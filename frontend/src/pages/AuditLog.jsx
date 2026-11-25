import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, Filter, Clock, User, FileText, Edit, Trash2, Archive, Plus, RefreshCw, Loader2, AlertTriangle, ChevronDown, ChevronRight, Laptop, CalendarRange, Shield, Eye, GitMerge, Link, X, Send, Inbox, CheckCircle2, XCircle, LogIn, LogOut, ShieldAlert, KeyRound, Download, ShieldCheck, Lock, Unlock, FileSpreadsheet } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import auditLogService from '@/services/audit-log.service';
import { useAuth } from '@/context/AuthContext';
import { canExportReports } from '@/lib/provisioning-access';
import { labelIsianAudit } from '@/lib/label-isian-audit';
import { Skeleton } from "@/components/ui/skeleton"

const ACTION_CONFIG = {
    'create': { label: 'Membuat', icon: Plus, color: 'bg-green-100 dark:bg-green-500/15 text-green-800 dark:text-green-300', borderColor: 'border-green-200', iconColor: 'text-green-600' },
    'update': { label: 'Mengubah', icon: Edit, color: 'bg-blue-100 dark:bg-blue-500/15 text-blue-800 dark:text-blue-300', borderColor: 'border-blue-200', iconColor: 'text-blue-600' },
    'delete': { label: 'Menghapus', icon: Trash2, color: 'bg-red-100 dark:bg-red-500/15 text-red-800 dark:text-red-300', borderColor: 'border-red-200', iconColor: 'text-red-600' },
    'archive': { label: 'Mengarsipkan', icon: Archive, color: 'bg-purple-100 dark:bg-purple-500/15 text-purple-800 dark:text-purple-300', borderColor: 'border-purple-200', iconColor: 'text-purple-600' },
    'restore': { label: 'Memulihkan', icon: RefreshCw, color: 'bg-yellow-100 dark:bg-yellow-500/15 text-yellow-800 dark:text-yellow-300', borderColor: 'border-yellow-200', iconColor: 'text-yellow-600' },
    'status_change': { label: 'Ubah Status', icon: RefreshCw, color: 'bg-orange-100 dark:bg-orange-500/15 text-orange-800 dark:text-orange-300', borderColor: 'border-orange-200', iconColor: 'text-orange-600' },
    'request_access': { label: 'Meminta Akses', icon: Shield, color: 'bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300', borderColor: 'border-amber-200', iconColor: 'text-amber-600' },
    'approve_access': { label: 'Menyetujui Akses', icon: Shield, color: 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300', borderColor: 'border-emerald-200', iconColor: 'text-emerald-600' },
    'deny_access': { label: 'Menolak Akses', icon: Shield, color: 'bg-red-100 dark:bg-red-500/15 text-red-800 dark:text-red-300', borderColor: 'border-red-200', iconColor: 'text-red-600' },
    'revoke_access': { label: 'Mencabut Akses', icon: Shield, color: 'bg-slate-100 dark:bg-slate-500/15 text-slate-800 dark:text-slate-300', borderColor: 'border-slate-200', iconColor: 'text-slate-600' },
    'view_via_rangkaian': { label: 'Lihat via Rangkaian', icon: Eye, color: 'bg-cyan-100 dark:bg-cyan-500/15 text-cyan-800 dark:text-cyan-300', borderColor: 'border-cyan-200', iconColor: 'text-cyan-600' },
    'export': { label: 'Ekspor Data', icon: FileText, color: 'bg-indigo-100 dark:bg-indigo-500/15 text-indigo-800 dark:text-indigo-300', borderColor: 'border-indigo-200', iconColor: 'text-indigo-600' },
    'merge': { label: 'Menggabungkan', icon: GitMerge, color: 'bg-indigo-100 dark:bg-indigo-500/15 text-indigo-800 dark:text-indigo-300', borderColor: 'border-indigo-200', iconColor: 'text-indigo-600' },
    'link': { label: 'Menautkan', icon: Link, color: 'bg-sky-100 dark:bg-sky-500/15 text-sky-800 dark:text-sky-300', borderColor: 'border-sky-200', iconColor: 'text-sky-600' },
    'cancel': { label: 'Membatalkan', icon: X, color: 'bg-rose-100 dark:bg-rose-500/15 text-rose-800 dark:text-rose-300', borderColor: 'border-rose-200', iconColor: 'text-rose-600' },
    'distribute': { label: 'Mendisposisikan', icon: Send, color: 'bg-teal-100 dark:bg-teal-500/15 text-teal-800 dark:text-teal-300', borderColor: 'border-teal-200', iconColor: 'text-teal-600' },
    'receive_distribution': { label: 'Menerima Disposisi', icon: Inbox, color: 'bg-blue-100 dark:bg-blue-500/15 text-blue-800 dark:text-blue-300', borderColor: 'border-blue-200', iconColor: 'text-blue-600' },
    'process_distribution': { label: 'Menyelesaikan Disposisi', icon: CheckCircle2, color: 'bg-green-100 dark:bg-green-500/15 text-green-800 dark:text-green-300', borderColor: 'border-green-200', iconColor: 'text-green-600' },
    'reject_distribution': { label: 'Menolak Disposisi', icon: XCircle, color: 'bg-red-100 dark:bg-red-500/15 text-red-800 dark:text-red-300', borderColor: 'border-red-200', iconColor: 'text-red-600' },
    'run_scanner': { label: 'Menjalankan Pemindai', icon: Shield, color: 'bg-sky-100 dark:bg-sky-500/15 text-sky-800 dark:text-sky-300', borderColor: 'border-sky-200', iconColor: 'text-sky-600' },
    'sign_in': { label: 'Masuk', icon: LogIn, color: 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300', borderColor: 'border-emerald-200', iconColor: 'text-emerald-600' },
    'sign_in_failed': { label: 'Gagal masuk', icon: ShieldAlert, color: 'bg-red-100 dark:bg-red-500/15 text-red-800 dark:text-red-300', borderColor: 'border-red-200', iconColor: 'text-red-600' },
    'sign_out': { label: 'Keluar', icon: LogOut, color: 'bg-slate-100 dark:bg-slate-500/15 text-slate-800 dark:text-slate-300', borderColor: 'border-slate-200', iconColor: 'text-slate-600' },
    'view': { label: 'Melihat', icon: Eye, color: 'bg-slate-100 dark:bg-slate-500/15 text-slate-800 dark:text-slate-300', borderColor: 'border-slate-200', iconColor: 'text-slate-600' },
    'download': { label: 'Mengunduh', icon: Download, color: 'bg-slate-100 dark:bg-slate-500/15 text-slate-800 dark:text-slate-300', borderColor: 'border-slate-200', iconColor: 'text-slate-600' },
    'verify_integrity': { label: 'Memeriksa Integritas', icon: ShieldCheck, color: 'bg-teal-100 dark:bg-teal-500/15 text-teal-800 dark:text-teal-300', borderColor: 'border-teal-200', iconColor: 'text-teal-600' },
    'hold': { label: 'Menerapkan Legal Hold', icon: Lock, color: 'bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300', borderColor: 'border-amber-200', iconColor: 'text-amber-600' },
    'release_hold': { label: 'Melepas Legal Hold', icon: Unlock, color: 'bg-slate-100 dark:bg-slate-500/15 text-slate-800 dark:text-slate-300', borderColor: 'border-slate-200', iconColor: 'text-slate-600' },
    'change_password': { label: 'Mengganti kata sandi', icon: KeyRound, color: 'bg-blue-100 dark:bg-blue-500/15 text-blue-800 dark:text-blue-300', borderColor: 'border-blue-200', iconColor: 'text-blue-600' },
    // Aksi tata kelola retensi (audit(...) di backend services/retention-governance.service.ts).
    'retention_event_create': { label: 'Mencatat Pemicu Retensi', icon: Plus, color: 'bg-rose-100 dark:bg-rose-500/15 text-rose-800 dark:text-rose-300', borderColor: 'border-rose-200', iconColor: 'text-rose-600' },
    'retention_event_verify': { label: 'Memverifikasi Pemicu Retensi', icon: CheckCircle2, color: 'bg-rose-100 dark:bg-rose-500/15 text-rose-800 dark:text-rose-300', borderColor: 'border-rose-200', iconColor: 'text-rose-600' },
    'retention_event_correct': { label: 'Mengoreksi Pemicu Retensi', icon: Edit, color: 'bg-rose-100 dark:bg-rose-500/15 text-rose-800 dark:text-rose-300', borderColor: 'border-rose-200', iconColor: 'text-rose-600' },
    'appraisal_create': { label: 'Membuka Penilaian Arsip', icon: Plus, color: 'bg-rose-100 dark:bg-rose-500/15 text-rose-800 dark:text-rose-300', borderColor: 'border-rose-200', iconColor: 'text-rose-600' },
    'appraisal_evidence': { label: 'Menambah Bukti Penilaian', icon: FileText, color: 'bg-rose-100 dark:bg-rose-500/15 text-rose-800 dark:text-rose-300', borderColor: 'border-rose-200', iconColor: 'text-rose-600' },
    'appraisal_submit': { label: 'Mengajukan Penilaian Arsip', icon: Send, color: 'bg-rose-100 dark:bg-rose-500/15 text-rose-800 dark:text-rose-300', borderColor: 'border-rose-200', iconColor: 'text-rose-600' },
    'appraisal_approve': { label: 'Menyetujui Penilaian Arsip', icon: CheckCircle2, color: 'bg-rose-100 dark:bg-rose-500/15 text-rose-800 dark:text-rose-300', borderColor: 'border-rose-200', iconColor: 'text-rose-600' },
    'appraisal_reject': { label: 'Menolak Penilaian Arsip', icon: XCircle, color: 'bg-rose-100 dark:bg-rose-500/15 text-rose-800 dark:text-rose-300', borderColor: 'border-rose-200', iconColor: 'text-rose-600' },
    'transfer_manifest_create': { label: 'Membuat Daftar Penyerahan', icon: Plus, color: 'bg-rose-100 dark:bg-rose-500/15 text-rose-800 dark:text-rose-300', borderColor: 'border-rose-200', iconColor: 'text-rose-600' },
    'transfer_handover': { label: 'Menyerahkan Arsip Permanen', icon: Send, color: 'bg-rose-100 dark:bg-rose-500/15 text-rose-800 dark:text-rose-300', borderColor: 'border-rose-200', iconColor: 'text-rose-600' },
    'transfer_acknowledge': { label: 'Mengonfirmasi Penerimaan Arsip', icon: CheckCircle2, color: 'bg-rose-100 dark:bg-rose-500/15 text-rose-800 dark:text-rose-300', borderColor: 'border-rose-200', iconColor: 'text-rose-600' },
    'transfer_cancellation_request': { label: 'Mengajukan Pembatalan Penyerahan', icon: X, color: 'bg-rose-100 dark:bg-rose-500/15 text-rose-800 dark:text-rose-300', borderColor: 'border-rose-200', iconColor: 'text-rose-600' },
    'transfer_cancellation_review': { label: 'Memutuskan Pembatalan Penyerahan', icon: RefreshCw, color: 'bg-rose-100 dark:bg-rose-500/15 text-rose-800 dark:text-rose-300', borderColor: 'border-rose-200', iconColor: 'text-rose-600' },
};

// Satu sumber untuk label jenis data di daftar dan pilihan penyaring "Jenis
// Data", berurutan seperti tampil di penyaring. Kuncinya adalah setiap nilai
// entity_type yang ditulis backend: LogActionData['entityType'] di
// services/audit-log.service.ts dan pencatat audit di
// services/retention-governance.service.ts (dijaga AuditLog.jenis-data.test.jsx).
const WARNA_NETRAL = { color: 'text-slate-700', bgColor: 'bg-slate-50 dark:bg-slate-500/15' };
const WARNA_ARSIP = { color: 'text-purple-600', bgColor: 'bg-purple-50 dark:bg-purple-500/15' };
const ENTITY_CONFIG = {
    'surat_masuk': { label: 'Surat Masuk', color: 'text-blue-600', bgColor: 'bg-blue-50 dark:bg-blue-500/15' },
    'surat_keluar': { label: 'Surat Keluar', color: 'text-green-600', bgColor: 'bg-green-50 dark:bg-green-500/15' },
    'surat_distribution': { label: 'Disposisi', color: 'text-teal-700', bgColor: 'bg-teal-50 dark:bg-teal-500/15' },
    'rangkaian_surat': { label: 'Rangkaian Surat', color: 'text-cyan-700', bgColor: 'bg-cyan-50 dark:bg-cyan-500/15' },
    'rangkaian_relasi': { label: 'Relasi Rangkaian', color: 'text-sky-700', bgColor: 'bg-sky-50 dark:bg-sky-500/15' },
    'tunjuk_silang': { label: 'Tunjuk Silang', color: 'text-sky-700', bgColor: 'bg-sky-50 dark:bg-sky-500/15' },
    'dosir': { label: 'Dosir', color: 'text-cyan-700', bgColor: 'bg-cyan-50 dark:bg-cyan-500/15' },
    'surat_template': { label: 'Templat Surat', ...WARNA_NETRAL },
    'arsip': { label: 'Arsip', ...WARNA_ARSIP },
    'arsip_elektronik': { label: 'Arsip Elektronik', ...WARNA_ARSIP },
    'file_attachment': { label: 'Berkas', ...WARNA_NETRAL },
    'storage_location': { label: 'Lokasi Penyimpanan', ...WARNA_ARSIP },
    'archive_lending': { label: 'Peminjaman Arsip', color: 'text-orange-700', bgColor: 'bg-orange-50 dark:bg-orange-500/15' },
    'layanan_arsip': { label: 'Layanan Arsip', color: 'text-orange-700', bgColor: 'bg-orange-50 dark:bg-orange-500/15' },
    'autentikasi': { label: 'Autentikasi Alih Media', ...WARNA_ARSIP },
    'penyusutan': { label: 'Penyusutan Arsip', color: 'text-rose-700', bgColor: 'bg-rose-50 dark:bg-rose-500/15' },
    'arsip_rule_assignment': { label: 'Penetapan Aturan Arsip', ...WARNA_ARSIP },
    'retention_event': { label: 'Pemicu Retensi', color: 'text-rose-700', bgColor: 'bg-rose-50 dark:bg-rose-500/15' },
    'jra_appraisal': { label: 'Penilaian Arsip', color: 'text-rose-700', bgColor: 'bg-rose-50 dark:bg-rose-500/15' },
    'permanent_transfer': { label: 'Penyerahan Permanen', color: 'text-rose-700', bgColor: 'bg-rose-50 dark:bg-rose-500/15' },
    'regulatory_rule_set': { label: 'Versi Aturan Klasifikasi/JRA', color: 'text-indigo-700', bgColor: 'bg-indigo-50 dark:bg-indigo-500/15' },
    'record_access_grant': { label: 'Persetujuan Akses', color: 'text-amber-700', bgColor: 'bg-amber-50 dark:bg-amber-500/15' },
    'user': { label: 'Pengguna', color: 'text-orange-600', bgColor: 'bg-orange-50 dark:bg-orange-500/15' },
    'user_preferences': { label: 'Preferensi Pengguna', color: 'text-orange-600', bgColor: 'bg-orange-50 dark:bg-orange-500/15' },
    'unit_kerja': { label: 'Unit Kerja', ...WARNA_NETRAL },
    'audit_log': { label: 'Audit Log', color: 'text-indigo-700', bgColor: 'bg-indigo-50 dark:bg-indigo-500/15' },
};

// Nilai pada "Detail Perubahan". Yang diubah hanya bentuk yang sulit dibaca:
// nilai kosong, ya/tidak, daftar, dan tanggal atau waktu berformat ISO. Nilai
// aslinya tetap ada di title.
const NILAI_KOSONG = '(kosong)';
const POLA_WAKTU_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;
const POLA_TANGGAL_ISO = /^\d{4}-\d{2}-\d{2}$/;
const penulisWaktu = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Jakarta' });
const penulisTanggal = new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeZone: 'UTC' });
const nilaiMentah = (nilai) => (nilai !== null && typeof nilai === 'object' ? JSON.stringify(nilai) : String(nilai));
const tulisNilai = (nilai) => {
    if (nilai === null || nilai === '') return NILAI_KOSONG;
    if (typeof nilai === 'boolean') return nilai ? 'Ya' : 'Tidak';
    if (Array.isArray(nilai)) return nilai.length > 0 ? nilai.map(tulisNilai).join(', ') : NILAI_KOSONG;
    if (typeof nilai === 'object') return JSON.stringify(nilai);
    const teks = String(nilai);
    if (POLA_WAKTU_ISO.test(teks)) {
        const waktu = new Date(teks);
        if (Number.isFinite(waktu.getTime())) return `${penulisWaktu.format(waktu)} WIB`;
    }
    if (POLA_TANGGAL_ISO.test(teks)) {
        // Tanggal yang tidak ada di kalender (30 Februari) ditulis apa adanya.
        const tanggal = new Date(`${teks}T00:00:00Z`);
        if (Number.isFinite(tanggal.getTime()) && tanggal.toISOString().startsWith(teks)) return penulisTanggal.format(tanggal);
    }
    return teks;
};

// Status changes.itemSync pada audit ubah arsip (StatusSinkronItemArsip di
// backend services/arsip.service.ts); hanya status yang perlu penjelasan.
const LABEL_SINKRON_ITEM = {
    'item_utama_ambigu': 'Item yang menjadi ringkasan berkas tidak dapat dikenali, sehingga isian item tidak diselaraskan. Hanya item di lokasi lama yang sama yang ikut dipindahkan bila lokasi diubah.',
};

export default function AuditLog() {
    const { user } = useAuth();
    // Server hanya mengizinkan Super Admin mengekspor audit log.
    const canExport = user?.role === 'super_admin' && canExportReports(user.role);
    const [exporting, setExporting] = useState(false);
    const [exportError, setExportError] = useState(null);
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [expandedId, setExpandedId] = useState(null);

    // Filters
    const [entityType, setEntityType] = useState('all');
    const [action, setAction] = useState('all');
    const [search, setSearch] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    // Pagination
    const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 0 });

    // Applying a filter must restart from the first page, otherwise the filtered
    // query keeps requesting a now out-of-range page and the table looks empty.
    const applyFilter = (setter) => (value) => {
        setter(value);
        setPagination(prev => (prev.page === 1 ? prev : { ...prev, page: 1 }));
    };

    // Only the newest request may update the list; an older, slower response
    // for a previous filter or page is dropped.
    const loadGeneration = useRef(0);
    const loadLogs = useCallback(async () => {
        const generation = ++loadGeneration.current;
        try {
            setLoading(true);
            setError(null);

            const params = { page: pagination.page, limit: pagination.limit };
            if (entityType && entityType !== 'all') params.entityType = entityType;
            if (action && action !== 'all') params.action = action;
            if (search) params.search = search;
            if (startDate) params.startDate = startDate;
            if (endDate) params.endDate = endDate;

            const response = await auditLogService.listLogs(params);
            if (generation !== loadGeneration.current) return;
            setLogs(response.data || []);
            setPagination(prev => ({
                ...prev,
                total: response.pagination?.total || 0,
                totalPages: response.pagination?.totalPages || 0,
            }));
        } catch (err) {
            if (generation !== loadGeneration.current) return;
            console.error('Failed to load logs:', err);
            setError('Gagal memuat audit log');
        } finally {
            if (generation === loadGeneration.current) setLoading(false);
        }
    }, [entityType, action, search, startDate, endDate, pagination.page, pagination.limit]);

    useEffect(() => {
        const timer = setTimeout(loadLogs, 300);
        return () => clearTimeout(timer);
    }, [loadLogs]);

    // Ekspor memakai penyaring yang sama dengan daftar, tanpa halaman.
    const handleExport = async () => {
        setExporting(true);
        setExportError(null);
        try {
            const params = {};
            if (entityType && entityType !== 'all') params.entityType = entityType;
            if (action && action !== 'all') params.action = action;
            if (search) params.search = search;
            if (startDate) params.startDate = startDate;
            if (endDate) params.endDate = endDate;
            await auditLogService.exportLogs(params);
        } catch (err) {
            // api.js sudah mengisi message dari jawaban server (422 batas ekspor, 429).
            setExportError(err?.message || 'Gagal mengekspor audit log. Silakan coba lagi.');
        } finally {
            setExporting(false);
        }
    };

    const formatDate = (date) => {
        return new Date(date).toLocaleString('id-ID', {
            weekday: 'short',
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const getInitials = (name) => {
        if (!name) return '?';
        return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    };

    const getAvatarColor = (name) => {
        const colors = ['bg-red-500', 'bg-blue-500', 'bg-green-500', 'bg-yellow-500', 'bg-purple-500', 'bg-pink-500', 'bg-indigo-500', 'bg-orange-500'];
        if (!name) return 'bg-slate-500';
        const index = name.charCodeAt(0) % colors.length;
        return colors[index];
    };

    const renderFieldChange = (field, before, after) => (
        <div key={field} className="grid grid-cols-1 sm:grid-cols-[120px_1fr] gap-1 sm:gap-4 text-xs sm:text-sm">
            <span className="font-medium text-muted-foreground capitalize">{labelIsianAudit(field)}:</span>
            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
                {before?.[field] !== undefined && (
                    <span className="text-red-600 line-through bg-red-50 dark:bg-red-500/15 px-1 rounded truncate max-w-xs block" title={nilaiMentah(before[field])}>
                        {tulisNilai(before[field])}
                    </span>
                )}
                {before?.[field] !== undefined && after?.[field] !== undefined && (
                    <span className="text-muted-foreground hidden sm:inline">→</span>
                )}
                {after?.[field] !== undefined && (
                    <span className="text-green-600 bg-green-50 dark:bg-green-500/15 px-1 rounded font-medium break-all" title={nilaiMentah(after[field])}>
                        {tulisNilai(after[field])}
                    </span>
                )}
            </div>
        </div>
    );

    const renderChanges = (changes) => {
        if (!changes) return null;

        const { before, after, fields } = changes;
        if (!before && !after) return null;

        const changedFields = fields || Object.keys({ ...before, ...after });
        // Item berkas yang ikut diperbarui saat ringkasan arsip diubah
        // (arsipService.update di backend).
        const changedItems = Array.isArray(changes.items) ? changes.items : [];
        const itemSyncNote = Object.hasOwn(LABEL_SINKRON_ITEM, changes.itemSync ?? '') ? LABEL_SINKRON_ITEM[changes.itemSync] : null;

        return (
            <div className="mt-3 bg-muted/30 rounded-lg text-sm border border-border/50 overflow-hidden">
                <div className="bg-muted/50 px-3 py-2 border-b border-border/50 flex items-center gap-2">
                    <Edit className="h-3 w-3 text-muted-foreground" />
                    <span className="font-medium text-xs uppercase text-muted-foreground">Detail Perubahan</span>
                </div>
                <div className="p-3 space-y-2">
                    {changedFields.map(field => renderFieldChange(field, before, after))}
                </div>
                {(changedItems.length > 0 || itemSyncNote) && (
                    <div className="p-3 space-y-3 border-t border-border/50">
                        <span className="block font-medium text-xs uppercase text-muted-foreground">Daftar Item Arsip</span>
                        {itemSyncNote && <p className="text-xs text-muted-foreground">{itemSyncNote}</p>}
                        {changedItems.map(item => (
                            <div key={item.id} className="space-y-2">
                                <p className="text-xs text-muted-foreground">
                                    Item <span className="font-mono break-all">{item.id}</span>
                                </p>
                                {Object.keys({ ...item.before, ...item.after }).map(field => renderFieldChange(field, item.before, item.after))}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                    <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
                        <div className="p-2 bg-indigo-100 dark:bg-indigo-500/15 rounded-lg">
                            <Shield className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
                        </div>
                        Audit Log
                    </h1>
                    <p className="text-muted-foreground">
                        Riwayat aktivitas dan perubahan data sistem untuk keamanan dan audit
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="h-8 gap-2 bg-background">
                        <Clock className="h-3.5 w-3.5" />
                        Total: {pagination.total} Log
                    </Badge>
                    {canExport && (
                        <Button variant="outline" size="sm" className="h-8" onClick={handleExport} disabled={exporting || loading}>
                            {exporting ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5 mr-2" />}
                            Ekspor Excel
                        </Button>
                    )}
                </div>
            </div>
            {canExport && (
                <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                        Ekspor memuat seluruh log sesuai pencarian dan penyaring di bawah, paling banyak 10.000 baris. Berkas berisi ringkasan nama isian yang berubah, tanpa nilai sebelum dan sesudahnya.
                    </p>
                    {exportError && (
                        <p role="alert" className="max-w-xl rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                            {exportError}
                        </p>
                    )}
                </div>
            )}

            {/* Filters */}
            <Card className="shadow-sm border-border/60">
                <CardHeader className="pb-4 bg-muted/20">
                    <div className="flex min-w-0 flex-col gap-4">
                        <div className="flex flex-col gap-4 sm:flex-row">
                            <div className="relative min-w-0 flex-1">
                                <label htmlFor="audit-search" className="sr-only">Cari audit log</label>
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    id="audit-search"
                                    placeholder="Cari nama pengguna, email, atau ID entitas..."
                                    value={search}
                                    onChange={(e) => applyFilter(setSearch)(e.target.value)}
                                    className="pl-9 bg-background focus:bg-background"
                                />
                            </div>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
                                <span className="text-xs text-muted-foreground whitespace-nowrap">Rentang:</span>
                                <label htmlFor="audit-start-date" className="sr-only">Tanggal mulai</label>
                                <Input
                                    id="audit-start-date"
                                    type="date"
                                    value={startDate}
                                    onChange={(e) => applyFilter(setStartDate)(e.target.value)}
                                    className="w-full bg-background"
                                />
                                <span className="hidden text-muted-foreground sm:inline" aria-hidden="true">–</span>
                                <label htmlFor="audit-end-date" className="sr-only">Tanggal akhir</label>
                                <Input
                                    id="audit-end-date"
                                    type="date"
                                    value={endDate}
                                    onChange={(e) => applyFilter(setEndDate)(e.target.value)}
                                    className="w-full bg-background"
                                />
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <Filter className="h-4 w-4 text-muted-foreground mr-1" />
                            <Select value={entityType} onValueChange={applyFilter(setEntityType)}>
                                <SelectTrigger aria-label="Jenis data" className="w-full sm:w-[200px] h-8 text-xs bg-background">
                                    <SelectValue placeholder="Jenis Data" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Semua Jenis Data</SelectItem>
                                    {Object.entries(ENTITY_CONFIG).map(([kode, { label }]) => (
                                        <SelectItem key={kode} value={kode}>{label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Select value={action} onValueChange={applyFilter(setAction)}>
                                <SelectTrigger aria-label="Aksi" className="w-full sm:w-[160px] h-8 text-xs bg-background">
                                    <SelectValue placeholder="Aksi" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Semua Aksi</SelectItem>
                                    {Object.entries(ACTION_CONFIG).map(([kode, konfigurasi]) => (
                                        <SelectItem key={kode} value={kode}>{konfigurasi.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="relative p-6">
                        {/* Timeline line */}
                        <div className="absolute left-9 top-6 bottom-6 w-px bg-border/60" />

                        {loading ? (
                            <div className="space-y-6">
                                {[1, 2, 3, 4, 5].map(i => (
                                    <div key={i} className="flex flex-wrap gap-3 sm:gap-4">
                                        <Skeleton className="h-10 w-10 rounded-full shrink-0" />
                                        <div className="space-y-2 flex-1">
                                            <Skeleton className="h-4 w-1/3" />
                                            <Skeleton className="h-20 w-full" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : error ? (
                            <div className="flex flex-col items-center justify-center py-12 gap-4">
                                <AlertTriangle className="h-12 w-12 text-yellow-500" />
                                <p className="text-muted-foreground">{error}</p>
                                <Button onClick={loadLogs} variant="outline">Coba Lagi</Button>
                            </div>
                        ) : logs.length === 0 ? (
                            <div className="text-center py-16 text-muted-foreground">
                                <div className="p-4 bg-muted/50 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                                    <Clock className="h-8 w-8 opacity-20" />
                                </div>
                                <h3 className="text-lg font-medium mb-1">Tidak ada aktivitas</h3>
                                <p className="text-sm opacity-80">Belum ada log yang tercatat sesuai filter</p>
                            </div>
                        ) : (
                            <div className="space-y-6">
                                {logs.map((log) => {
                                    const actionConfig = ACTION_CONFIG[log.action] || { label: log.action, icon: FileText, color: 'bg-muted', iconColor: 'text-muted-foreground' };
                                    const entityConfig = ENTITY_CONFIG[log.entityType] || { label: log.entityType, color: 'text-muted-foreground', bgColor: 'bg-muted/50' };
                                    const ActionIcon = actionConfig.icon;
                                    const isExpanded = expandedId === log.id;

                                    return (
                                        <div key={log.id} className="relative pl-12 group">
                                            {/* Timeline dot */}
                                            <div className={`absolute left-0 top-1 p-1 bg-background border-2 border-border rounded-full z-10 ${isExpanded ? 'scale-110 border-primary' : 'group-hover:scale-110 group-hover:border-primary'} transition-all duration-200`}>
                                                <div className={`p-1 rounded-full ${actionConfig.color}`}>
                                                    <ActionIcon className={`h-3.5 w-3.5 ${actionConfig.iconColor}`} />
                                                </div>
                                            </div>

                                            {/* Log Content Card */}
                                            <div
                                                role="button"
                                                tabIndex={0}
                                                aria-expanded={isExpanded}
                                                aria-controls={`audit-detail-${log.id}`}
                                                className={`rounded-lg border bg-card transition-all duration-200 cursor-pointer overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${isExpanded ? 'shadow-md border-primary/40 ring-1 ring-primary/20' : 'hover:border-primary/40 hover:shadow-sm'}`}
                                                onClick={() => setExpandedId(isExpanded ? null : log.id)}
                                                onKeyDown={(event) => {
                                                    if (event.key === 'Enter' || event.key === ' ') {
                                                        event.preventDefault();
                                                        setExpandedId(isExpanded ? null : log.id);
                                                    }
                                                }}
                                            >
                                                <div className="p-4">
                                                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                                                        <div className="flex items-start gap-3">
                                                            <Avatar className="h-9 w-9 border border-border mt-0.5">
                                                                <AvatarImage src={log.userImage} />
                                                                <AvatarFallback className={`${getAvatarColor(log.userName)} text-white`}>
                                                                    {getInitials(log.userName)}
                                                                </AvatarFallback>
                                                            </Avatar>
                                                            <div className="space-y-1">
                                                                <div className="flex flex-wrap items-center gap-2">
                                                                    <span className="font-semibold text-sm text-foreground">
                                                                        {log.userName || log.userEmail || (log.action === 'sign_in_failed' ? 'Pengguna tidak dikenal' : 'System')}
                                                                    </span>
                                                                    <span className="text-muted-foreground text-xs">melakukan</span>
                                                                    <Badge variant="outline" className={`${actionConfig.color} border-0 font-normal`}>
                                                                        {actionConfig.label}
                                                                    </Badge>
                                                                    <span className="text-muted-foreground text-xs">pada</span>
                                                                    <Badge variant="outline" className={`${entityConfig.bgColor} ${entityConfig.color} border-0 font-normal capitalize`}>
                                                                        {entityConfig.label}
                                                                    </Badge>
                                                                </div>
                                                                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                                                    <div className="flex items-center gap-1">
                                                                        <Clock className="h-3 w-3" />
                                                                        {formatDate(log.createdAt)}
                                                                    </div>
                                                                    {log.ipAddress && (
                                                                        <div className="flex items-center gap-1" title="IP Address">
                                                                            <Laptop className="h-3 w-3" />
                                                                            {log.ipAddress}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center self-start text-muted-foreground sm:self-center" aria-hidden="true">
                                                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                                        </span>
                                                    </div>

                                                    {/* Expanded Details */}
                                                    <div id={`audit-detail-${log.id}`} aria-hidden={!isExpanded} className={`grid transition-all duration-300 ease-in-out ${isExpanded ? 'grid-rows-[1fr] opacity-100 mt-2' : 'grid-rows-[0fr] opacity-0'}`}>
                                                        <div className="overflow-hidden">
                                                            {renderChanges(log.changes)}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </CardContent>

                {/* Pagination */}
                {pagination.totalPages > 1 && (
                    <div className="flex items-center justify-between px-6 py-4 border-t bg-muted/20">
                        <p className="text-sm text-muted-foreground">
                            Halaman <span className="font-medium text-foreground">{pagination.page}</span> dari <span className="font-medium text-foreground">{pagination.totalPages}</span>
                        </p>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={pagination.page <= 1}
                                onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))}
                                className="h-8"
                            >
                                Sebelumnya
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={pagination.page >= pagination.totalPages}
                                onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))}
                                className="h-8"
                            >
                                Selanjutnya
                            </Button>
                        </div>
                    </div>
                )}
            </Card>
        </div>
    );
}
