import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ArchiveRestore, CheckCircle2, ClipboardCheck, FileCheck2, History, Loader2, Plus, Scale, ShieldCheck, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import retentionGovernanceService from '@/services/retention-governance.service';
import arsipService from '@/services/arsip.service';
import api from '@/services/api';

const EMPTY_APPRAISAL = {
    arsipId: '',
    caseType: 'dinilai_kembali',
    reason: '',
    proposedOutcome: 'dinilai_kembali',
    proposedRationale: '',
    itemDecisions: [],
};

const EMPTY_EVENT = {
    arsipId: '',
    eventType: 'berkas_ditutup',
    eventDate: '',
    label: '',
    evidenceUri: '',
    evidenceSha256: '',
    correctsEventId: undefined,
    correctionReason: undefined,
};

const EMPTY_TRANSFER = {
    manifestNumber: '',
    destination: '',
    description: '',
    supersedesManifestId: undefined,
    items: [{ arsipId: '', appraisalDecisionId: '', objectUri: '', objectSha256: '' }],
};

const STATUS_LABELS = {
    open: 'Draft',
    in_review: 'Menunggu telaah',
    approved: 'Disetujui',
    rejected: 'Ditolak',
    draft: 'Draft',
    cancellation_pending: 'Pembatalan menunggu telaah',
    cancelled: 'Dibatalkan',
    handed_over: 'Diserahterimakan',
    acknowledged: 'Diterima lembaga kearsipan',
};

const PAGE_SIZE = 20;
const EMPTY_PAGINATION = { page: 1, limit: PAGE_SIZE, total: 0, totalPages: 1 };

function listFrom(response) {
    if (Array.isArray(response)) return response;
    if (Array.isArray(response?.data)) return response.data;
    return [];
}

function shortId(value) {
    return value ? `${String(value).slice(0, 8)}…` : '—';
}

function formatTimestamp(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('id-ID');
}

function paginationFrom(response, requestedPage) {
    const pagination = response?.pagination || {};
    const total = Number(pagination.total) || 0;
    const totalPages = Math.max(1, Number(pagination.totalPages) || Math.ceil(total / PAGE_SIZE) || 1);
    return {
        page: Math.min(Math.max(1, Number(pagination.page) || requestedPage), totalPages),
        limit: Number(pagination.limit) || PAGE_SIZE,
        total,
        totalPages,
    };
}

function PaginationControls({ pagination, onPageChange }) {
    return (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 sm:px-0">
            <p className="text-xs text-muted-foreground">
                {pagination.total} data · Halaman {pagination.page} dari {pagination.totalPages}
            </p>
            <div className="flex gap-2">
                <Button type="button" size="sm" variant="outline" disabled={pagination.page <= 1} onClick={() => onPageChange(pagination.page - 1)}>Sebelumnya</Button>
                <Button type="button" size="sm" variant="outline" disabled={pagination.page >= pagination.totalPages} onClick={() => onPageChange(pagination.page + 1)}>Berikutnya</Button>
            </div>
        </div>
    );
}

function OutcomeBadge({ value }) {
    const label = value === 'musnah' ? 'Musnah' : value === 'permanen' ? 'Permanen' : 'Dinilai Kembali';
    return <Badge variant="outline">{label}</Badge>;
}

function EvidenceLocator({ uri }) {
    if (!uri) return <span>—</span>;
    return /^https:\/\//i.test(uri)
        ? <a className="break-all text-primary underline" href={uri} target="_blank" rel="noopener noreferrer">Buka bukti</a>
        : <span className="break-all font-mono text-xs">{uri}</span>;
}

