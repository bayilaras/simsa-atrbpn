import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/services/api';
import { Line, Bar } from 'react-chartjs-2';
import { AlertTriangle, Activity, CheckCircle2, Clock, FileWarning, GitCompareArrows, Scale, ShieldAlert } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const ISSUE_LABELS = {
    legacy_unverified: 'Legacy belum diverifikasi',
    pending_jra: 'JRA belum lengkap',
    missing_trigger_evidence: 'Pemicu/bukti kosong',
    manual_review: 'Dinilai Kembali',
    legal_hold: 'Legal hold',
    stale_rule_version: 'Versi aturan lama',
    due_within_90_days: 'Jatuh tempo ≤90 hari',
};

const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
        legend: {
            position: 'top',
            labels: {
                usePointStyle: true,
                boxWidth: 8,
                font: { size: 11, family: 'Inter' }
            }
        },
        tooltip: {
            backgroundColor: 'rgba(255, 255, 255, 0.9)',
            titleColor: '#1e293b',
            bodyColor: '#475569',
            borderColor: '#e2e8f0',
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8,
            displayColors: false,
        }
    },
    scales: {
        y: {
            beginAtZero: true,
            grid: { color: 'rgba(0, 0, 0, 0.05)', borderDash: [4, 4] },
            ticks: { font: { size: 10 }, color: '#94a3b8' }
        },
        x: {
            grid: { display: false },
            ticks: { font: { size: 10 }, color: '#94a3b8' }
        },
    },
    interaction: {
        mode: 'index',
        intersect: false,
    },
};

