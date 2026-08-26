import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
    AlertTriangle,
    CalendarDays,
    CheckCircle2,
    CopyPlus,
    ExternalLink,
    FileCheck2,
    GitBranch,
    Hash,
    History,
    LockKeyhole,
    RefreshCw,
    ShieldCheck,
    Upload,
    XCircle,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader, StatTile } from '@/components/PageHeader';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import regulatoryRuleSetService from '@/services/regulatory-rule-set.service';

const INSTRUMENTS = {
    klasifikasi: {
        label: 'Klasifikasi Arsip',
        shortLabel: 'Klasifikasi',
        editorPath: '/master/klasifikasi',
    },
    jra: {
        label: 'Jadwal Retensi Arsip',
        shortLabel: 'JRA',
        editorPath: '/master/jra',
    },
};

const STATUS = {
    active: { label: 'Aktif', variant: 'success' },
    draft: { label: 'Draft', variant: 'warning' },
    superseded: { label: 'Digantikan', variant: 'muted' },
    withdrawn: { label: 'Ditarik', variant: 'danger' },
};

const EMPTY_CLONE_FORM = {
    version: '',
    effectiveFrom: '',
    name: '',
    regulationNumber: '',
    legalBasis: '',
    sourceDocumentName: '',
    sourceDocumentSha256: '',
    sourceUrl: '',
    changeSummary: '',
};