function ArchivePicker({ value, onChange, onSelect, label = 'Arsip' }) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [searching, setSearching] = useState(false);

    useEffect(() => {
        if (query.trim().length < 3) {
            setResults([]);
            return undefined;
        }
        let active = true;
        const timer = window.setTimeout(async () => {
            try {
                setSearching(true);
                const response = await arsipService.search({ q: query.trim(), limit: 8 });
                if (active) setResults(response.data || []);
            } catch {
                if (active) setResults([]);
            } finally {
                if (active) setSearching(false);
            }
        }, 300);
        return () => {
            active = false;
            window.clearTimeout(timer);
        };
    }, [query]);

    const choose = async (archive) => {
        onChange(archive.id);
        setQuery(`${archive.nomorBerkas || 'Tanpa nomor'} — ${archive.uraianBerkas || archive.jenisArsip || archive.id}`);
        setResults([]);
        if (onSelect) {
            try {
                const detail = await arsipService.getById(archive.id);
                onSelect(detail || archive);
            } catch {
                onSelect(archive);
            }
        }
    };

    return (
        <div className="space-y-2">
            <Label>{label}</Label>
            <div className="relative">
                <Input
                    value={query}
                    onChange={(event) => {
                        setQuery(event.target.value);
                        if (value) onChange('');
                    }}
                    placeholder="Cari nomor atau uraian arsip (min. 3 karakter)"
                />
                {searching && <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
                {results.length > 0 && (
                    <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-lg">
                        {results.map((archive) => (
                            <button key={archive.id} type="button" className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => choose(archive)}>
                                <span className="font-medium">{archive.nomorBerkas || 'Tanpa nomor berkas'}</span>
                                <span className="block truncate text-xs text-muted-foreground">{archive.uraianBerkas || archive.jenisArsip || archive.id}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>
            {value && <p className="font-mono text-[11px] text-muted-foreground">ID terpilih: {value}</p>}
        </div>
    );
}

function PermanentDecisionPicker({ arsipId, value, onChange }) {
    const [decisions, setDecisions] = useState([]);
    const [loadedFor, setLoadedFor] = useState(null);

    useEffect(() => {
        let active = true;
        if (!arsipId) return undefined;
        retentionGovernanceService.listAppraisals({ arsipId, status: 'approved', limit: 100 })
            .then((response) => {
                if (active) {
                    setDecisions(listFrom(response).filter((item) => (
                        item.proposedOutcome === 'permanen' && item.appraisalDecisionId
                    )));
                    setLoadedFor(arsipId);
                }
            })
            .catch(() => {
                if (active) {
                    setDecisions([]);
                    setLoadedFor(arsipId);
                }
            });
        return () => { active = false; };
    }, [arsipId]);

    return (
        <div className="space-y-2">
            <Label>Keputusan appraisal Permanen</Label>
            <Select value={value} onValueChange={onChange} disabled={!arsipId || loadedFor !== arsipId || decisions.length === 0}>
                <SelectTrigger><SelectValue placeholder={loadedFor !== arsipId ? 'Memuat keputusan…' : decisions.length ? 'Pilih keputusan' : 'Belum ada keputusan Permanen'} /></SelectTrigger>
                <SelectContent>{decisions.map((decision) => <SelectItem key={decision.appraisalDecisionId} value={decision.appraisalDecisionId}>{decision.nomorBerkas || shortId(decision.arsipId)} · keputusan {shortId(decision.appraisalDecisionId)}</SelectItem>)}</SelectContent>
            </Select>
        </div>
    );
}

function VerifiedAttachmentPicker({ archiveIds, value, onChange, label }) {
    const [attachments, setAttachments] = useState([]);
    const [loadedKey, setLoadedKey] = useState('');
    const idsKey = [...new Set((archiveIds || []).filter(Boolean))].sort().join(',');
    const visibleAttachments = loadedKey === idsKey ? attachments : [];
    const loadingAttachments = Boolean(idsKey && loadedKey !== idsKey);

    useEffect(() => {
        let active = true;
        if (!idsKey) return undefined;
        const ids = idsKey.split(',');
        Promise.allSettled(ids.map((id) => api.get(`/api/upload/arsip/${id}`)))
            .then((results) => {
                if (!active) return;
                const eligible = results.flatMap((result) => (
                    result.status === 'fulfilled' ? listFrom(result.value) : []
                )).filter((attachment) => (
                    attachment.storageAccess === 'private'
                    && attachment.integrityStatus === 'verified'
                    && attachment.malwareScanStatus === 'clean'
                    && /^[0-9a-f]{64}$/i.test(attachment.sha256 || '')
                    && attachment.lastFixityCheckAt
                ));
                setAttachments(eligible);
                setLoadedKey(idsKey);
            })
        return () => { active = false; };
    }, [idsKey]);

    return (
        <div className="space-y-2">
            <Label>{label}</Label>
            <Select
                value={value || ''}
                disabled={!idsKey || loadingAttachments || visibleAttachments.length === 0}
                onValueChange={(attachmentId) => {
                    const attachment = visibleAttachments.find((item) => item.id === attachmentId);
                    if (attachment) onChange({
                        attachmentId: attachment.id,
                        uri: `attachment:${attachment.id}`,
                        sha256: attachment.sha256.toLowerCase(),
                    });
                }}
            >
                <SelectTrigger><SelectValue placeholder={loadingAttachments ? 'Memuat lampiran…' : visibleAttachments.length ? 'Pilih lampiran terverifikasi' : 'Belum ada lampiran yang lolos verifikasi'} /></SelectTrigger>
                <SelectContent>{visibleAttachments.map((attachment) => (
                    <SelectItem key={attachment.id} value={attachment.id}>
                        {attachment.fileName || shortId(attachment.id)} · {shortId(attachment.sha256)}
                    </SelectItem>
                ))}</SelectContent>
            </Select>
            {value && <p className="break-all font-mono text-[11px] text-muted-foreground">attachment:{value}</p>}
            {!loadingAttachments && idsKey && visibleAttachments.length === 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                    Unggah dokumen pada detail arsip, lalu tunggu pemindaian malware dan verifikasi fixity berstatus bersih.
                </p>
            )}
        </div>
    );
}

export default function RetentionGovernance() {
    const { toast } = useToast();
    const { user } = useAuth();
    const canOperate = ['super_admin', 'admin_dirjen', 'admin_sesditjen'].includes(user?.role);
    const [tab, setTab] = useState('appraisals');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [appraisals, setAppraisals] = useState([]);
    const [events, setEvents] = useState([]);
    const [transfers, setTransfers] = useState([]);
    const [appraisalStatus, setAppraisalStatus] = useState('all');
    const [eventStatus, setEventStatus] = useState('pending');
    const [appraisalPage, setAppraisalPage] = useState(1);
    const [eventPage, setEventPage] = useState(1);
    const [transferPage, setTransferPage] = useState(1);
    const [appraisalPagination, setAppraisalPagination] = useState(EMPTY_PAGINATION);
    const [eventPagination, setEventPagination] = useState(EMPTY_PAGINATION);
    const [transferPagination, setTransferPagination] = useState(EMPTY_PAGINATION);
    const [loadErrors, setLoadErrors] = useState([]);

    const [appraisalOpen, setAppraisalOpen] = useState(false);
    const [appraisalForm, setAppraisalForm] = useState(EMPTY_APPRAISAL);
    const [appraisalArchive, setAppraisalArchive] = useState(null);
    const [selectedAppraisal, setSelectedAppraisal] = useState(null);
    const [reviewMode, setReviewMode] = useState('approve');
    const [reviewReason, setReviewReason] = useState('');
    const [evidenceForm, setEvidenceForm] = useState({ label: '', evidenceUri: '', evidenceSha256: '', mediaType: 'application/pdf' });

    const [eventOpen, setEventOpen] = useState(false);
    const [eventForm, setEventForm] = useState(EMPTY_EVENT);
    const [verifyEvent, setVerifyEvent] = useState(null);
    const [verification, setVerification] = useState({ verdict: 'verified', note: '' });
    const [eventHistoryArchive, setEventHistoryArchive] = useState(null);
    const [eventHistoryRows, setEventHistoryRows] = useState([]);
    const [eventHistoryCurrent, setEventHistoryCurrent] = useState(null);
    const [eventHistoryLoading, setEventHistoryLoading] = useState(false);
    const [eventHistoryError, setEventHistoryError] = useState('');

    const [transferOpen, setTransferOpen] = useState(false);
    const [transferForm, setTransferForm] = useState(EMPTY_TRANSFER);
    const [selectedTransfer, setSelectedTransfer] = useState(null);
    const [transferEventMode, setTransferEventMode] = useState('handover');
    const [transferEvent, setTransferEvent] = useState({
        eventAt: '', referenceNumber: '', counterparty: '', documentUri: '', documentSha256: '', documentAttachmentId: '', notes: '',
    });
    const [cancellationReason, setCancellationReason] = useState('');
    const [cancellationReview, setCancellationReview] = useState({ verdict: 'approved', note: '' });

    const loadData = useCallback(async () => {
        setLoading(true);
        const [appraisalResult, eventResult, transferResult] = await Promise.allSettled([
            retentionGovernanceService.listAppraisals({ ...(appraisalStatus === 'all' ? {} : { status: appraisalStatus }), page: appraisalPage, limit: PAGE_SIZE }),
            retentionGovernanceService.listRetentionEvents({ verificationStatus: eventStatus, page: eventPage, limit: PAGE_SIZE }),
            retentionGovernanceService.listPermanentTransfers({ page: transferPage, limit: PAGE_SIZE }),
        ]);
        const errors = [];
        if (appraisalResult.status === 'fulfilled') {
            const pagination = paginationFrom(appraisalResult.value, appraisalPage);
            setAppraisals(listFrom(appraisalResult.value));
            setAppraisalPagination(pagination);
            if (pagination.page !== appraisalPage) setAppraisalPage(pagination.page);
        } else {
            setAppraisals([]);
            setAppraisalPagination({ ...EMPTY_PAGINATION, page: appraisalPage });
            errors.push(`Appraisal: ${appraisalResult.reason?.message || 'gagal dimuat'}`);
        }
        if (eventResult.status === 'fulfilled') {
            const pagination = paginationFrom(eventResult.value, eventPage);
            setEvents(listFrom(eventResult.value));
            setEventPagination(pagination);
            if (pagination.page !== eventPage) setEventPage(pagination.page);
        } else {
            setEvents([]);
            setEventPagination({ ...EMPTY_PAGINATION, page: eventPage });
            errors.push(`Peristiwa retensi: ${eventResult.reason?.message || 'gagal dimuat'}`);
        }
        if (transferResult.status === 'fulfilled') {
            const pagination = paginationFrom(transferResult.value, transferPage);
            setTransfers(listFrom(transferResult.value));
            setTransferPagination(pagination);
            if (pagination.page !== transferPage) setTransferPage(pagination.page);
        } else {
            setTransfers([]);
            setTransferPagination({ ...EMPTY_PAGINATION, page: transferPage });
            errors.push(`Penyerahan: ${transferResult.reason?.message || 'gagal dimuat'}`);
        }
        setLoadErrors(errors);
        setLoading(false);
    }, [appraisalPage, appraisalStatus, eventPage, eventStatus, transferPage]);

    useEffect(() => { loadData(); }, [loadData]);

    const counters = useMemo(() => ({
        appraisal: appraisalPagination.total,
        events: eventPagination.total,
        transfers: transferPagination.total,
    }), [appraisalPagination.total, eventPagination.total, transferPagination.total]);

    const run = async (operation, successMessage) => {
        try {
            setSaving(true);
            await operation();
            toast({ title: successMessage, description: 'Perubahan dan aktornya telah dicatat pada jejak audit.' });
            await loadData();
            return true;
        } catch (error) {
            toast({ title: 'Tindakan belum berhasil', description: error.message, variant: 'destructive' });
            return false;
        } finally {
            setSaving(false);
        }
    };

    const createAppraisal = async () => {
        const ok = await run(
            () => retentionGovernanceService.createAppraisal(appraisalForm),
            'Kasus appraisal dibuat',
        );
        if (ok) { setAppraisalOpen(false); setAppraisalForm(EMPTY_APPRAISAL); setAppraisalArchive(null); }
    };

    const openAppraisal = async (id) => {
        try {
            const response = await retentionGovernanceService.getAppraisal(id);
            setSelectedAppraisal(response.data || response);
        } catch (error) {
            toast({ title: 'Detail appraisal tidak dapat dimuat', description: error.message, variant: 'destructive' });
        }
    };

    const submitAppraisal = async () => {
        const ok = await run(() => retentionGovernanceService.submitAppraisal(selectedAppraisal.id), 'Appraisal diajukan');
        if (ok) setSelectedAppraisal(null);
    };

    const finalizeAppraisal = async () => {
        const action = reviewMode === 'approve'
            ? retentionGovernanceService.approveAppraisal
            : retentionGovernanceService.rejectAppraisal;
        const ok = await run(() => action(selectedAppraisal.id, reviewReason), reviewMode === 'approve' ? 'Appraisal disetujui' : 'Appraisal ditolak');
        if (ok) { setSelectedAppraisal(null); setReviewReason(''); }
    };

    const addEvidence = async () => {
        const ok = await run(() => retentionGovernanceService.addEvidence(selectedAppraisal.id, evidenceForm), 'Bukti appraisal ditambahkan');
        if (ok) {
            setEvidenceForm({ label: '', evidenceUri: '', evidenceSha256: '', mediaType: 'application/pdf' });
            await openAppraisal(selectedAppraisal.id);
        }
    };

    const createEvent = async () => {
        const ok = await run(() => retentionGovernanceService.createRetentionEvent(eventForm), 'Peristiwa retensi dicatat');
        if (ok) { setEventOpen(false); setEventForm(EMPTY_EVENT); }
    };

    const openEventCorrection = (entry) => {
        const event = entry?.event || entry;
        setEventForm({
            arsipId: event.arsipId,
            eventType: event.eventType,
            eventDate: event.eventDate,
            label: event.label,
            evidenceUri: event.evidenceUri,
            evidenceSha256: event.evidenceSha256,
            correctsEventId: event.id,
            correctionReason: '',
        });
        setEventOpen(true);
    };

    const openEventHistory = async (entry) => {
        const event = entry?.event || entry;
        setEventHistoryArchive({
            id: event.arsipId,
            label: event.nomorBerkas || shortId(event.arsipId),
        });
        setEventHistoryRows([]);
        setEventHistoryCurrent(null);
        setEventHistoryError('');
        setEventHistoryLoading(true);
        try {
            const response = await retentionGovernanceService.listArchiveRetentionEvents(event.arsipId);
            setEventHistoryRows(listFrom(response));
            setEventHistoryCurrent(response.currentVerified || null);
        } catch (error) {
            setEventHistoryError(error.message || 'Riwayat revisi tidak dapat dimuat.');
        } finally {
            setEventHistoryLoading(false);
        }
    };

    const verifySelectedEvent = async () => {
        const event = verifyEvent?.event || verifyEvent;
        const ok = await run(() => retentionGovernanceService.verifyRetentionEvent(event.id, verification), verification.verdict === 'verified' ? 'Bukti pemicu diverifikasi' : 'Bukti pemicu ditolak');
        if (ok) { setVerifyEvent(null); setVerification({ verdict: 'verified', note: '' }); }
    };

    const createTransfer = async () => {
        const ok = await run(() => retentionGovernanceService.createPermanentTransfer(transferForm), 'Manifest penyerahan dibuat');
        if (ok) { setTransferOpen(false); setTransferForm(EMPTY_TRANSFER); }
    };

    const openNewTransfer = () => {
        setTransferForm({
            ...EMPTY_TRANSFER,
            items: [{ ...EMPTY_TRANSFER.items[0] }],
        });
        setTransferOpen(true);
    };

    const openReplacementTransfer = () => {
        if (!selectedTransfer || selectedTransfer.status !== 'cancelled') return;
        setTransferForm({
            manifestNumber: '',
            destination: selectedTransfer.destination || '',
            description: `Pengganti manifest ${selectedTransfer.manifestNumber}`,
            supersedesManifestId: selectedTransfer.id,
            items: (selectedTransfer.items || []).map((item) => ({
                arsipId: item.arsipId,
                appraisalDecisionId: item.appraisalDecisionId,
                objectUri: item.objectUri,
                objectSha256: item.objectSha256,
            })),
        });
        setSelectedTransfer(null);
        setTransferOpen(true);
    };

    const openTransfer = async (id) => {
        try {
            const response = await retentionGovernanceService.getPermanentTransfer(id);
            const detail = response.data || response;
            setSelectedTransfer(detail);
            setTransferEventMode(detail.status === 'handed_over' ? 'acknowledgement' : 'handover');
            setTransferEvent({ eventAt: '', referenceNumber: '', counterparty: '', documentUri: '', documentSha256: '', documentAttachmentId: '', notes: '' });
            setCancellationReason('');
            setCancellationReview({ verdict: 'approved', note: '' });
        } catch (error) {
            toast({ title: 'Manifest tidak dapat dimuat', description: error.message, variant: 'destructive' });
        }
    };

    const recordTransferEvent = async () => {
        if (!selectedTransfer || selectedTransfer.status === 'acknowledged') return;
        const action = transferEventMode === 'handover'
            ? retentionGovernanceService.recordHandover
            : retentionGovernanceService.recordAcknowledgement;
        const payload = {
            eventAt: transferEvent.eventAt ? new Date(transferEvent.eventAt).toISOString() : '',
            referenceNumber: transferEvent.referenceNumber,
            counterparty: transferEvent.counterparty,
            documentUri: transferEvent.documentUri,
            documentSha256: transferEvent.documentSha256,
            ...(transferEvent.notes.trim() ? { notes: transferEvent.notes.trim() } : {}),
        };
        const ok = await run(() => action(selectedTransfer.id, payload), transferEventMode === 'handover' ? 'Serah terima dicatat' : 'Penerimaan dicatat');
        if (ok) { setSelectedTransfer(null); setTransferEvent({ eventAt: '', referenceNumber: '', counterparty: '', documentUri: '', documentSha256: '', documentAttachmentId: '', notes: '' }); }
    };

    const requestTransferCancellation = async () => {
        if (!selectedTransfer) return;
        const manifestId = selectedTransfer.id;
        const ok = await run(
            () => retentionGovernanceService.requestPermanentTransferCancellation(manifestId, cancellationReason),
            'Permintaan pembatalan diajukan',
        );
        if (ok) await openTransfer(manifestId);
    };

    const reviewTransferCancellation = async (requestId) => {
        if (!selectedTransfer) return;
        const manifestId = selectedTransfer.id;
        const ok = await run(
            () => retentionGovernanceService.reviewPermanentTransferCancellation(
                manifestId,
                requestId,
                cancellationReview,
            ),
            cancellationReview.verdict === 'approved'
                ? 'Pembatalan disetujui dan reservasi dilepas'
                : 'Pembatalan ditolak',
        );
        if (ok) await openTransfer(manifestId);
    };

    const pendingCancellation = selectedTransfer?.cancellations?.find((request) => request.status === 'pending') || null;
    const transferCanAdvance = ['draft', 'handed_over'].includes(selectedTransfer?.status);

    if (loading) return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

    return (
        <div className="space-y-6">
            <div>
                <h1 className="flex items-center gap-2 text-2xl font-bold"><Scale className="h-6 w-6 text-violet-600" /> Tata Kelola Retensi</h1>
                <p className="text-sm text-muted-foreground">Appraisal manusia, verifikasi pemicu retensi, keputusan per komponen, dan penyerahan arsip permanen.</p>
            </div>

            <Alert>
                <ShieldCheck className="h-4 w-4" />
                <AlertTitle>Tidak ada keputusan otomatis</AlertTitle>
                <AlertDescription>Musnah hanya berarti layak diajukan. Persetujuan, legal hold, bukti peristiwa, dan pengecualian komponen tetap ditelaah petugas berbeda.{!canOperate && ' Anda berada dalam mode audit baca-saja.'}</AlertDescription>
            </Alert>

            {loadErrors.length > 0 && (
                <Alert variant="destructive">
                    <AlertTitle>Sebagian data tata kelola tidak dapat dimuat</AlertTitle>
                    <AlertDescription>{loadErrors.join(' · ')}</AlertDescription>
                </Alert>
            )}

            <Tabs value={tab} onValueChange={setTab}>
                <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="appraisals">Appraisal ({counters.appraisal})</TabsTrigger>
                    <TabsTrigger value="events">Pemicu Retensi ({counters.events})</TabsTrigger>
                    <TabsTrigger value="transfers">Penyerahan Permanen ({counters.transfers})</TabsTrigger>
                </TabsList>

                <TabsContent value="appraisals" className="space-y-4">
                    <Card>
                        <CardHeader className="flex-row items-start justify-between gap-4">
                            <div><CardTitle>Kasus Dinilai Kembali</CardTitle><CardDescription>Assessor dan reviewer wajib berbeda.</CardDescription></div>
                            <div className="flex gap-2">
                                <Select value={appraisalStatus} onValueChange={(value) => { setAppraisalStatus(value); setAppraisalPage(1); }}>
                                    <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                                    <SelectContent><SelectItem value="all">Semua status</SelectItem><SelectItem value="open">Draft</SelectItem><SelectItem value="in_review">Menunggu telaah</SelectItem><SelectItem value="approved">Disetujui</SelectItem><SelectItem value="rejected">Ditolak</SelectItem></SelectContent>
                                </Select>
                                {canOperate && <Button onClick={() => setAppraisalOpen(true)}><Plus className="mr-2 h-4 w-4" />Buat appraisal</Button>}
                            </div>
                        </CardHeader>
                        <CardContent className="px-0 sm:px-6">
                            <Table responsive><TableHeader><TableRow><TableHead>Arsip</TableHead><TableHead>Jenis</TableHead><TableHead>Usulan</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Tindakan</TableHead></TableRow></TableHeader>
                                <TableBody>{appraisals.map((item) => <TableRow key={item.id}><TableCell data-label="Arsip"><Link className="font-mono text-xs text-primary hover:underline" to={`/arsip/detail/${item.arsipId}`}>{shortId(item.arsipId)}</Link></TableCell><TableCell data-label="Jenis">{item.caseType}</TableCell><TableCell data-label="Usulan"><OutcomeBadge value={item.proposedOutcome} /></TableCell><TableCell data-label="Status"><Badge>{STATUS_LABELS[item.status] || item.status}</Badge></TableCell><TableCell data-label="Tindakan" className="text-right"><Button size="sm" variant="outline" onClick={() => openAppraisal(item.id)}>Telaah</Button></TableCell></TableRow>)}</TableBody>
                            </Table>
                            <PaginationControls pagination={appraisalPagination} onPageChange={setAppraisalPage} />
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="events" className="space-y-4">
                    <Card><CardHeader className="flex-row items-start justify-between gap-4"><div><CardTitle>Verifikasi Peristiwa Retensi</CardTitle><CardDescription>Retensi baru dihitung setelah bukti peristiwa disahkan reviewer berbeda.</CardDescription></div><div className="flex gap-2"><Select value={eventStatus} onValueChange={(value) => { setEventStatus(value); setEventPage(1); }}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pending">Menunggu</SelectItem><SelectItem value="verified">Terverifikasi</SelectItem><SelectItem value="rejected">Ditolak</SelectItem></SelectContent></Select>{canOperate && <Button onClick={() => { setEventForm(EMPTY_EVENT); setEventOpen(true); }}><Plus className="mr-2 h-4 w-4" />Catat peristiwa</Button>}</div></CardHeader>
                        <CardContent className="px-0 sm:px-6">
                            <Table responsive><TableHeader><TableRow><TableHead>Arsip</TableHead><TableHead>Peristiwa</TableHead><TableHead>Tanggal</TableHead><TableHead>Revisi</TableHead><TableHead className="text-right">Tindakan</TableHead></TableRow></TableHeader><TableBody>{events.map((entry) => { const event = entry.event || entry; const selfReview = event.actorId === user?.id; return <TableRow key={event.id}><TableCell data-label="Arsip"><Link className="font-mono text-xs text-primary hover:underline" to={`/arsip/detail/${event.arsipId}`}>{event.nomorBerkas || shortId(event.arsipId)}</Link></TableCell><TableCell data-label="Peristiwa">{event.label || event.eventType}{event.verdict && <Badge variant="outline" className="ml-2">{event.verdict === 'verified' ? 'Sah' : 'Ditolak'}</Badge>}</TableCell><TableCell data-label="Tanggal">{event.eventDate}</TableCell><TableCell data-label="Revisi">{event.revision}</TableCell><TableCell data-label="Tindakan" className="text-right"><div className="flex flex-wrap justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => openEventHistory(entry)}><History className="mr-1 h-4 w-4" />Riwayat</Button>{canOperate && <Button size="sm" variant="outline" onClick={() => openEventCorrection(entry)}>Koreksi</Button>}{canOperate && !event.verdict && <Button size="sm" variant="outline" disabled={selfReview} title={selfReview ? 'Pencatat harus diverifikasi petugas lain' : 'Periksa bukti'} onClick={() => setVerifyEvent(entry)}>Verifikasi</Button>}</div></TableCell></TableRow>; })}</TableBody></Table>
                            <PaginationControls pagination={eventPagination} onPageChange={setEventPage} />
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="transfers" className="space-y-4">
                    <Card><CardHeader className="flex-row items-start justify-between"><div><CardTitle>Manifest Penyerahan Permanen</CardTitle><CardDescription>Checksum, serah terima, dan bukti penerimaan tersimpan sebagai peristiwa append-only.</CardDescription></div>{canOperate && <Button onClick={openNewTransfer}><Plus className="mr-2 h-4 w-4" />Buat manifest</Button>}</CardHeader>
                        <CardContent className="px-0 sm:px-6">
                            <Table responsive><TableHeader><TableRow><TableHead>Nomor</TableHead><TableHead>Tujuan</TableHead><TableHead>Jumlah</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Tindakan</TableHead></TableRow></TableHeader><TableBody>{transfers.map((item) => <TableRow key={item.id}><TableCell data-label="Nomor" className="font-medium">{item.manifestNumber}</TableCell><TableCell data-label="Tujuan">{item.destination}</TableCell><TableCell data-label="Jumlah">{item.archiveCount ?? item.items?.length ?? 0}</TableCell><TableCell data-label="Status"><Badge variant="outline">{STATUS_LABELS[item.status] || item.status}</Badge></TableCell><TableCell data-label="Tindakan" className="text-right"><Button size="sm" variant="outline" onClick={() => openTransfer(item.id)}>Detail</Button></TableCell></TableRow>)}</TableBody></Table>
                            <PaginationControls pagination={transferPagination} onPageChange={setTransferPage} />
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            <Dialog open={appraisalOpen} onOpenChange={setAppraisalOpen}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Buat kasus appraisal</DialogTitle><DialogDescription>Gunakan untuk JRA manual, Dinilai Kembali, atau pengecualian komponen.</DialogDescription></DialogHeader><div className="grid gap-4 py-4">
                <ArchivePicker
                    value={appraisalForm.arsipId}
                    onChange={(arsipId) => {
                        setAppraisalArchive(null);
                        setAppraisalForm({ ...appraisalForm, arsipId, itemDecisions: [] });
                    }}
                    onSelect={setAppraisalArchive}
                    label="Berkas arsip yang dinilai"
                />
                <Label>Jenis kasus<Select value={appraisalForm.caseType} onValueChange={(value) => setAppraisalForm({ ...appraisalForm, caseType: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="jra_manual">JRA manual</SelectItem><SelectItem value="dinilai_kembali">Dinilai Kembali</SelectItem><SelectItem value="conditional_exception">Pengecualian komponen</SelectItem></SelectContent></Select></Label>
                <Label>Alasan<Textarea value={appraisalForm.reason} onChange={(e) => setAppraisalForm({ ...appraisalForm, reason: e.target.value })} /></Label>
                <Label>Usulan hasil<Select value={appraisalForm.proposedOutcome} onValueChange={(value) => setAppraisalForm({ ...appraisalForm, proposedOutcome: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="musnah">Musnah</SelectItem><SelectItem value="permanen">Permanen</SelectItem><SelectItem value="dinilai_kembali">Dinilai Kembali</SelectItem></SelectContent></Select></Label>
                <Label>Pertimbangan<Textarea value={appraisalForm.proposedRationale} onChange={(e) => setAppraisalForm({ ...appraisalForm, proposedRationale: e.target.value })} /></Label>
                <div className="space-y-2"><div className="flex items-center justify-between"><div><Label>Keputusan komponen (opsional)</Label><p className="text-xs text-muted-foreground">Gunakan hanya jika hasil komponen berbeda dari keputusan berkas.</p></div><Button type="button" size="sm" variant="outline" disabled={!appraisalForm.arsipId} onClick={() => setAppraisalForm({ ...appraisalForm, itemDecisions: [...appraisalForm.itemDecisions, { arsipItemId: '', outcome: 'permanen', basis: '' }] })}>Tambah komponen</Button></div>{appraisalForm.itemDecisions.map((item, index) => <div key={index} className="grid gap-2 rounded border p-3 sm:grid-cols-[1fr_150px_auto]">{appraisalArchive?.items?.length ? <Select value={item.arsipItemId} onValueChange={(value) => { const next = [...appraisalForm.itemDecisions]; next[index] = { ...item, arsipItemId: value }; setAppraisalForm({ ...appraisalForm, itemDecisions: next }); }}><SelectTrigger><SelectValue placeholder="Pilih komponen" /></SelectTrigger><SelectContent>{appraisalArchive.items.map((archiveItem) => <SelectItem key={archiveItem.id} value={archiveItem.id}>{archiveItem.nomorItem || 'Tanpa nomor'} — {archiveItem.uraianItem || 'Tanpa uraian'}</SelectItem>)}</SelectContent></Select> : <Input placeholder="UUID komponen" value={item.arsipItemId} onChange={(e) => { const next = [...appraisalForm.itemDecisions]; next[index] = { ...item, arsipItemId: e.target.value }; setAppraisalForm({ ...appraisalForm, itemDecisions: next }); }} />}<Select value={item.outcome} onValueChange={(value) => { const next = [...appraisalForm.itemDecisions]; next[index] = { ...item, outcome: value }; setAppraisalForm({ ...appraisalForm, itemDecisions: next }); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="musnah">Musnah</SelectItem><SelectItem value="permanen">Permanen</SelectItem><SelectItem value="dinilai_kembali">Dinilai Kembali</SelectItem></SelectContent></Select><Button type="button" size="icon" variant="ghost" onClick={() => setAppraisalForm({ ...appraisalForm, itemDecisions: appraisalForm.itemDecisions.filter((_, i) => i !== index) })}><Trash2 className="h-4 w-4" /></Button><Textarea className="sm:col-span-3" placeholder="Dasar keputusan komponen (minimal 10 karakter)" value={item.basis} onChange={(e) => { const next = [...appraisalForm.itemDecisions]; next[index] = { ...item, basis: e.target.value }; setAppraisalForm({ ...appraisalForm, itemDecisions: next }); }} /></div>)}</div>
            </div><DialogFooter><Button variant="outline" onClick={() => setAppraisalOpen(false)}>Batal</Button><Button disabled={saving} onClick={createAppraisal}>Simpan kasus</Button></DialogFooter></DialogContent></Dialog>

            <Dialog open={Boolean(selectedAppraisal)} onOpenChange={(open) => !open && setSelectedAppraisal(null)}>
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Appraisal {shortId(selectedAppraisal?.id)}</DialogTitle>
                        <DialogDescription>Status: {STATUS_LABELS[selectedAppraisal?.status] || selectedAppraisal?.status}</DialogDescription>
                    </DialogHeader>
                    {selectedAppraisal && (
                        <div className="space-y-4">
                            <div className="rounded border p-3 text-sm">
                                <p><b>Arsip:</b> <Link className="text-primary underline" to={`/arsip/detail/${selectedAppraisal.arsipId}`}>{selectedAppraisal.arsipId}</Link></p>
                                <p><b>Alasan:</b> {selectedAppraisal.reason}</p>
                                <p><b>Usulan:</b> <OutcomeBadge value={selectedAppraisal.proposedOutcome} /></p>
                                <p><b>Pertimbangan:</b> {selectedAppraisal.proposedRationale}</p>
                                <p className="mt-2 text-xs text-muted-foreground">Assessor: {selectedAppraisal.assessorId} · dibuat {formatTimestamp(selectedAppraisal.createdAt)}</p>
                                {selectedAppraisal.submittedAt && <p className="text-xs text-muted-foreground">Diajukan: {formatTimestamp(selectedAppraisal.submittedAt)}</p>}
                                {selectedAppraisal.submissionSha256 && <p className="mt-2 break-all font-mono text-[11px] text-muted-foreground">Hash pengajuan: {selectedAppraisal.submissionSha256}</p>}
                                {selectedAppraisal.reviewerId && <p className="mt-2 text-xs text-muted-foreground">Reviewer: {selectedAppraisal.reviewerId} · ditelaah {formatTimestamp(selectedAppraisal.reviewedAt)}</p>}
                                {selectedAppraisal.reviewReason && <p className="mt-1"><b>Alasan reviewer:</b> {selectedAppraisal.reviewReason}</p>}
                            </div>

                            <div className="space-y-2">
                                <h3 className="font-semibold">Bukti pendukung ({selectedAppraisal.evidence?.length || 0})</h3>
                                {selectedAppraisal.evidence?.length ? selectedAppraisal.evidence.map((evidence) => (
                                    <div key={evidence.id} className="rounded border p-3 text-sm">
                                        <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{evidence.label}</span><Badge variant="outline">{evidence.mediaType || 'bukti'}</Badge></div>
                                        <p className="mt-2"><EvidenceLocator uri={evidence.evidenceUri} /></p>
                                        <p className="mt-2 break-all font-mono text-[11px] text-muted-foreground">SHA-256: {evidence.evidenceSha256}</p>
                                    </div>
                                )) : <p className="rounded border border-dashed p-3 text-sm text-muted-foreground">Belum ada bukti pendukung.</p>}
                            </div>

                            <div className="space-y-2">
                                <h3 className="font-semibold">Usulan keputusan komponen ({selectedAppraisal.proposedItemDecisions?.length || 0})</h3>
                                {selectedAppraisal.proposedItemDecisions?.length ? selectedAppraisal.proposedItemDecisions.map((item) => (
                                    <div key={item.arsipItemId} className="rounded border p-3 text-sm">
                                        <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-xs">{item.arsipItemId}</span><OutcomeBadge value={item.outcome} /></div>
                                        <p className="mt-2">{item.basis}</p>
                                    </div>
                                )) : <p className="text-sm text-muted-foreground">Tidak ada pengecualian; hasil berkas berlaku untuk seluruh komponen.</p>}
                            </div>

                            <div className="space-y-2">
                                <h3 className="font-semibold">Keputusan final ({selectedAppraisal.decisions?.length || 0})</h3>
                                {selectedAppraisal.decisions?.length ? selectedAppraisal.decisions.map((decision) => {
                                    const itemDecisions = (selectedAppraisal.itemDecisions || []).filter((item) => item.decisionId === decision.id);
                                    return (
                                        <div key={decision.id} className="space-y-3 rounded border p-3 text-sm">
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <Badge variant={decision.decisionStatus === 'approved' ? 'success' : 'danger'}>{decision.decisionStatus === 'approved' ? 'Disetujui' : 'Ditolak'}</Badge>
                                                    {decision.outcome && <OutcomeBadge value={decision.outcome} />}
                                                </div>
                                                <span className="text-xs text-muted-foreground">{formatTimestamp(decision.createdAt)}</span>
                                            </div>
                                            <p><b>Dasar keputusan:</b> {decision.rationale}</p>
                                            <p className="text-xs text-muted-foreground">Assessor: {decision.assessorId} · Reviewer: {decision.reviewerId}</p>
                                            <p className="break-all rounded bg-muted p-2 font-mono text-[11px]">SHA-256 keputusan: {decision.decisionSha256}</p>
                                            <div className="space-y-2 border-t pt-3">
                                                <p className="font-medium">Keputusan final per komponen ({itemDecisions.length})</p>
                                                {itemDecisions.length ? itemDecisions.map((item) => (
                                                    <div key={item.id} className="rounded border bg-muted/30 p-3">
                                                        <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-xs">{item.arsipItemId}</span><OutcomeBadge value={item.outcome} /></div>
                                                        <p className="mt-2">{item.basis}</p>
                                                        <p className="mt-2 break-all font-mono text-[11px] text-muted-foreground">SHA-256: {item.decisionSha256}</p>
                                                    </div>
                                                )) : <p className="text-xs text-muted-foreground">Tidak ada keputusan komponen terpisah; keputusan berkas berlaku untuk seluruh komponen.</p>}
                                            </div>
                                        </div>
                                    );
                                }) : <p className="rounded border border-dashed p-3 text-sm text-muted-foreground">Keputusan final belum diterbitkan.</p>}
                            </div>

                            {selectedAppraisal.status === 'open' && selectedAppraisal.assessorId === user?.id && (
                                <div className="grid gap-2 rounded border p-3">
                                    <Label>Tambahkan bukti pendukung</Label>
                                    <Input placeholder="Label bukti" value={evidenceForm.label} onChange={(e) => setEvidenceForm({ ...evidenceForm, label: e.target.value })} />
                                    <Input placeholder="https://, urn:, atau attachment:" value={evidenceForm.evidenceUri} onChange={(e) => setEvidenceForm({ ...evidenceForm, evidenceUri: e.target.value })} />
                                    <Input className="font-mono text-xs" placeholder="SHA-256" value={evidenceForm.evidenceSha256} onChange={(e) => setEvidenceForm({ ...evidenceForm, evidenceSha256: e.target.value })} />
                                    <Button variant="outline" onClick={addEvidence}>Tambahkan bukti</Button>
                                </div>
                            )}
                            {selectedAppraisal.status === 'open' && selectedAppraisal.assessorId !== user?.id && (
                                <Alert><AlertTitle>Mode baca</AlertTitle><AlertDescription>Hanya assessor pembuat kasus yang dapat menambah bukti dan mengajukan appraisal ini.</AlertDescription></Alert>
                            )}

                            {selectedAppraisal.status === 'in_review' && canOperate && (
                                <div className="grid gap-2 rounded border p-3">
                                    {selectedAppraisal.assessorId === user?.id && (
                                        <Alert variant="destructive"><AlertTitle>Pemisahan tugas</AlertTitle><AlertDescription>Assessor tidak boleh menelaah appraisal yang dibuatnya sendiri.</AlertDescription></Alert>
                                    )}
                                    <Select value={reviewMode} onValueChange={setReviewMode}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="approve">Setujui</SelectItem><SelectItem value="reject">Tolak</SelectItem></SelectContent></Select>
                                    <Textarea placeholder="Alasan keputusan reviewer (minimal 10 karakter)" value={reviewReason} onChange={(e) => setReviewReason(e.target.value)} />
                                    <Button onClick={finalizeAppraisal} disabled={saving || reviewReason.trim().length < 10 || selectedAppraisal.assessorId === user?.id}>{reviewMode === 'approve' ? 'Setujui appraisal' : 'Tolak appraisal'}</Button>
                                </div>
                            )}
                        </div>
                    )}
                    <DialogFooter>
                        {selectedAppraisal?.status === 'open' && selectedAppraisal.assessorId === user?.id && <Button onClick={submitAppraisal} disabled={saving || !selectedAppraisal.evidence?.length}><ClipboardCheck className="mr-2 h-4 w-4" />Ajukan untuk telaah</Button>}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={eventOpen} onOpenChange={(open) => { setEventOpen(open); if (!open) setEventForm(EMPTY_EVENT); }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{eventForm.correctsEventId ? 'Koreksi peristiwa retensi' : 'Catat peristiwa retensi'}</DialogTitle>
                        <DialogDescription>Peristiwa belum memulai perhitungan sebelum diverifikasi petugas berbeda. Revisi lama tetap disimpan sebagai bukti.</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-3 py-4">
                        <ArchivePicker value={eventForm.arsipId} onChange={(arsipId) => setEventForm({ ...eventForm, arsipId })} label="Berkas arsip" />
                        <Label>Jenis<Select value={eventForm.eventType} onValueChange={(value) => setEventForm({ ...eventForm, eventType: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="kegiatan_selesai">Kegiatan selesai</SelectItem><SelectItem value="berkas_ditutup">Berkas ditutup</SelectItem><SelectItem value="serah_terima">Serah terima</SelectItem><SelectItem value="penetapan">Penetapan</SelectItem><SelectItem value="lainnya">Lainnya</SelectItem></SelectContent></Select></Label>
                        <Label>Tanggal<Input type="date" value={eventForm.eventDate} onChange={(e) => setEventForm({ ...eventForm, eventDate: e.target.value })} /></Label>
                        <Label>Label<Input value={eventForm.label} onChange={(e) => setEventForm({ ...eventForm, label: e.target.value })} /></Label>
                        <Label>Lokator bukti<Input value={eventForm.evidenceUri} onChange={(e) => setEventForm({ ...eventForm, evidenceUri: e.target.value })} placeholder="https://, urn:, atau attachment:" /></Label>
                        <Label>SHA-256<Input className="font-mono text-xs" value={eventForm.evidenceSha256} onChange={(e) => setEventForm({ ...eventForm, evidenceSha256: e.target.value })} /></Label>
                        {eventForm.correctsEventId && <Label>Alasan koreksi<Textarea minLength={10} value={eventForm.correctionReason || ''} onChange={(e) => setEventForm({ ...eventForm, correctionReason: e.target.value })} placeholder="Jelaskan kesalahan pada revisi sebelumnya." /></Label>}
                    </div>
                    <DialogFooter><Button variant="outline" onClick={() => setEventOpen(false)}>Batal</Button><Button disabled={saving || Boolean(eventForm.correctsEventId && (eventForm.correctionReason || '').trim().length < 10)} onClick={createEvent}>{eventForm.correctsEventId ? 'Simpan koreksi' : 'Simpan'}</Button></DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={Boolean(verifyEvent)} onOpenChange={(open) => !open && setVerifyEvent(null)}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Verifikasi bukti pemicu</DialogTitle><DialogDescription>Periksa dokumen dan checksum sebelum memberi keputusan.</DialogDescription></DialogHeader>
                    {verifyEvent && (() => {
                        const event = verifyEvent.event || verifyEvent;
                        return <div className="space-y-3 rounded border p-3 text-sm"><p><b>{event.label}</b> · {event.eventDate} · revisi {event.revision}</p><p><EvidenceLocator uri={event.evidenceUri} /></p><p className="break-all font-mono text-[11px] text-muted-foreground">SHA-256: {event.evidenceSha256}</p><p className="text-xs text-muted-foreground">Pencatat: {event.actorId}</p>{event.correctionReason && <p><b>Alasan koreksi:</b> {event.correctionReason}</p>}</div>;
                    })()}
                    <div className="grid gap-3 py-4"><Select value={verification.verdict} onValueChange={(value) => setVerification({ ...verification, verdict: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="verified">Bukti sah</SelectItem><SelectItem value="rejected">Tolak bukti</SelectItem></SelectContent></Select><Textarea minLength={10} placeholder="Catatan verifikasi (minimal 10 karakter)" value={verification.note} onChange={(e) => setVerification({ ...verification, note: e.target.value })} /></div>
                    <DialogFooter><Button disabled={saving || verification.note.trim().length < 10 || (verifyEvent?.event || verifyEvent)?.actorId === user?.id} onClick={verifySelectedEvent}><FileCheck2 className="mr-2 h-4 w-4" />Simpan verifikasi</Button></DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={Boolean(eventHistoryArchive)} onOpenChange={(open) => !open && setEventHistoryArchive(null)}>
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
                    <DialogHeader>
                        <DialogTitle>Riwayat pemicu retensi · {eventHistoryArchive?.label}</DialogTitle>
                        <DialogDescription>Semua revisi dipertahankan bersama bukti, checksum, pencatat, dan hasil verifikasinya.</DialogDescription>
                    </DialogHeader>
                    {eventHistoryLoading ? (
                        <div className="flex min-h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
                    ) : eventHistoryError ? (
                        <Alert variant="destructive"><AlertTitle>Riwayat tidak dapat dimuat</AlertTitle><AlertDescription>{eventHistoryError}</AlertDescription></Alert>
                    ) : eventHistoryRows.length === 0 ? (
                        <p className="rounded border border-dashed p-6 text-center text-sm text-muted-foreground">Belum ada peristiwa retensi untuk arsip ini.</p>
                    ) : (
                        <div className="space-y-3">
                            {eventHistoryRows.map((entry) => {
                                const event = entry.event || entry;
                                const eventVerification = entry.verification || null;
                                const currentEventId = eventHistoryCurrent?.event?.id || eventHistoryCurrent?.id;
                                const isCurrent = event.id === currentEventId;
                                return (
                                    <div key={event.id} className={`rounded border p-4 text-sm ${isCurrent ? 'border-success/50 bg-success/5' : ''}`}>
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <Badge variant="outline">Revisi {event.revision}</Badge>
                                                <span className="font-semibold">{event.label || event.eventType}</span>
                                                {isCurrent && <Badge variant="success">Pemicu aktif</Badge>}
                                            </div>
                                            <Badge variant={eventVerification?.verdict === 'verified' ? 'success' : eventVerification?.verdict === 'rejected' ? 'danger' : 'muted'}>
                                                {eventVerification?.verdict === 'verified' ? 'Bukti sah' : eventVerification?.verdict === 'rejected' ? 'Bukti ditolak' : 'Menunggu verifikasi'}
                                            </Badge>
                                        </div>
                                        <div className="mt-3 grid gap-1 sm:grid-cols-2">
                                            <p><b>Tanggal peristiwa:</b> {event.eventDate}</p>
                                            <p><b>Dicatat:</b> {formatTimestamp(event.createdAt)}</p>
                                            <p className="sm:col-span-2"><b>Pencatat:</b> <span className="font-mono text-xs">{event.actorId}</span></p>
                                        </div>
                                        <div className="mt-3 rounded bg-muted p-3">
                                            <p><EvidenceLocator uri={event.evidenceUri} /></p>
                                            <p className="mt-2 break-all font-mono text-[11px] text-muted-foreground">SHA-256 bukti: {event.evidenceSha256}</p>
                                        </div>
                                        {event.correctsEventId && <p className="mt-3 text-xs text-muted-foreground">Mengoreksi peristiwa {event.correctsEventId}</p>}
                                        {event.correctionReason && <p className="mt-1"><b>Alasan koreksi:</b> {event.correctionReason}</p>}
                                        {eventVerification && (
                                            <div className="mt-3 border-t pt-3">
                                                <p><b>Catatan verifikasi:</b> {eventVerification.note}</p>
                                                <p className="mt-1 text-xs text-muted-foreground">Verifier: {eventVerification.verifierId} · {formatTimestamp(eventVerification.verifiedAt)}</p>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    <DialogFooter><Button variant="outline" onClick={() => setEventHistoryArchive(null)}>Tutup</Button></DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Buat manifest penyerahan</DialogTitle>
                        <DialogDescription>Hanya arsip dengan keputusan appraisal Permanen efektif dan objek digital yang sudah bersih serta lolos fixity.</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-3 py-4">
                        {transferForm.supersedesManifestId && (
                            <Alert>
                                <History className="h-4 w-4" />
                                <AlertTitle>Manifest pengganti</AlertTitle>
                                <AlertDescription>
                                    Manifest baru ini menautkan riwayat pembatalan {shortId(transferForm.supersedesManifestId)}. Periksa ulang arsip, keputusan appraisal, dan bukti objek sebelum menyimpan.
                                </AlertDescription>
                            </Alert>
                        )}
                        <Label>Nomor manifest<Input value={transferForm.manifestNumber} onChange={(e) => setTransferForm({ ...transferForm, manifestNumber: e.target.value })} /></Label>
                        <Label>Tujuan<Input value={transferForm.destination} onChange={(e) => setTransferForm({ ...transferForm, destination: e.target.value })} /></Label>
                        <Label>Keterangan<Textarea value={transferForm.description} onChange={(e) => setTransferForm({ ...transferForm, description: e.target.value })} /></Label>
                        {transferForm.items.map((item, index) => (
                            <div key={index} className="grid gap-2 rounded border p-3">
                                <ArchivePicker
                                    value={item.arsipId}
                                    onChange={(arsipId) => {
                                        const items = [...transferForm.items];
                                        items[index] = { ...item, arsipId, appraisalDecisionId: '', objectUri: '', objectSha256: '' };
                                        setTransferForm({ ...transferForm, items });
                                    }}
                                    label={`Arsip ${index + 1}`}
                                />
                                <PermanentDecisionPicker
                                    arsipId={item.arsipId}
                                    value={item.appraisalDecisionId}
                                    onChange={(appraisalDecisionId) => {
                                        const items = [...transferForm.items];
                                        items[index] = { ...item, appraisalDecisionId };
                                        setTransferForm({ ...transferForm, items });
                                    }}
                                />
                                <VerifiedAttachmentPicker
                                    archiveIds={[item.arsipId]}
                                    value={item.objectUri.startsWith('attachment:') ? item.objectUri.slice(11) : ''}
                                    label="Objek arsip digital terverifikasi"
                                    onChange={(attachment) => {
                                        const items = [...transferForm.items];
                                        items[index] = { ...item, objectUri: attachment.uri, objectSha256: attachment.sha256 };
                                        setTransferForm({ ...transferForm, items });
                                    }}
                                />
                                {item.objectSha256 && <p className="break-all font-mono text-[11px] text-muted-foreground">SHA-256: {item.objectSha256}</p>}
                                {transferForm.items.length > 1 && <Button type="button" variant="ghost" onClick={() => setTransferForm({ ...transferForm, items: transferForm.items.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 className="mr-2 h-4 w-4" />Hapus baris</Button>}
                            </div>
                        ))}
                        <Button type="button" variant="outline" onClick={() => setTransferForm({ ...transferForm, items: [...transferForm.items, { arsipId: '', appraisalDecisionId: '', objectUri: '', objectSha256: '' }] })}><Plus className="mr-2 h-4 w-4" />Tambah arsip</Button>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setTransferOpen(false)}>Batal</Button>
                        <Button
                            disabled={saving || transferForm.items.some((item) => !item.arsipId || !item.appraisalDecisionId || !item.objectUri || !item.objectSha256)}
                            onClick={createTransfer}
                        >Buat manifest</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={Boolean(selectedTransfer)} onOpenChange={(open) => !open && setSelectedTransfer(null)}>
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                    <DialogHeader><DialogTitle>Manifest {selectedTransfer?.manifestNumber}</DialogTitle><DialogDescription>{selectedTransfer?.destination} · {STATUS_LABELS[selectedTransfer?.status] || selectedTransfer?.status}</DialogDescription></DialogHeader>
                    {selectedTransfer && (
                        <div className="space-y-4 py-2">
                            <div className="space-y-2">
                                <h3 className="font-semibold">Daftar arsip dan checksum ({selectedTransfer.items?.length || 0})</h3>
                                {selectedTransfer.items?.map((item) => <div key={item.id} className="rounded border p-3 text-sm"><Link className="text-primary underline" to={`/arsip/detail/${item.arsipId}`}>Arsip {shortId(item.arsipId)}</Link><p className="mt-1"><EvidenceLocator uri={item.objectUri} /></p><p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">SHA-256: {item.objectSha256}</p><p className="mt-1 font-mono text-[11px] text-muted-foreground">Keputusan: {item.appraisalDecisionId}</p></div>)}
                            </div>
                            <div className="space-y-2">
                                <h3 className="font-semibold">Riwayat serah terima ({selectedTransfer.events?.length || 0})</h3>
                                {selectedTransfer.events?.length ? selectedTransfer.events.map((event) => <div key={event.id} className="rounded border p-3 text-sm"><div className="flex items-center justify-between gap-2"><Badge variant="outline">{event.eventType === 'handover' ? 'Serah terima' : 'Penerimaan'}</Badge><span className="text-xs text-muted-foreground">{new Date(event.eventAt).toLocaleString('id-ID')}</span></div><p className="mt-2">{event.referenceNumber} · {event.counterparty}</p><p className="mt-1"><EvidenceLocator uri={event.documentUri} /></p><p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">SHA-256: {event.documentSha256}</p></div>) : <p className="text-sm text-muted-foreground">Belum ada peristiwa serah terima.</p>}
                            </div>
                            <div className="space-y-2">
                                <h3 className="font-semibold">Riwayat pembatalan ({selectedTransfer.cancellations?.length || 0})</h3>
                                {selectedTransfer.cancellations?.length ? selectedTransfer.cancellations.map((request) => (
                                    <div key={request.id} className="rounded border p-3 text-sm">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <Badge variant={request.status === 'approved' ? 'danger' : request.status === 'rejected' ? 'muted' : 'warning'}>{request.status === 'approved' ? 'Disetujui' : request.status === 'rejected' ? 'Ditolak' : 'Menunggu telaah'}</Badge>
                                            <span className="text-xs text-muted-foreground">{formatTimestamp(request.requestedAt)}</span>
                                        </div>
                                        <p className="mt-2"><b>Alasan:</b> {request.reason}</p>
                                        <p className="mt-1 font-mono text-[11px] text-muted-foreground">Pemohon: {request.requestedBy}</p>
                                        {request.reviewNote && <p className="mt-2"><b>Catatan reviewer:</b> {request.reviewNote}</p>}
                                        {request.reviewedBy && <p className="mt-1 font-mono text-[11px] text-muted-foreground">Reviewer: {request.reviewedBy} · {formatTimestamp(request.reviewedAt)}</p>}
                                    </div>
                                )) : <p className="text-sm text-muted-foreground">Belum ada permintaan pembatalan.</p>}
                            </div>
                            {canOperate && selectedTransfer.status === 'draft' && (
                                <div className="grid gap-3 rounded border border-amber-300 p-3">
                                    <Alert><Trash2 className="h-4 w-4" /><AlertTitle>Ajukan pembatalan manifest</AlertTitle><AlertDescription>Pembatalan hanya tersedia sebelum serah terima dan harus disetujui pejabat berbeda. Riwayat manifest tetap dipertahankan.</AlertDescription></Alert>
                                    <Textarea value={cancellationReason} onChange={(event) => setCancellationReason(event.target.value)} placeholder="Alasan pembatalan (minimal 20 karakter)" />
                                    <Button type="button" variant="outline" disabled={saving || cancellationReason.trim().length < 20} onClick={requestTransferCancellation}>Ajukan pembatalan</Button>
                                </div>
                            )}
                            {canOperate && pendingCancellation && (
                                <div className="grid gap-3 rounded border border-amber-300 p-3">
                                    <Alert><ShieldCheck className="h-4 w-4" /><AlertTitle>Telaah pembatalan</AlertTitle><AlertDescription>Reviewer harus berbeda dari pemohon. Persetujuan melepaskan reservasi arsip sehingga manifest pengganti dapat dibuat.</AlertDescription></Alert>
                                    {pendingCancellation.requestedBy === user?.id ? (
                                        <p className="text-sm text-muted-foreground">Anda adalah pemohon. Minta pejabat lain menelaah permintaan ini.</p>
                                    ) : (
                                        <>
                                            <Select value={cancellationReview.verdict} onValueChange={(verdict) => setCancellationReview({ ...cancellationReview, verdict })}>
                                                <SelectTrigger><SelectValue /></SelectTrigger>
                                                <SelectContent><SelectItem value="approved">Setujui pembatalan</SelectItem><SelectItem value="rejected">Tolak pembatalan</SelectItem></SelectContent>
                                            </Select>
                                            <Textarea value={cancellationReview.note} onChange={(event) => setCancellationReview({ ...cancellationReview, note: event.target.value })} placeholder="Catatan penelaahan (minimal 10 karakter)" />
                                            <Button type="button" disabled={saving || cancellationReview.note.trim().length < 10} onClick={() => reviewTransferCancellation(pendingCancellation.id)}>Simpan keputusan pembatalan</Button>
                                        </>
                                    )}
                                </div>
                            )}
                            {transferCanAdvance && canOperate && (
                                <div className="grid gap-3 rounded border p-3">
                                    <Alert><ArchiveRestore className="h-4 w-4" /><AlertTitle>{transferEventMode === 'handover' ? 'Catat serah terima' : 'Catat bukti penerimaan'}</AlertTitle><AlertDescription>{transferEventMode === 'handover' ? 'Tahap berikutnya baru dapat dicatat setelah serah terima tersimpan.' : 'Penerimaan wajib dicatat pejabat berbeda dan akan memfinalkan arsip sebagai executed.'}</AlertDescription></Alert>
                                    <Label>Waktu<Input type="datetime-local" value={transferEvent.eventAt} onChange={(e) => setTransferEvent({ ...transferEvent, eventAt: e.target.value })} /></Label>
                                    <Input placeholder="Nomor referensi" value={transferEvent.referenceNumber} onChange={(e) => setTransferEvent({ ...transferEvent, referenceNumber: e.target.value })} />
                                    <Input placeholder="Pihak penerima" value={transferEvent.counterparty} onChange={(e) => setTransferEvent({ ...transferEvent, counterparty: e.target.value })} />
                                    <VerifiedAttachmentPicker
                                        archiveIds={selectedTransfer.items?.map((item) => item.arsipId) || []}
                                        value={transferEvent.documentAttachmentId}
                                        label={transferEventMode === 'handover' ? 'Berita acara terverifikasi' : 'Bukti penerimaan terverifikasi'}
                                        onChange={(attachment) => setTransferEvent({
                                            ...transferEvent,
                                            documentAttachmentId: attachment.attachmentId,
                                            documentUri: attachment.uri,
                                            documentSha256: attachment.sha256,
                                        })}
                                    />
                                    {transferEvent.documentSha256 && <p className="break-all font-mono text-[11px] text-muted-foreground">SHA-256: {transferEvent.documentSha256}</p>}
                                    <Textarea placeholder="Catatan" value={transferEvent.notes} onChange={(e) => setTransferEvent({ ...transferEvent, notes: e.target.value })} />
                                </div>
                            )}
                            {selectedTransfer.status === 'acknowledged' && <Alert><CheckCircle2 className="h-4 w-4 text-success" /><AlertTitle>Penyerahan selesai</AlertTitle><AlertDescription>Manifest, arsip, checksum, serah terima, dan bukti penerimaan telah lengkap dan bersifat append-only.</AlertDescription></Alert>}
                            {selectedTransfer.status === 'cancelled' && <Alert><Trash2 className="h-4 w-4" /><AlertTitle>Manifest dibatalkan</AlertTitle><AlertDescription>Reservasi arsip telah dilepas. Manifest dan bukti pembatalan tetap tersimpan untuk audit.</AlertDescription></Alert>}
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setSelectedTransfer(null)}>Tutup</Button>
                        {selectedTransfer?.status === 'cancelled' && canOperate && <Button variant="outline" onClick={openReplacementTransfer}><History className="mr-2 h-4 w-4" />Buat manifest pengganti</Button>}
                        {transferCanAdvance && canOperate && <Button disabled={saving || !transferEvent.eventAt || !transferEvent.referenceNumber.trim() || !transferEvent.counterparty.trim() || !transferEvent.documentAttachmentId || !/^[0-9a-fA-F]{64}$/.test(transferEvent.documentSha256)} onClick={recordTransferEvent}><ArchiveRestore className="mr-2 h-4 w-4" />Simpan peristiwa</Button>}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