export default function DashboardPengawasan() {
    const [loading, setLoading] = useState(true);
    const [activityStats, setActivityStats] = useState([]);
    const [userStats, setUserStats] = useState([]);
    const [complianceStats, setComplianceStats] = useState(null);
    const [qualityIssues, setQualityIssues] = useState([]);
    const [daysRange, setDaysRange] = useState('7');

    const loadData = useCallback(async () => {
        try {
            setLoading(true);
            const [activityRes, userRes, complianceRes, issuesRes] = await Promise.all([
                api.get('/api/supervision/stats/activity', { days: daysRange }),
                api.get('/api/supervision/stats/users', { limit: '5' }),
                api.get('/api/supervision/stats/compliance'),
                api.get('/api/supervision/stats/compliance/issues', { limit: '50' }),
            ]);

            // Backend returns data directly (not wrapped in { data: ... })
            setActivityStats(Array.isArray(activityRes) ? activityRes : (activityRes?.data || []));
            setUserStats(Array.isArray(userRes) ? userRes : (userRes?.data || []));
            setComplianceStats(activityRes && typeof complianceRes === 'object' ? complianceRes : (complianceRes?.data || null));
            setQualityIssues(Array.isArray(issuesRes) ? issuesRes : (issuesRes?.data || []));
        } catch (error) {
            console.error('Failed to load supervision data:', error);
        } finally {
            setLoading(false);
        }
    }, [daysRange]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    if (loading) {
        return (
            <div className="flex justify-center items-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    // Prepare Chart Data
    const activityChartData = {
        labels: activityStats.map(s => s.date),
        datasets: [
            {
                label: 'Create',
                data: activityStats.map(s => s.create),
                borderColor: '#10b981', // emerald-500
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                tension: 0.3,
                pointBackgroundColor: '#fff',
                pointBorderColor: '#10b981',
            },
            {
                label: 'Update',
                data: activityStats.map(s => s.update),
                borderColor: '#3b82f6', // blue-500
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                tension: 0.3,
                pointBackgroundColor: '#fff',
                pointBorderColor: '#3b82f6',
            },
            {
                label: 'Delete',
                data: activityStats.map(s => s.delete),
                borderColor: '#ef4444', // red-500
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                tension: 0.3,
                pointBackgroundColor: '#fff',
                pointBorderColor: '#ef4444',
            },
        ]
    };

    const userChartData = {
        labels: userStats.map(u => u.userName),
        datasets: [{
            label: 'Total Aksi',
            data: userStats.map(u => u.actionCount),
            backgroundColor: '#8b5cf6', // violet-500
            borderRadius: 4,
        }]
    };

    const qualityCards = [
        {
            label: 'Kandidat Lewat Retensi',
            value: complianceStats?.overdueRetention || 0,
            description: 'Hanya JRA durasi terstruktur, Musnah, tanpa legal hold',
            Icon: AlertTriangle,
            border: 'border-l-red-500',
            icon: 'text-red-600 dark:text-red-400',
            iconBg: 'bg-red-100/50 dark:bg-red-500/10',
        },
        {
            label: 'Antrean Dinilai Kembali',
            value: complianceStats?.manualReviewBacklog || 0,
            description: `${complianceStats?.masterManualRules || 0} butir master memerlukan keputusan manusia`,
            Icon: Scale,
            border: 'border-l-violet-500',
            icon: 'text-violet-600 dark:text-violet-400',
            iconBg: 'bg-violet-100/50 dark:bg-violet-500/10',
        },
        {
            label: 'Pemicu/Bukti Belum Lengkap',
            value: complianceStats?.missingTriggerEvidence || 0,
            description: 'Tanggal jatuh tempo ditahan sampai bukti diverifikasi',
            Icon: FileWarning,
            border: 'border-l-amber-500',
            icon: 'text-amber-600 dark:text-amber-400',
            iconBg: 'bg-amber-100/50 dark:bg-amber-500/10',
        },
        {
            label: 'Data Legacy Belum Rekonsiliasi',
            value: complianceStats?.legacyUnverified || 0,
            description: 'Tidak dapat masuk proses penyusutan',
            Icon: ShieldAlert,
            border: 'border-l-orange-500',
            icon: 'text-orange-600 dark:text-orange-400',
            iconBg: 'bg-orange-100/50 dark:bg-orange-500/10',
        },
        {
            label: 'JRA Belum Dipilih',
            value: complianceStats?.pendingJra || 0,
            description: 'Pasangan klasifikasi–JRA belum lengkap',
            Icon: Clock,
            border: 'border-l-yellow-500',
            icon: 'text-yellow-600 dark:text-yellow-400',
            iconBg: 'bg-yellow-100/50 dark:bg-yellow-500/10',
        },
        {
            label: 'Menggunakan Versi Lama',
            value: complianceStats?.staleRuleVersion || 0,
            description: 'Perlu telaah dampak; snapshot tidak diubah otomatis',
            Icon: GitCompareArrows,
            border: 'border-l-blue-500',
            icon: 'text-blue-600 dark:text-blue-400',
            iconBg: 'bg-blue-100/50 dark:bg-blue-500/10',
        },
        {
            label: 'Legal Hold Aktif',
            value: complianceStats?.legalHolds || 0,
            description: 'Seluruh tindakan retensi dan penyusutan ditangguhkan',
            Icon: AlertTriangle,
            border: 'border-l-slate-500',
            icon: 'text-slate-600 dark:text-slate-400',
            iconBg: 'bg-slate-100/50 dark:bg-slate-500/10',
        },
        {
            label: 'Cakupan Aturan Terverifikasi',
            value: `${complianceStats?.verifiedCoveragePercent ?? 100}%`,
            description: `${complianceStats?.verified || 0} dari ${complianceStats?.totalArchives || 0} arsip`,
            Icon: CheckCircle2,
            border: 'border-l-emerald-500',
            icon: 'text-emerald-600 dark:text-emerald-400',
            iconBg: 'bg-emerald-100/50 dark:bg-emerald-500/10',
        },
    ];

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h2 className="text-lg font-semibold tracking-tight">Monitoring Pengawasan</h2>
                    <p className="text-sm text-muted-foreground">Analisis aktivitas user dan kepatuhan sistem</p>
                </div>
                <Select value={daysRange} onValueChange={setDaysRange}>
                    <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Pilih Rentang" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="7">7 Hari Terakhir</SelectItem>
                        <SelectItem value="30">30 Hari Terakhir</SelectItem>
                        <SelectItem value="90">90 Hari Terakhir</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {/* Compliance Cards */}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {qualityCards.map((card) => {
                    const IconComponent = card.Icon;
                    return (
                    <Card key={card.label} className={`card-hover border-l-4 shadow-sm ${card.border}`}>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">{card.label}</CardTitle>
                            <div className={`rounded-full p-2 ${card.iconBg}`}>
                                <IconComponent className={`h-4 w-4 ${card.icon}`} />
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{card.value}</div>
                            <p className="mt-1 text-xs text-muted-foreground">{card.description}</p>
                        </CardContent>
                    </Card>
                    );
                })}
            </div>

            <Card className="shadow-sm">
                <CardHeader>
                    <CardTitle className="text-base">Antrean Kualitas Klasifikasi dan JRA</CardTitle>
                    <CardDescription>Daftar kerja prioritas; keputusan penyusutan tetap memerlukan telaah petugas.</CardDescription>
                </CardHeader>
                <CardContent className="px-0 sm:px-6">
                    {qualityIssues.length === 0 ? (
                        <div className="py-10 text-center text-sm text-muted-foreground">Tidak ada masalah kualitas yang terbuka.</div>
                    ) : (
                        <Table responsive>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Berkas</TableHead>
                                    <TableHead>Unit</TableHead>
                                    <TableHead>JRA</TableHead>
                                    <TableHead>Masalah</TableHead>
                                    <TableHead className="text-right">Tindakan</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {qualityIssues.map((item) => (
                                    <TableRow key={item.id}>
                                        <TableCell data-label="Berkas">
                                            <p className="font-medium">{item.nomorBerkas || 'Tanpa nomor berkas'}</p>
                                            <p className="max-w-[320px] truncate text-xs text-muted-foreground" title={item.uraianBerkas || ''}>{item.uraianBerkas || 'Tanpa uraian'}</p>
                                        </TableCell>
                                        <TableCell data-label="Unit" className="font-mono text-xs">{item.unitKerjaId}</TableCell>
                                        <TableCell data-label="JRA" className="font-mono text-xs">{item.jraKode || '—'}</TableCell>
                                        <TableCell data-label="Masalah">
                                            <div className="flex max-w-[420px] flex-wrap gap-1">
                                                {(item.issues || []).map((issue) => (
                                                    <Badge key={issue} variant="outline" className="text-[10px]">{ISSUE_LABELS[issue] || issue}</Badge>
                                                ))}
                                            </div>
                                        </TableCell>
                                        <TableCell data-label="Tindakan" className="text-right">
                                            <Button variant="outline" size="sm" asChild>
                                                <Link to={`/arsip/detail/${item.id}`}>Telaah arsip</Link>
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            {/* Charts */}
            <div className="grid gap-6 md:grid-cols-2">
                <Card className="shadow-sm">
                    <CardHeader>
                        <CardTitle className="text-base">Tren Aktivitas Sistem</CardTitle>
                        <CardDescription>Frekuensi aksi Create, Update, Delete per hari</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[350px] w-full">
                            <Line role="img" aria-label="Grafik aktivitas pengguna dalam periode pengawasan" data={activityChartData} options={chartOptions} />
                        </div>
                    </CardContent>
                </Card>

                <Card className="shadow-sm">
                    <CardHeader>
                        <CardTitle className="text-base">User Paling Aktif</CardTitle>
                        <CardDescription>Top 5 user berdasarkan total aktivitas</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[350px] w-full">
                            <Bar
                                role="img"
                                aria-label="Grafik perbandingan aktivitas berdasarkan unit kerja"
                                data={userChartData}
                                options={{
                                    ...chartOptions,
                                    indexAxis: 'y'
                                }}
                            />
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
