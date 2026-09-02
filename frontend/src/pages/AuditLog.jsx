import { useState, useEffect, useCallback } from 'react';
import { Search, Filter, Clock, User, FileText, Edit, Trash2, Archive, Plus, RefreshCw, Loader2, AlertTriangle, ChevronDown, ChevronRight, Laptop, CalendarRange, Shield } from 'lucide-react';
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
};

const ENTITY_CONFIG = {
    'surat_masuk': { label: 'Surat Masuk', color: 'text-blue-600', bgColor: 'bg-blue-50 dark:bg-blue-500/15' },
    'surat_keluar': { label: 'Surat Keluar', color: 'text-green-600', bgColor: 'bg-green-50 dark:bg-green-500/15' },
    'arsip': { label: 'Arsip', color: 'text-purple-600', bgColor: 'bg-purple-50 dark:bg-purple-500/15' },
    'user': { label: 'User', color: 'text-orange-600', bgColor: 'bg-orange-50 dark:bg-orange-500/15' },
    'record_access_grant': { label: 'Persetujuan Akses', color: 'text-amber-700', bgColor: 'bg-amber-50 dark:bg-amber-500/15' },
};

export default function AuditLog() {
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

    const loadLogs = useCallback(async () => {
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
            setLogs(response.data || []);
            setPagination(prev => ({
                ...prev,
                total: response.pagination?.total || 0,
                totalPages: response.pagination?.totalPages || 0,
            }));
        } catch (err) {
            console.error('Failed to load logs:', err);
            setError('Gagal memuat audit log');
        } finally {
            setLoading(false);
        }
    }, [entityType, action, search, startDate, endDate, pagination.page, pagination.limit]);

    useEffect(() => {
        const timer = setTimeout(loadLogs, 300);
        return () => clearTimeout(timer);
    }, [loadLogs]);

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

    const renderChanges = (changes) => {
        if (!changes) return null;

        const { before, after, fields } = changes;
        if (!before && !after) return null;

        const changedFields = fields || Object.keys({ ...before, ...after });

        return (
            <div className="mt-3 bg-muted/30 rounded-lg text-sm border border-border/50 overflow-hidden">
                <div className="bg-muted/50 px-3 py-2 border-b border-border/50 flex items-center gap-2">
                    <Edit className="h-3 w-3 text-muted-foreground" />
                    <span className="font-medium text-xs uppercase text-muted-foreground">Detail Perubahan</span>
                </div>
                <div className="p-3 space-y-2">
                    {changedFields.map(field => (
                        <div key={field} className="grid grid-cols-1 sm:grid-cols-[120px_1fr] gap-1 sm:gap-4 text-xs sm:text-sm">
                            <span className="font-medium text-muted-foreground capitalize">{field.replace('_', ' ')}:</span>
                            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
                                {before?.[field] !== undefined && (
                                    <span className="text-red-600 line-through bg-red-50 dark:bg-red-500/15 px-1 rounded truncate max-w-xs block" title={String(before[field])}>
                                        {String(before[field])}
                                    </span>
                                )}
                                {before?.[field] !== undefined && after?.[field] !== undefined && (
                                    <span className="text-muted-foreground hidden sm:inline">→</span>
                                )}
                                {after?.[field] !== undefined && (
                                    <span className="text-green-600 bg-green-50 dark:bg-green-500/15 px-1 rounded font-medium break-all" title={String(after[field])}>
                                        {String(after[field])}
                                    </span>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
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
                <Badge variant="outline" className="h-8 gap-2 bg-background">
                    <Clock className="h-3.5 w-3.5" />
                    Total: {pagination.total} Log
                </Badge>
            </div>

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
                                    placeholder="Cari user, email, atau ID..."
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
                                <SelectTrigger className="w-full sm:w-[160px] h-8 text-xs bg-background">
                                    <SelectValue placeholder="Tipe Entity" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Semua Tipe</SelectItem>
                                    <SelectItem value="surat_masuk">Surat Masuk</SelectItem>
                                    <SelectItem value="surat_keluar">Surat Keluar</SelectItem>
                                    <SelectItem value="arsip">Arsip</SelectItem>
                                    <SelectItem value="user">User</SelectItem>
                                    <SelectItem value="record_access_grant">Persetujuan Akses</SelectItem>
                                </SelectContent>
                            </Select>
                            <Select value={action} onValueChange={applyFilter(setAction)}>
                                <SelectTrigger className="w-full sm:w-[160px] h-8 text-xs bg-background">
                                    <SelectValue placeholder="Aksi" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Semua Aksi</SelectItem>
                                    <SelectItem value="create">Membuat</SelectItem>
                                    <SelectItem value="update">Mengubah</SelectItem>
                                    <SelectItem value="delete">Menghapus</SelectItem>
                                    <SelectItem value="archive">Mengarsipkan</SelectItem>
                                    <SelectItem value="request_access">Meminta Akses</SelectItem>
                                    <SelectItem value="approve_access">Menyetujui Akses</SelectItem>
                                    <SelectItem value="deny_access">Menolak Akses</SelectItem>
                                    <SelectItem value="revoke_access">Mencabut Akses</SelectItem>
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
                                                                        {log.userName || log.userEmail || 'System'}
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