function jakartaToday() {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function nextDay(value) {
    const date = new Date(`${value}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
}

function defaultEffectiveDate(activeRuleSet) {
    const today = jakartaToday();
    return activeRuleSet?.effectiveFrom >= today
        ? nextDay(activeRuleSet.effectiveFrom)
        : today;
}

function formatDate(value) {
    if (!value) return '—';
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    return Number.isNaN(date.getTime())
        ? value
        : date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatTimestamp(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? value
        : date.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

function shortHash(value) {
    if (!value) return 'Belum tersedia';
    return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

function cleanClonePayload(form) {
    const payload = {
        version: form.version.trim(),
        effectiveFrom: form.effectiveFrom,
    };
    for (const field of [
        'name',
        'regulationNumber',
        'legalBasis',
        'sourceDocumentName',
        'sourceDocumentSha256',
        'sourceUrl',
        'changeSummary',
    ]) {
        const value = form[field].trim();
        if (value) payload[field] = value;
    }
    return payload;
}

function StatusBadge({ status }) {
    const config = STATUS[status] || { label: status, variant: 'outline' };
    return <Badge variant={config.variant}>{config.label}</Badge>;
}

function ActiveRuleCard({ instrumentType, ruleSet, canPublish, onClone }) {
    const instrument = INSTRUMENTS[instrumentType];

    if (!ruleSet) {
        return (
            <Card className="border-dashed">
                <CardContent className="flex min-h-44 flex-col items-center justify-center text-center">
                    <AlertTriangle className="mb-3 h-8 w-8 text-warning" />
                    <p className="font-medium">Belum ada versi aktif</p>
                    <p className="mt-1 max-w-md text-sm text-muted-foreground">
                        {instrument.label} belum dapat dipakai untuk registrasi arsip sampai sebuah draft valid diaktifkan.
                    </p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="border-success/30 bg-success/[0.03]">
            <CardHeader>
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                    <div className="min-w-0">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                            <StatusBadge status="active" />
                            <Badge variant="outline">Versi {ruleSet.version}</Badge>
                        </div>
                        <CardTitle className="leading-snug">{ruleSet.name}</CardTitle>
                        <CardDescription className="mt-1">{ruleSet.regulationNumber}</CardDescription>
                    </div>
                    {canPublish && (
                        <Button onClick={onClone}>
                            <CopyPlus className="h-4 w-4" />
                            Buat draft revisi
                        </Button>
                    )}
                </div>
            </CardHeader>
            <CardContent>
                <div className="grid gap-4 text-sm md:grid-cols-2 xl:grid-cols-4">
                    <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Berlaku sejak</p>
                        <p className="mt-1 flex items-center gap-2 font-medium"><CalendarDays className="h-4 w-4" /> {formatDate(ruleSet.effectiveFrom)}</p>
                    </div>
                    <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Dokumen sumber</p>
                        <p className="mt-1 truncate font-medium" title={ruleSet.sourceDocumentName || ''}>{ruleSet.sourceDocumentName || 'Belum dicatat'}</p>
                    </div>
                    <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Hash dokumen</p>
                        <p className="mt-1 font-mono text-xs" title={ruleSet.sourceDocumentSha256 || ''}>{shortHash(ruleSet.sourceDocumentSha256)}</p>
                    </div>
                    <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Hash isi aturan</p>
                        <p className="mt-1 font-mono text-xs" title={ruleSet.contentHash || ''}>{shortHash(ruleSet.contentHash)}</p>
                    </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
                    <Button variant="outline" size="sm" asChild>
                        <Link to={`${instrument.editorPath}?ruleSetId=${ruleSet.id}`}>
                            Lihat master aktif <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                    </Button>
                    {ruleSet.sourceUrl && (
                        <Button variant="ghost" size="sm" asChild>
                            <a href={ruleSet.sourceUrl} target="_blank" rel="noopener noreferrer">
                                Buka sumber hukum <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                        </Button>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

function ValidationReport({ report }) {
    if (!report) return null;

    return (
        <div className="space-y-4">
            <Alert variant={report.valid ? 'default' : 'destructive'}>
                {report.valid
                    ? <CheckCircle2 className="h-4 w-4 text-success" />
                    : <XCircle className="h-4 w-4" />}
                <AlertTitle>{report.valid ? 'Draft lolos validasi' : 'Draft belum dapat diaktifkan'}</AlertTitle>
                <AlertDescription>
                    {report.valid
                        ? 'Struktur dan aturan wajib sudah konsisten. Peringatan tetap perlu ditinjau sebelum aktivasi.'
                        : 'Perbaiki seluruh kesalahan pada isi draft, lalu jalankan validasi kembali.'}
                </AlertDescription>
            </Alert>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatTile label="Total item" value={report.stats?.total ?? 0} />
                <StatTile label="Aktif" value={report.stats?.active ?? 0} />
                <StatTile label="Dapat dipilih" value={report.stats?.selectable ?? 0} />
                <StatTile label="Akar" value={report.stats?.roots ?? 0} />
            </div>

            {report.errors?.length > 0 && (
                <div>
                    <h3 className="mb-2 text-sm font-semibold text-destructive">Kesalahan ({report.errors.length})</h3>
                    <div className="max-h-44 space-y-2 overflow-y-auto rounded-md border border-destructive/20 bg-destructive/5 p-3">
                        {report.errors.map((issue, index) => (
                            <div key={`${issue.code}-${issue.itemCode || index}`} className="text-sm">
                                <span className="font-mono text-xs text-destructive">{issue.itemCode || issue.code}</span>
                                <p>{issue.message}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {report.warnings?.length > 0 && (
                <div>
                    <h3 className="mb-2 text-sm font-semibold text-warning-foreground dark:text-warning">Peringatan ({report.warnings.length})</h3>
                    <div className="max-h-44 space-y-2 overflow-y-auto rounded-md border border-warning/30 bg-warning/10 p-3">
                        {report.warnings.map((issue, index) => (
                            <div key={`${issue.code}-${issue.itemCode || index}`} className="text-sm">
                                <span className="font-mono text-xs text-muted-foreground">{issue.itemCode || issue.code}</span>
                                <p>{issue.message}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="rounded-md bg-muted p-3">
                <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"><Hash className="h-3.5 w-3.5" /> Hash isi hasil validasi</p>
                <p className="mt-1 break-all font-mono text-xs">{report.contentHash || '—'}</p>
            </div>
        </div>
    );
}

export default function RegulatoryRuleSets() {
    const { user } = useAuth();
    const { toast } = useToast();
    const [searchParams, setSearchParams] = useSearchParams();
    const canPublish = user?.role === 'super_admin';
    const requestedInstrument = searchParams.get('instrument');
    const [instrumentType, setInstrumentType] = useState(
        requestedInstrument === 'jra' ? 'jra' : 'klasifikasi',
    );
    const [ruleSets, setRuleSets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [cloneOpen, setCloneOpen] = useState(false);
    const [cloneForm, setCloneForm] = useState(EMPTY_CLONE_FORM);
    const [validationOpen, setValidationOpen] = useState(false);
    const [validationRuleSet, setValidationRuleSet] = useState(null);
    const [validationReport, setValidationReport] = useState(null);
    const [validationLoading, setValidationLoading] = useState(false);
    const [activation, setActivation] = useState(null);
    const [importRuleSet, setImportRuleSet] = useState(null);
    const [importItems, setImportItems] = useState([]);
    const [importFileName, setImportFileName] = useState('');
    const [importError, setImportError] = useState('');
    const [importResult, setImportResult] = useState(null);

    const activeRuleSet = useMemo(
        () => ruleSets.find((ruleSet) => ruleSet.status === 'active') || null,
        [ruleSets],
    );
    const otherRuleSets = useMemo(
        () => ruleSets.filter((ruleSet) => ruleSet.id !== activeRuleSet?.id),
        [activeRuleSet?.id, ruleSets],
    );
    const draftCount = useMemo(
        () => ruleSets.filter((ruleSet) => ruleSet.status === 'draft').length,
        [ruleSets],
    );

    const loadRuleSets = useCallback(async () => {
        try {
            setLoading(true);
            const response = await regulatoryRuleSetService.list({ instrumentType });
            setRuleSets(response.data || []);
        } catch (error) {
            toast({
                title: 'Gagal memuat versi aturan',
                description: error.message,
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
        }
    }, [instrumentType, toast]);

    useEffect(() => {
        loadRuleSets();
    }, [loadRuleSets]);

    const openClone = () => {
        if (!activeRuleSet) return;
        const date = defaultEffectiveDate(activeRuleSet);
        setCloneForm({
            ...EMPTY_CLONE_FORM,
            version: `${activeRuleSet.version}-revisi-${date}`,
            effectiveFrom: date,
        });
        setCloneOpen(true);
    };

    const submitClone = async (event) => {
        event.preventDefault();
        if (!cloneForm.version.trim() || !cloneForm.effectiveFrom) return;
        if (cloneForm.sourceDocumentSha256
            && !/^[0-9a-fA-F]{64}$/.test(cloneForm.sourceDocumentSha256.trim())) {
            toast({
                title: 'SHA-256 tidak valid',
                description: 'Hash dokumen harus tepat 64 karakter heksadesimal.',
                variant: 'destructive',
            });
            return;
        }

        try {
            setActionLoading(true);
            const response = await regulatoryRuleSetService.cloneActive(
                instrumentType,
                cleanClonePayload(cloneForm),
            );
            setCloneOpen(false);
            toast({
                title: 'Draft versi baru dibuat',
                description: `${response.data?.itemCount ?? 0} item disalin dari versi aktif. Edit dan validasi draft sebelum aktivasi.`,
            });
            await loadRuleSets();
        } catch (error) {
            toast({ title: 'Gagal membuat draft', description: error.message, variant: 'destructive' });
        } finally {
            setActionLoading(false);
        }
    };

    const validateDraft = async (ruleSet, forActivation = false) => {
        try {
            setValidationRuleSet(ruleSet);
            setValidationReport(null);
            setValidationLoading(true);
            if (!forActivation) setValidationOpen(true);
            const response = await regulatoryRuleSetService.validateDraft(ruleSet.id);
            const report = response.data;
            setValidationReport(report);
            if (forActivation && report.valid) {
                setActivation({ ruleSet, report });
            } else if (forActivation) {
                setValidationOpen(true);
            }
        } catch (error) {
            toast({ title: 'Validasi draft gagal', description: error.message, variant: 'destructive' });
        } finally {
            setValidationLoading(false);
        }
    };

    const activateDraft = async () => {
        if (!activation) return;
        try {
            setActionLoading(true);
            await regulatoryRuleSetService.activate(activation.ruleSet.id);
            toast({
                title: 'Versi aturan telah diaktifkan',
                description: 'Versi sebelumnya disimpan sebagai riwayat; snapshot arsip lama tetap dipertahankan.',
            });
            setActivation(null);
            await loadRuleSets();
        } catch (error) {
            toast({ title: 'Aktivasi gagal', description: error.message, variant: 'destructive' });
        } finally {
            setActionLoading(false);
        }
    };

    const openImport = (ruleSet) => {
        setImportRuleSet(ruleSet);
        setImportItems([]);
        setImportFileName('');
        setImportError('');
        setImportResult(null);
    };

    const closeImport = () => {
        if (actionLoading) return;
        setImportRuleSet(null);
        setImportItems([]);
        setImportFileName('');
        setImportError('');
        setImportResult(null);
    };

    const readImportFile = async (event) => {
        const file = event.target.files?.[0];
        setImportItems([]);
        setImportResult(null);
        setImportError('');
        setImportFileName(file?.name || '');
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) {
            setImportError('Berkas melebihi batas 10 MB.');
            return;
        }

        try {
            const parsed = JSON.parse(await file.text());
            const items = Array.isArray(parsed) ? parsed : parsed?.items;
            if (!Array.isArray(items)) {
                throw new Error('JSON harus berupa array item atau objek dengan properti "items".');
            }
            if (items.length < 1 || items.length > 3000) {
                throw new Error('Manifest harus berisi 1 sampai 3.000 item.');
            }
            setImportItems(items);
        } catch (error) {
            setImportError(error instanceof SyntaxError
                ? 'Berkas bukan JSON yang valid.'
                : error.message);
        }
    };

    const submitImport = async () => {
        if (!importRuleSet || !importItems.length) return;
        try {
            setActionLoading(true);
            setImportError('');
            setImportResult(null);
            const response = await regulatoryRuleSetService.importItems(importRuleSet.id, importItems);
            setImportResult(response.data);
            toast({
                title: 'Manifest draft berhasil diimpor',
                description: `${response.data?.imported ?? importItems.length} item menggantikan isi draft secara atomik.`,
            });
            await loadRuleSets();
        } catch (error) {
            if (error.details && !Array.isArray(error.details) && 'valid' in error.details) {
                setImportResult({ imported: 0, validation: error.details });
            }
            setImportError(error.message);
        } finally {
            setActionLoading(false);
        }
    };

    const instrument = INSTRUMENTS[instrumentType];
    const effectiveInFuture = (ruleSet) => ruleSet.effectiveFrom > jakartaToday();

    return (
        <div className="space-y-6">
            <PageHeader
                icon={GitBranch}
                title="Versi Aturan Kearsipan"
                description="Kelola edisi Klasifikasi Arsip dan JRA secara berjejak. Versi aktif bersifat terkunci; perubahan disiapkan pada draft baru."
                actions={(
                    <Button variant="outline" onClick={loadRuleSets} disabled={loading}>
                        <RefreshCw className={loading ? 'animate-spin' : ''} /> Muat ulang
                    </Button>
                )}
            />

            <Alert>
                <LockKeyhole className="h-4 w-4" />
                <AlertTitle>Pemisahan draft dan aturan aktif</AlertTitle>
                <AlertDescription>
                    Registrasi arsip selalu memakai versi aktif. Buat clone untuk perubahan regulasi, sunting isi draft melalui master data, validasi, lalu aktifkan setelah tanggal berlakunya.
                    {!canPublish && ' Akun Anda memiliki akses baca; publikasi versi hanya dapat dilakukan super administrator.'}
                </AlertDescription>
            </Alert>

            <Tabs value={instrumentType} onValueChange={(value) => {
                setInstrumentType(value);
                setSearchParams({ instrument: value }, { replace: true });
            }}>
                <TabsList className="grid w-full grid-cols-2 sm:w-[420px]">
                    <TabsTrigger value="klasifikasi">Klasifikasi Arsip</TabsTrigger>
                    <TabsTrigger value="jra">JRA</TabsTrigger>
                </TabsList>
            </Tabs>

            {loading ? (
                <div className="space-y-4">
                    <Skeleton className="h-56 w-full" />
                    <Skeleton className="h-72 w-full" />
                </div>
            ) : (
                <>
                    <section aria-labelledby="active-rule-heading">
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <div>
                                <h2 id="active-rule-heading" className="flex items-center gap-2 text-lg font-semibold"><ShieldCheck className="h-5 w-5 text-success" /> {instrument.label} aktif</h2>
                                <p className="text-sm text-muted-foreground">Sumber aturan kanonik untuk registrasi arsip baru.</p>
                            </div>
                            <Badge variant="outline">{ruleSets.length} versi · {draftCount} draft</Badge>
                        </div>
                        <ActiveRuleCard
                            instrumentType={instrumentType}
                            ruleSet={activeRuleSet}
                            canPublish={canPublish}
                            onClone={openClone}
                        />
                    </section>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2"><History className="h-5 w-5" /> Draft dan riwayat versi</CardTitle>
                            <CardDescription>
                                Draft dapat diperbaiki. Versi yang sudah aktif, digantikan, atau ditarik tetap immutable untuk menjaga bukti administrasi.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="px-0 sm:px-5">
                            {otherRuleSets.length === 0 ? (
                                <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                                    Belum ada draft atau riwayat versi untuk {instrument.shortLabel}.
                                </div>
                            ) : (
                                <Table responsive>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Versi</TableHead>
                                            <TableHead>Dasar hukum</TableHead>
                                            <TableHead>Masa berlaku</TableHead>
                                            <TableHead>Integritas</TableHead>
                                            <TableHead className="text-right">Tindakan</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {otherRuleSets.map((ruleSet) => (
                                            <TableRow key={ruleSet.id}>
                                                <TableCell data-label="Versi">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className="font-semibold">{ruleSet.version}</span>
                                                        <StatusBadge status={ruleSet.status} />
                                                    </div>
                                                    <p className="mt-1 max-w-[280px] truncate text-xs text-muted-foreground" title={ruleSet.name}>{ruleSet.name}</p>
                                                    {ruleSet.status === 'draft' && effectiveInFuture(ruleSet) && (
                                                        <p className="mt-1 text-xs text-warning-foreground dark:text-warning">Aktivasi tersedia mulai {formatDate(ruleSet.effectiveFrom)}</p>
                                                    )}
                                                </TableCell>
                                                <TableCell data-label="Dasar hukum">
                                                    <p className="max-w-[300px] truncate font-medium" title={ruleSet.regulationNumber}>{ruleSet.regulationNumber}</p>
                                                    <p className="mt-1 max-w-[300px] truncate text-xs text-muted-foreground" title={ruleSet.changeSummary || ''}>{ruleSet.changeSummary || 'Tanpa ringkasan perubahan'}</p>
                                                </TableCell>
                                                <TableCell data-label="Masa berlaku">
                                                    <p>{formatDate(ruleSet.effectiveFrom)} — {formatDate(ruleSet.effectiveTo)}</p>
                                                    <p className="mt-1 text-xs text-muted-foreground">Publikasi: {formatTimestamp(ruleSet.publishedAt)}</p>
                                                </TableCell>
                                                <TableCell data-label="Integritas">
                                                    <p className="font-mono text-xs" title={ruleSet.contentHash || ''}>{shortHash(ruleSet.contentHash)}</p>
                                                    <p className="mt-1 text-xs text-muted-foreground">{ruleSet.sourceDocumentSha256 ? 'Dokumen ter-hash' : 'Hash dokumen belum dicatat'}</p>
                                                </TableCell>
                                                <TableCell data-label="Tindakan" className="text-right">
                                                    {ruleSet.status === 'draft' && canPublish ? (
                                                        <div className="flex flex-wrap justify-end gap-2">
                                                            <Button variant="outline" size="sm" asChild>
                                                                <Link to={`${instrument.editorPath}?ruleSetId=${ruleSet.id}&mode=draft`}>
                                                                    Edit isi
                                                                </Link>
                                                            </Button>
                                                            <Button variant="outline" size="sm" onClick={() => validateDraft(ruleSet)}>
                                                                <FileCheck2 /> Validasi
                                                            </Button>
                                                            <Button variant="outline" size="sm" onClick={() => openImport(ruleSet)}>
                                                                <Upload /> Impor JSON
                                                            </Button>
                                                            <Button
                                                                size="sm"
                                                                disabled={validationLoading || effectiveInFuture(ruleSet)}
                                                                title={effectiveInFuture(ruleSet) ? `Belum berlaku sampai ${formatDate(ruleSet.effectiveFrom)}` : 'Validasi lalu aktifkan'}
                                                                onClick={() => validateDraft(ruleSet, true)}
                                                            >
                                                                <ShieldCheck /> Aktifkan
                                                            </Button>
                                                        </div>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><LockKeyhole className="h-3.5 w-3.5" /> Terkunci</span>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                        </CardContent>
                    </Card>
                </>
            )}

            <Dialog open={cloneOpen} onOpenChange={(open) => !actionLoading && setCloneOpen(open)}>
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                    <form onSubmit={submitClone}>
                        <DialogHeader>
                            <DialogTitle>Buat draft {instrument.label}</DialogTitle>
                            <DialogDescription>
                                Seluruh item versi aktif disalin. Kolom yang dikosongkan akan mewarisi metadata versi aktif.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-5 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="rule-version">Versi <span className="text-destructive">*</span></Label>
                                <Input id="rule-version" value={cloneForm.version} maxLength={100} onChange={(event) => setCloneForm((form) => ({ ...form, version: event.target.value }))} required />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="effective-from">Tanggal berlaku <span className="text-destructive">*</span></Label>
                                <Input id="effective-from" type="date" value={cloneForm.effectiveFrom} onChange={(event) => setCloneForm((form) => ({ ...form, effectiveFrom: event.target.value }))} required />
                            </div>
                            <div className="space-y-2 sm:col-span-2">
                                <Label htmlFor="rule-name">Nama edisi</Label>
                                <Input id="rule-name" value={cloneForm.name} onChange={(event) => setCloneForm((form) => ({ ...form, name: event.target.value }))} placeholder={activeRuleSet?.name} />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="regulation-number">Nomor peraturan</Label>
                                <Input id="regulation-number" value={cloneForm.regulationNumber} onChange={(event) => setCloneForm((form) => ({ ...form, regulationNumber: event.target.value }))} placeholder={activeRuleSet?.regulationNumber} />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="source-document">Nama dokumen sumber</Label>
                                <Input id="source-document" value={cloneForm.sourceDocumentName} onChange={(event) => setCloneForm((form) => ({ ...form, sourceDocumentName: event.target.value }))} placeholder="Nama berkas PDF resmi" />
                            </div>
                            <div className="space-y-2 sm:col-span-2">
                                <Label htmlFor="legal-basis">Dasar hukum</Label>
                                <Textarea id="legal-basis" value={cloneForm.legalBasis} onChange={(event) => setCloneForm((form) => ({ ...form, legalBasis: event.target.value }))} rows={2} placeholder="Kosongkan untuk memakai dasar hukum versi aktif" />
                            </div>
                            <div className="space-y-2 sm:col-span-2">
                                <Label htmlFor="source-hash">SHA-256 dokumen sumber</Label>
                                <Input id="source-hash" className="font-mono text-xs" value={cloneForm.sourceDocumentSha256} maxLength={64} onChange={(event) => setCloneForm((form) => ({ ...form, sourceDocumentSha256: event.target.value.replace(/\s/g, '') }))} placeholder="64 karakter heksadesimal" />
                            </div>
                            <div className="space-y-2 sm:col-span-2">
                                <Label htmlFor="source-url">URL sumber resmi</Label>
                                <Input id="source-url" type="url" value={cloneForm.sourceUrl} onChange={(event) => setCloneForm((form) => ({ ...form, sourceUrl: event.target.value }))} placeholder="https://..." />
                            </div>
                            <div className="space-y-2 sm:col-span-2">
                                <Label htmlFor="change-summary">Ringkasan perubahan</Label>
                                <Textarea id="change-summary" value={cloneForm.changeSummary} onChange={(event) => setCloneForm((form) => ({ ...form, changeSummary: event.target.value }))} rows={3} placeholder="Uraikan alasan dan ruang lingkup perubahan." />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setCloneOpen(false)} disabled={actionLoading}>Batal</Button>
                            <Button type="submit" disabled={actionLoading || !cloneForm.version.trim() || !cloneForm.effectiveFrom}>
                                {actionLoading ? 'Menyalin…' : 'Buat draft'}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog open={validationOpen} onOpenChange={setValidationOpen}>
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Hasil validasi {validationRuleSet?.version}</DialogTitle>
                        <DialogDescription>
                            Pemeriksaan struktur, item yang dapat dipilih, aturan retensi, dan hash konten draft.
                        </DialogDescription>
                    </DialogHeader>
                    {validationLoading ? (
                        <div className="space-y-3 py-4"><Skeleton className="h-20" /><Skeleton className="h-28" /></div>
                    ) : (
                        <ValidationReport report={validationReport} />
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setValidationOpen(false)}>Tutup</Button>
                        {validationReport?.valid && canPublish && validationRuleSet && !effectiveInFuture(validationRuleSet) && (
                            <Button onClick={() => {
                                setValidationOpen(false);
                                setActivation({ ruleSet: validationRuleSet, report: validationReport });
                            }}>
                                Lanjut ke aktivasi
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={Boolean(importRuleSet)} onOpenChange={(open) => !open && closeImport()}>
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Impor manifest ke draft {importRuleSet?.version}</DialogTitle>
                        <DialogDescription>
                            Impor yang lolos validasi akan mengganti seluruh isi draft secara atomik. Versi aktif dan snapshot arsip tidak berubah.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="rule-manifest">Berkas JSON</Label>
                            <Input
                                id="rule-manifest"
                                key={importRuleSet?.id}
                                type="file"
                                accept="application/json,.json"
                                disabled={actionLoading}
                                onChange={readImportFile}
                            />
                            <p className="text-xs text-muted-foreground">
                                Dapat berupa array item langsung atau objek <span className="font-mono">{'{ "items": [...] }'}</span>; maksimal 3.000 item dan 10 MB.
                            </p>
                        </div>

                        {importFileName && !importError && !importResult && (
                            <Alert>
                                <FileCheck2 className="h-4 w-4" />
                                <AlertTitle>{importFileName}</AlertTitle>
                                <AlertDescription>{importItems.length} item siap diperiksa dan diimpor oleh server.</AlertDescription>
                            </Alert>
                        )}

                        {importError && (
                            <Alert variant="destructive">
                                <XCircle className="h-4 w-4" />
                                <AlertTitle>Impor belum berhasil</AlertTitle>
                                <AlertDescription>{importError}</AlertDescription>
                            </Alert>
                        )}

                        {importResult && (
                            <>
                                {importResult.imported > 0 && (
                                    <Alert>
                                        <CheckCircle2 className="h-4 w-4 text-success" />
                                        <AlertTitle>{importResult.imported} item berhasil disimpan</AlertTitle>
                                        <AlertDescription>Hasil di bawah ini adalah validasi atas isi draft yang baru.</AlertDescription>
                                    </Alert>
                                )}
                                <ValidationReport report={importResult.validation} />
                            </>
                        )}
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={closeImport} disabled={actionLoading}>Tutup</Button>
                        {!importResult?.imported && (
                            <Button
                                onClick={submitImport}
                                disabled={actionLoading || importItems.length === 0 || Boolean(importError)}
                            >
                                <Upload /> {actionLoading ? 'Memvalidasi dan mengimpor…' : 'Ganti isi draft'}
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog open={Boolean(activation)} onOpenChange={(open) => !open && !actionLoading && setActivation(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Aktifkan versi {activation?.ruleSet.version}?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Versi ini akan menjadi sumber aturan untuk registrasi arsip baru. Versi aktif saat ini dipindahkan ke riwayat dan tidak dapat diedit lagi. Snapshot pada arsip lama tidak berubah.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {activation?.report.warnings?.length > 0 && (
                        <Alert>
                            <AlertTriangle className="h-4 w-4 text-warning" />
                            <AlertTitle>{activation.report.warnings.length} peringatan perlu dicatat</AlertTitle>
                            <AlertDescription>Validasi tetap lulus, tetapi hasil manual harus ditelaah oleh petugas berwenang.</AlertDescription>
                        </Alert>
                    )}
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={actionLoading}>Batal</AlertDialogCancel>
                        <AlertDialogAction onClick={activateDraft} disabled={actionLoading}>
                            {actionLoading ? 'Mengaktifkan…' : 'Ya, aktifkan versi'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
