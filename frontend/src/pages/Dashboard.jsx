import { useState, useEffect, useRef } from 'react'
import { MailOpen, Send, Archive, AlertTriangle, TrendingUp, Clock, Eye, Loader2, Plus, FileText, FolderArchive, ArrowRight, Building2, CalendarClock, MoreHorizontal, FileBarChart, Inbox, ArrowUpRight, Shield, ShieldAlert, BookOpen, BookX, HardDrive, FileArchive, Image, Film, Music, File, CheckCircle2, ArrowRightCircle, ClipboardCheck, Stamp, Play } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    BarElement,
    ArcElement,
    Title,
    Tooltip,
    Legend,
    Filler,
} from 'chart.js'
import { Line, Bar, Doughnut } from 'react-chartjs-2'
import { useNavigate, useLocation } from 'react-router-dom'
import dashboardService from '@/services/dashboard.service'
import settingsService from '@/services/settings.service'
import { DashboardSkeleton } from '@/components/skeletons'
import { useAuth } from '@/context/AuthContext'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import DashboardPengawasan from '@/components/dashboard/DashboardPengawasan'
import { PageHeader } from '@/components/PageHeader';
import appConfig from '@/lib/app-config';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    BarElement,
    ArcElement,
    Title,
    Tooltip,
    Legend,
    Filler
)

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
}

export default function Dashboard() {
    const navigate = useNavigate();
    const location = useLocation();
    const { user, canWrite } = useAuth();
    const isAdmin = canWrite();
    const isUserRole = user?.role === 'user';
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [stats, setStats] = useState(null);
    const [expiring, setExpiring] = useState([]);
    const [recentActivity, setRecentActivity] = useState([]);
    const [unitKerjaStats, setUnitKerjaStats] = useState([]);
    const [widgetData, setWidgetData] = useState(null);
    const [unitKerjaList, setUnitKerjaList] = useState([]);
    const [selectedUnitKerja, setSelectedUnitKerja] = useState(undefined); // undefined = uninitialized
    const isInitializedRef = useRef(false);

    const isSuperAdmin = user?.role === 'super_admin';

    // Load unit kerja list for super admin
    useEffect(() => {
        if (user) {
            if (isSuperAdmin) {
                loadUnitKerjaList();
            } else {
                // Regular user: lock to their unit (use 'none' if no unitKerjaId)
                setSelectedUnitKerja(user.unitKerjaId || 'none');
            }
        }
    }, [user?.id]);

    // Load dashboard data when selectedUnitKerja is set
    useEffect(() => {
        if (user && selectedUnitKerja !== undefined) {
            loadDashboardData();
            isInitializedRef.current = true;
        }
    }, [selectedUnitKerja]);

    // Re-fetch data when navigating back to dashboard (real-time updates)
    useEffect(() => {
        if (isInitializedRef.current && user && selectedUnitKerja !== undefined) {
            refreshData();
        }
    }, [location.key]);

    // Re-fetch data when window regains focus (e.g. user switches tabs back)
    useEffect(() => {
        const handleFocus = () => {
            if (isInitializedRef.current && user && selectedUnitKerja !== undefined) {
                refreshData();
            }
        };

        const handleVisibility = () => {
            if (document.visibilityState === 'visible' && isInitializedRef.current && user && selectedUnitKerja !== undefined) {
                refreshData();
            }
        };

        window.addEventListener('focus', handleFocus);
        document.addEventListener('visibilitychange', handleVisibility);

        return () => {
            window.removeEventListener('focus', handleFocus);
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, [user, selectedUnitKerja]);

    const loadUnitKerjaList = async () => {
        try {
            const result = await settingsService.getAllUnitKerja();
            const list = result.data || result || [];
            setUnitKerjaList(list);
            // Default to "Semua Unit Kerja"
            setSelectedUnitKerja('all');
        } catch (err) {
            console.error('Failed to load unit kerja list:', err);
            setSelectedUnitKerja('all');
        }
    };

    // Full load with loading spinner (initial load or unit change)
    const loadDashboardData = async () => {
        try {
            setLoading(true);
            setError(null);
            await fetchDashboardData();
        } catch (err) {
            console.error('Failed to load dashboard data:', err);
            setError('Gagal memuat data dashboard');
        } finally {
            setLoading(false);
        }
    };

    // Silent refresh without loading spinner (navigation back, focus, etc)
    const refreshData = async () => {
        try {
            await fetchDashboardData();
        } catch (err) {
            console.error('Failed to refresh dashboard data:', err);
        }
    };

    // Shared data fetching logic
    const fetchDashboardData = async () => {
        const unitKerjaId = (selectedUnitKerja === 'all' || selectedUnitKerja === 'none') ? null : selectedUnitKerja;

        const [statsResult, expiringResult, comparisonResult, recentResult, widgetResult] = await Promise.all([
            dashboardService.getStats(unitKerjaId),
            dashboardService.getExpiringArchives(unitKerjaId, 90),
            dashboardService.getUnitKerjaComparison(unitKerjaId),
            dashboardService.getRecentActivity(unitKerjaId, 8),
            dashboardService.getWidgetData(unitKerjaId).catch(() => null),
        ]);

        setStats(statsResult);
        setExpiring(expiringResult);
        setUnitKerjaStats(comparisonResult || []);
        setRecentActivity(recentResult || []);
        setWidgetData(widgetResult);
    };

    // Categorize expiring archives by urgency
    const expiringByUrgency = {
        critical: expiring.filter(e => e.daysLeft <= 15),
        warning: expiring.filter(e => e.daysLeft > 15 && e.daysLeft <= 30),
        info: expiring.filter(e => e.daysLeft > 30)
    };

    // Build chart data from stats
    const chartData = stats ? {
        labels: stats.monthlyTrend.map(m => m.month),
        datasets: [
            {
                label: 'Surat Masuk',
                data: stats.monthlyTrend.map(m => m.masuk),
                borderColor: '#10b981', // emerald-500
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                fill: true,
                tension: 0.4,
                pointBackgroundColor: '#fff',
                pointBorderColor: '#10b981',
                pointHoverBackgroundColor: '#10b981',
                pointHoverBorderColor: '#fff',
            },
            {
                label: 'Surat Keluar',
                data: stats.monthlyTrend.map(m => m.keluar),
                borderColor: '#eab308', // yellow-500 (gold)
                backgroundColor: 'rgba(234, 179, 8, 0.1)',
                fill: true,
                tension: 0.4,
                pointBackgroundColor: '#fff',
                pointBorderColor: '#eab308',
                pointHoverBackgroundColor: '#eab308',
                pointHoverBorderColor: '#fff',
            },
        ],
    } : null;

    // Unit kerja comparison chart
    const unitKerjaChartData = {
        labels: unitKerjaStats.map(u => {
            let name = u.name.replace('Direktorat ', '').replace('Dit. ', '');
            return name.length > 20 ? name.substring(0, 20) + '...' : name;
        }),
        datasets: [
            {
                label: 'Surat Masuk',
                data: unitKerjaStats.map(u => u.masuk),
                backgroundColor: '#10b981',
                borderRadius: 4,
            },
            {
                label: 'Surat Keluar',
                data: unitKerjaStats.map(u => u.keluar),
                backgroundColor: '#eab308',
                borderRadius: 4,
            },
        ],
    };

    const statCards = stats ? [
        { label: 'Surat Masuk', value: stats.totalMasuk, change: stats.masukBulanIni, icon: MailOpen, color: 'text-emerald-600', bg: 'bg-emerald-100/50', trend: 'up' },
        { label: 'Surat Keluar', value: stats.totalKeluar, change: stats.keluarBulanIni, icon: Send, color: 'text-yellow-600', bg: 'bg-yellow-100/50', trend: 'up' },
        { label: 'Total Arsip', value: stats.totalArsip, change: null, icon: Archive, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-100/50', trend: 'neutral' },
        { label: 'Arsip Masuk', value: stats.arsipMasuk || 0, change: null, icon: Inbox, color: 'text-teal-600 dark:text-teal-400', bg: 'bg-teal-100/50', trend: 'neutral' },
        { label: 'Arsip Keluar', value: stats.arsipKeluar || 0, change: null, icon: ArrowUpRight, color: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-100/50', trend: 'neutral' },
        { label: 'Segera Musnah', value: expiringByUrgency.critical.length, change: null, icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-100/50', trend: 'neutral' },
    ] : [];

    if (loading) {
        return <DashboardSkeleton />;
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] gap-6 animate-in fade-in zoom-in duration-500">
                <div className="p-4 bg-red-50 dark:bg-red-500/15 rounded-full">
                    <AlertTriangle className="h-12 w-12 text-red-500" />
                </div>
                <div className="text-center space-y-2">
                    <h3 className="font-semibold text-lg text-foreground">Gagal Memuat Data</h3>
                    <p className="text-muted-foreground max-w-[300px]">{error}</p>
                </div>
                <Button onClick={loadDashboardData} className="gap-2">
                    <Loader2 className="h-4 w-4" /> Coba Lagi
                </Button>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-6 duration-700">
            <PageHeader
                title={`Halo, ${user?.name?.split(' ')[0] || 'Pengguna'}`}
                description={`${appConfig.name} — ringkasan surat dan arsip unit kerja Anda hari ini.`}
                actions={
                    <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
                        <Badge variant="outline" className="w-fit self-start sm:self-end">
                            {appConfig.usageBadge}
                        </Badge>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <CalendarClock className="h-4 w-4 shrink-0" />
                            <span>{new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
                        </div>
                        {isSuperAdmin && unitKerjaList.length > 0 && (
                            <Select value={selectedUnitKerja} onValueChange={setSelectedUnitKerja}>
                                <SelectTrigger className="h-9 w-full sm:w-[260px]">
                                    <SelectValue placeholder="Pilih Unit Kerja" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Semua Unit Kerja</SelectItem>
                                    {unitKerjaList.map(uk => (
                                        <SelectItem key={uk.id} value={uk.id}>
                                            {uk.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                        {!isSuperAdmin && selectedUnitKerja !== 'all' && user?.unitKerjaId && (
                            <Badge variant="muted" className="w-fit gap-1.5 self-start sm:self-end">
                                <Building2 className="h-3 w-3" />
                                <span className="uppercase">{user.unitKerjaId}</span>
                            </Badge>
                        )}
                    </div>
                }
            />

            <Tabs defaultValue="overview" className="space-y-6">

                {/* Activation Banner for 'user' role */}
                {isUserRole && (
                    <Card className="border-amber-200 bg-amber-50/50 shadow-sm">
                        <CardContent className="p-6 flex items-center gap-4">
                            <div className="p-3 bg-amber-100 rounded-full">
                                <Clock className="h-6 w-6 text-amber-600" />
                            </div>
                            <div className="flex-1">
                                <h3 className="font-semibold text-amber-900">Menunggu Aktivasi Role</h3>
                                <p className="text-sm text-amber-700 mt-1">
                                    Akun Anda belum memiliki akses ke data surat dan arsip. Silakan hubungi Admin untuk penetapan role dan unit kerja.
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                )}

                <TabsList className="bg-muted/50 p-1 rounded-xl">
                    <TabsTrigger value="overview" className="rounded-lg">Ringkasan</TabsTrigger>
                    {isSuperAdmin && <TabsTrigger value="supervision" className="rounded-lg">Pengawasan</TabsTrigger>}
                </TabsList>

                <TabsContent value="overview" className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
                    {/* Stats Grid */}
                    <div className="grid gap-3 sm:gap-4 grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
                        {statCards.map((stat, i) => (
                            <Card key={stat.label} className="card-hover border-transparent shadow-sm hover:shadow-lg transition-all" style={{ animationDelay: `${i * 80}ms` }}>
                                <CardContent className="p-4 sm:p-5 lg:p-6">
                                    <div className="flex items-center justify-between mb-3 sm:mb-4">
                                        <div className={`p-2 sm:p-2.5 rounded-xl ${stat.bg}`}>
                                            <stat.icon className={`h-4 w-4 sm:h-5 sm:w-5 ${stat.color}`} />
                                        </div>
                                        {stat.change !== null && (
                                            <Badge variant="outline" className={`font-normal text-[10px] sm:text-xs ${typeof stat.change === 'number' && stat.change > 0 ? 'text-green-600 bg-green-50 dark:bg-green-500/15 border-green-200' : 'text-muted-foreground'}`}>
                                                {typeof stat.change === 'number' && stat.change > 0 ? '+' : ''}{stat.change} bln ini
                                            </Badge>
                                        )}
                                    </div>
                                    <div className="flex flex-col gap-0.5 sm:gap-1">
                                        <h3 className="text-xl sm:text-2xl font-bold tracking-tight">{stat.value.toLocaleString('id-ID')}</h3>
                                        <p className="text-xs sm:text-sm text-muted-foreground font-medium">{stat.label}</p>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>

                    <div className="grid gap-6 lg:grid-cols-5">
                        {/* Charts Area */}
                        <div className="lg:col-span-3 space-y-6">
                            {/* Monthly Trend Chart */}
                            <Card className="shadow-sm border-border/60">
                                <CardHeader className="flex flex-row items-center justify-between pb-2">
                                    <div>
                                        <CardTitle className="text-lg">Analisis Trend Surat</CardTitle>
                                        <CardDescription>Perbandingan surat masuk dan keluar 12 bulan terakhir</CardDescription>
                                    </div>
                                    <Button variant="ghost" size="icon" className="h-8 w-8">
                                        <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                </CardHeader>
                                <CardContent>
                                    <div className="h-[250px] sm:h-[300px] w-full mt-4">
                                        {chartData && <Line data={chartData} options={chartOptions} />}
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Unit Kerja Comparison Chart */}
                            <Card className="shadow-sm border-border/60">
                                <CardHeader>
                                    <CardTitle className="text-lg">Perbandingan Unit Kerja</CardTitle>
                                    <CardDescription>Volume surat per unit kerja bulan ini</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div style={{ height: Math.max(200, (unitKerjaStats?.length || 3) * 60) + 'px' }}>
                                        <Bar
                                            data={unitKerjaChartData}
                                            options={{
                                                ...chartOptions,
                                                indexAxis: 'y',
                                                scales: {
                                                    ...chartOptions?.scales,
                                                    y: {
                                                        ...chartOptions?.scales?.y,
                                                        ticks: {
                                                            ...chartOptions?.scales?.y?.ticks,
                                                            font: { size: 11 },
                                                            callback: function (value) {
                                                                const label = this.getLabelForValue(value);
                                                                return label.length > 20 ? label.substring(0, 20) + '...' : label;
                                                            }
                                                        }
                                                    }
                                                }
                                            }}
                                        />
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        {/* Right Sidebar - Actions & Notifications */}
                        <div className="lg:col-span-2 space-y-6">
                            {/* Quick Actions */}
                            <Card className="shadow-sm border-border/60 bg-gradient-to-br from-background to-muted/20">
                                <CardHeader>
                                    <CardTitle className="text-base font-semibold">Aksi Cepat</CardTitle>
                                </CardHeader>
                                <CardContent className="grid grid-cols-2 gap-3">
                                    {isAdmin ? (
                                        <>
                                            <Button variant="outline" className="h-auto py-4 flex flex-col gap-2 hover:bg-primary/5 hover:border-primary/20 hover:text-primary transition-all" onClick={() => navigate('/surat/masuk/tambah')}>
                                                <MailOpen className="h-5 w-5" />
                                                <span className="text-xs">Surat Masuk</span>
                                            </Button>
                                            <Button variant="outline" className="h-auto py-4 flex flex-col gap-2 hover:bg-primary/5 hover:border-primary/20 hover:text-primary transition-all" onClick={() => navigate('/surat/keluar/tambah')}>
                                                <Send className="h-5 w-5" />
                                                <span className="text-xs">Surat Keluar</span>
                                            </Button>
                                        </>
                                    ) : (
                                        <>
                                            <Button variant="outline" className="h-auto py-4 flex flex-col gap-2 hover:bg-primary/5 hover:border-primary/20 hover:text-primary transition-all" onClick={() => navigate('/surat/masuk')}>
                                                <MailOpen className="h-5 w-5" />
                                                <span className="text-xs">Surat Masuk</span>
                                            </Button>
                                            <Button variant="outline" className="h-auto py-4 flex flex-col gap-2 hover:bg-primary/5 hover:border-primary/20 hover:text-primary transition-all" onClick={() => navigate('/surat/keluar')}>
                                                <Send className="h-5 w-5" />
                                                <span className="text-xs">Surat Keluar</span>
                                            </Button>
                                        </>
                                    )}
                                    <Button variant="outline" className="h-auto py-4 flex flex-col gap-2 hover:bg-primary/5 hover:border-primary/20 hover:text-primary transition-all" onClick={() => navigate('/laporan')}>
                                        <FileBarChart className="h-5 w-5" />
                                        <span className="text-xs">Laporan</span>
                                    </Button>
                                    {isAdmin && (
                                        <Button variant="outline" className="h-auto py-4 flex flex-col gap-2 hover:bg-primary/5 hover:border-primary/20 hover:text-primary transition-all" onClick={() => navigate('/bulk-upload')}>
                                            <FolderArchive className="h-5 w-5" />
                                            <span className="text-xs">Upload</span>
                                        </Button>
                                    )}
                                </CardContent>
                            </Card>

                            {/* Expiring Archives */}
                            <Card className="shadow-sm border-border/60 overflow-hidden flex flex-col min-h-[300px] lg:min-h-[400px]">
                                <CardHeader className="bg-amber-50/50 dark:bg-amber-950/10 border-b border-amber-100 dark:border-amber-900/50 pb-4">
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <div className="flex items-center gap-2 text-amber-700 dark:text-amber-500">
                                            <AlertTriangle className="h-4 w-4" />
                                            <CardTitle className="text-base">Masa Retensi</CardTitle>
                                        </div>
                                        <Badge variant="outline" className="text-xs border-amber-200 bg-amber-100/50 text-amber-700">{expiring.length} Arsip</Badge>
                                    </div>
                                    <CardDescription className="text-xs mt-1">Arsip yang mendekati masa musnah (90 hari)</CardDescription>
                                </CardHeader>
                                <CardContent className="p-0 flex-1 overflow-y-auto max-h-[400px]">
                                    {expiring.length > 0 ? (
                                        <div className="divide-y divide-border/50">
                                            {expiring.map((item) => (
                                                <div key={item.id} className="p-4 hover:bg-muted/50 transition-colors cursor-pointer group" onClick={() => navigate(`/arsip/detail/${item.id}`)}>
                                                    <div className="flex items-start gap-3">
                                                        <div className={`mt-1 h-2 w-2 rounded-full shrink-0 ${item.daysLeft <= 15 ? 'bg-red-500 ring-2 ring-red-100' :
                                                            item.daysLeft <= 30 ? 'bg-amber-500 ring-2 ring-amber-100' : 'bg-blue-500 ring-2 ring-blue-100'
                                                            }`} />
                                                        <div className="flex-1 min-w-0 space-y-1">
                                                            <div className="flex flex-wrap items-center justify-between gap-3">
                                                                <p className="text-sm font-medium truncate">{item.kodeKlasifikasi}</p>
                                                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${item.daysLeft <= 15 ? 'bg-red-50 dark:bg-red-500/15 text-red-600' :
                                                                    item.daysLeft <= 30 ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 dark:bg-blue-500/15 text-blue-600 dark:text-blue-400'
                                                                    }`}>
                                                                    {item.daysLeft} hari
                                                                </span>
                                                            </div>
                                                            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                                                                {item.uraianBerkas || 'Tidak ada uraian'}
                                                            </p>
                                                        </div>
                                                        <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 -ml-2 group-hover:opacity-100 group-hover:ml-0 transition-all" />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center h-48 text-center p-4">
                                            <div className="bg-muted p-3 rounded-full mb-3">
                                                <Clock className="h-6 w-6 text-muted-foreground/50" />
                                            </div>
                                            <p className="text-sm font-medium text-muted-foreground">Aman! Tidak ada arsip kritis.</p>
                                        </div>
                                    )}
                                </CardContent>
                                <CardFooter className="p-3 border-t bg-muted/20">
                                    <Button variant="ghost" size="sm" className="w-full text-xs h-8" onClick={() => navigate('/retention')}>
                                        Lihat Semua Jadwal Retensi <ArrowRight className="ml-1 h-3 w-3" />
                                    </Button>
                                </CardFooter>
                            </Card>
                        </div>
                    </div>

                    {/* Recent Activity Section */}
                    {recentActivity.length > 0 && (
                        <Card className="shadow-sm border-border/60">
                            <CardHeader className="flex flex-row items-center justify-between pb-2">
                                <div>
                                    <CardTitle className="text-lg">Aktivitas Terbaru</CardTitle>
                                    <CardDescription>Surat masuk dan keluar terbaru</CardDescription>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="divide-y divide-border/50">
                                    {recentActivity.map((item) => (
                                        <div key={item.id} className="flex items-center gap-4 py-3 hover:bg-muted/50 rounded-lg px-2 transition-colors cursor-pointer group"
                                            onClick={() => navigate(item.type === 'masuk' ? `/surat/masuk/${item.id}` : `/surat/keluar/${item.id}`)}>
                                            <div className={`p-2 rounded-lg ${item.type === 'masuk' ? 'bg-emerald-100/50' : 'bg-yellow-100/50'}`}>
                                                {item.type === 'masuk'
                                                    ? <MailOpen className="h-4 w-4 text-emerald-600" />
                                                    : <Send className="h-4 w-4 text-yellow-600" />}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium truncate">{item.nomorSurat || 'Belum bernomor'}</p>
                                                <p className="text-xs text-muted-foreground truncate">{item.perihal || '-'}</p>
                                            </div>
                                            <div className="text-right">
                                                <Badge variant="outline" className={`text-[10px] ${item.type === 'masuk' ? 'border-emerald-200 text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15' : 'border-yellow-200 text-yellow-700 dark:text-yellow-300 bg-yellow-50 dark:bg-yellow-500/15'}`}>
                                                    {item.type === 'masuk' ? 'Masuk' : 'Keluar'}
                                                </Badge>
                                                <p className="text-[10px] text-muted-foreground mt-1">
                                                    {item.tanggal ? new Date(item.tanggal).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : '-'}
                                                </p>
                                            </div>
                                            <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* ====== NEW WIDGETS SECTION ====== */}
                    {widgetData && (
                        <>
                            {/* Row 1: Archive Lifecycle + Media Breakdown + Peminjaman */}
                            <div className="grid gap-6 lg:grid-cols-3">
                                {/* Archive Lifecycle Donut */}
                                <Card className="shadow-sm border-border/60">
                                    <CardHeader className="pb-2">
                                        <div className="flex items-center gap-2">
                                            <div className="p-2 bg-violet-100/50 rounded-xl">
                                                <Archive className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                                            </div>
                                            <div>
                                                <CardTitle className="text-base">Status Siklus Arsip</CardTitle>
                                                <CardDescription className="text-xs">Distribusi status arsip saat ini</CardDescription>
                                            </div>
                                        </div>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="h-[200px] flex items-center justify-center">
                                            <Doughnut
                                                data={{
                                                    labels: ['Aktif', 'Inaktif', 'Kadaluarsa', 'Belum Ditentukan'],
                                                    datasets: [{
                                                        data: [
                                                            widgetData.archiveLifecycle.aktif,
                                                            widgetData.archiveLifecycle.inaktif,
                                                            widgetData.archiveLifecycle.kadaluarsa,
                                                            widgetData.archiveLifecycle.belumDitentukan,
                                                        ],
                                                        backgroundColor: ['#10b981', '#3b82f6', '#ef4444', '#94a3b8'],
                                                        borderWidth: 0,
                                                        hoverOffset: 4,
                                                    }],
                                                }}
                                                options={{
                                                    responsive: true,
                                                    maintainAspectRatio: false,
                                                    cutout: '65%',
                                                    plugins: {
                                                        legend: { display: false },
                                                        tooltip: {
                                                            backgroundColor: 'rgba(255,255,255,0.95)',
                                                            titleColor: '#1e293b',
                                                            bodyColor: '#475569',
                                                            borderColor: '#e2e8f0',
                                                            borderWidth: 1,
                                                            padding: 10,
                                                            cornerRadius: 8,
                                                        },
                                                    },
                                                }}
                                            />
                                        </div>
                                        {/* Legend */}
                                        <div className="grid grid-cols-2 gap-2 mt-4">
                                            {[
                                                { label: 'Aktif', value: widgetData.archiveLifecycle.aktif, color: 'bg-emerald-500' },
                                                { label: 'Inaktif', value: widgetData.archiveLifecycle.inaktif, color: 'bg-blue-500' },
                                                { label: 'Kadaluarsa', value: widgetData.archiveLifecycle.kadaluarsa, color: 'bg-red-500' },
                                                { label: 'Belum Ditentukan', value: widgetData.archiveLifecycle.belumDitentukan, color: 'bg-slate-400' },
                                            ].map(item => (
                                                <div key={item.label} className="flex items-center gap-2 text-xs">
                                                    <span className={`h-2.5 w-2.5 rounded-full ${item.color}`} />
                                                    <span className="text-muted-foreground">{item.label}</span>
                                                    <span className="font-semibold ml-auto">{item.value}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </CardContent>
                                </Card>

                                {/* Media Type Breakdown */}
                                <Card className="shadow-sm border-border/60">
                                    <CardHeader className="pb-2">
                                        <div className="flex items-center gap-2">
                                            <div className="p-2 bg-cyan-100/50 rounded-xl">
                                                <HardDrive className="h-4 w-4 text-cyan-600" />
                                            </div>
                                            <div>
                                                <CardTitle className="text-base">Jenis Media Arsip</CardTitle>
                                                <CardDescription className="text-xs">Distribusi berdasarkan media penyimpanan</CardDescription>
                                            </div>
                                        </div>
                                    </CardHeader>
                                    <CardContent>
                                        {widgetData.mediaBreakdown.length > 0 ? (
                                            <div className="space-y-3 mt-2">
                                                {widgetData.mediaBreakdown.map((media) => {
                                                    const total = widgetData.mediaBreakdown.reduce((sum, m) => sum + m.count, 0);
                                                    const percent = total > 0 ? Math.round((media.count / total) * 100) : 0;
                                                    const mediaIcons = {
                                                        'kertas': FileText,
                                                        'foto': Image,
                                                        'video': Film,
                                                        'audio': Music,
                                                        'elektronik': HardDrive,
                                                    };
                                                    const mediaColors = {
                                                        'kertas': 'text-amber-600 bg-amber-100/50',
                                                        'foto': 'text-pink-600 dark:text-pink-400 bg-pink-100/50',
                                                        'video': 'text-purple-600 dark:text-purple-400 bg-purple-100/50',
                                                        'audio': 'text-teal-600 dark:text-teal-400 bg-teal-100/50',
                                                        'elektronik': 'text-blue-600 dark:text-blue-400 bg-blue-100/50',
                                                    };
                                                    const barColors = {
                                                        'kertas': 'bg-amber-500',
                                                        'foto': 'bg-pink-500',
                                                        'video': 'bg-purple-500',
                                                        'audio': 'bg-teal-500',
                                                        'elektronik': 'bg-blue-500',
                                                    };
                                                    const IconComp = mediaIcons[media.type?.toLowerCase()] || File;
                                                    const colorClass = mediaColors[media.type?.toLowerCase()] || 'text-muted-foreground bg-muted/50';
                                                    const barColor = barColors[media.type?.toLowerCase()] || 'bg-gray-500';
                                                    return (
                                                        <div key={media.type} className="space-y-1.5">
                                                            <div className="flex flex-wrap items-center justify-between gap-3">
                                                                <div className="flex items-center gap-2">
                                                                    <div className={`p-1.5 rounded-lg ${colorClass}`}>
                                                                        <IconComp className="h-3.5 w-3.5" />
                                                                    </div>
                                                                    <span className="text-sm font-medium capitalize">{media.type || 'Lainnya'}</span>
                                                                </div>
                                                                <span className="text-xs text-muted-foreground">{media.count} ({percent}%)</span>
                                                            </div>
                                                            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                                                                <div className={`h-full ${barColor} rounded-full transition-all duration-500`} style={{ width: `${percent}%` }} />
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                            <div className="flex flex-col items-center justify-center h-32 text-center">
                                                <File className="h-8 w-8 text-muted-foreground/30 mb-2" />
                                                <p className="text-xs text-muted-foreground">Belum ada data media</p>
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>

                                {/* Peminjaman Overview */}
                                <Card className="shadow-sm border-border/60">
                                    <CardHeader className="pb-2">
                                        <div className="flex items-center gap-2">
                                            <div className="p-2 bg-orange-100/50 rounded-xl">
                                                <BookOpen className="h-4 w-4 text-orange-600" />
                                            </div>
                                            <div>
                                                <CardTitle className="text-base">Peminjaman Arsip</CardTitle>
                                                <CardDescription className="text-xs">Status peminjaman arsip fisik</CardDescription>
                                            </div>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        <div className="flex items-center gap-4 p-4 rounded-xl bg-orange-50/50 border border-orange-100">
                                            <div className="p-3 bg-orange-100 dark:bg-orange-500/15 rounded-full">
                                                <BookOpen className="h-6 w-6 text-orange-600" />
                                            </div>
                                            <div>
                                                <p className="text-2xl font-bold text-orange-700 dark:text-orange-300">{widgetData.lendingOverview.borrowed}</p>
                                                <p className="text-xs text-orange-600/80">Sedang Dipinjam</p>
                                            </div>
                                        </div>
                                        <div className={`flex items-center gap-4 p-4 rounded-xl border ${widgetData.lendingOverview.overdue > 0 ? 'bg-red-50/50 border-red-100' : 'bg-green-50/50 border-green-100'}`}>
                                            <div className={`p-3 rounded-full ${widgetData.lendingOverview.overdue > 0 ? 'bg-red-100 dark:bg-red-500/15' : 'bg-green-100 dark:bg-green-500/15'}`}>
                                                <BookX className={`h-6 w-6 ${widgetData.lendingOverview.overdue > 0 ? 'text-red-600' : 'text-green-600'}`} />
                                            </div>
                                            <div>
                                                <p className={`text-2xl font-bold ${widgetData.lendingOverview.overdue > 0 ? 'text-red-700 dark:text-red-300' : 'text-green-700 dark:text-green-300'}`}>{widgetData.lendingOverview.overdue}</p>
                                                <p className={`text-xs ${widgetData.lendingOverview.overdue > 0 ? 'text-red-600/80' : 'text-green-600/80'}`}>
                                                    {widgetData.lendingOverview.overdue > 0 ? 'Terlambat Dikembalikan!' : 'Tidak Ada yang Terlambat'}
                                                </p>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>

                            {/* Row 2: Penyusutan Pipeline */}
                            <Card className="shadow-sm border-border/60">
                                <CardHeader className="pb-3">
                                    <div className="flex items-center gap-2">
                                        <div className="p-2 bg-indigo-100/50 rounded-xl">
                                            <ClipboardCheck className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                                        </div>
                                        <div>
                                            <CardTitle className="text-base">Pipeline Penyusutan Arsip</CardTitle>
                                            <CardDescription className="text-xs">Status alur persetujuan penyusutan arsip</CardDescription>
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    <div className="flex flex-col sm:flex-row items-stretch gap-3">
                                        {widgetData.penyusutanOverview.map((stage, idx) => {
                                            const stageConfig = {
                                                draft: { label: 'Draft', icon: FileText, color: 'text-muted-foreground', bg: 'bg-muted', border: 'border-border', ring: 'ring-slate-300' },
                                                proposed: { label: 'Diusulkan', icon: ArrowRightCircle, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-100 dark:bg-blue-500/15', border: 'border-blue-200', ring: 'ring-blue-300' },
                                                reviewed: { label: 'Ditinjau', icon: Eye, color: 'text-amber-600', bg: 'bg-amber-100', border: 'border-amber-200', ring: 'ring-amber-300' },
                                                approved: { label: 'Disetujui', icon: Stamp, color: 'text-emerald-600', bg: 'bg-emerald-100 dark:bg-emerald-500/15', border: 'border-emerald-200', ring: 'ring-emerald-300' },
                                                executed: { label: 'Dilaksanakan', icon: Play, color: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-100 dark:bg-violet-500/15', border: 'border-violet-200', ring: 'ring-violet-300' },
                                            };
                                            const config = stageConfig[stage.status] || stageConfig.draft;
                                            const StageIcon = config.icon;
                                            return (
                                                <div key={stage.status} className="flex-1 flex items-center gap-2 sm:gap-0 sm:flex-col sm:items-center">
                                                    <div className={`relative flex flex-col items-center gap-2 p-3 sm:p-4 rounded-xl border ${config.border} ${config.bg}/50 w-full text-center transition-all hover:shadow-sm`}>
                                                        <div className={`p-2 rounded-full ${config.bg}`}>
                                                            <StageIcon className={`h-4 w-4 ${config.color}`} />
                                                        </div>
                                                        <p className={`text-2xl font-bold ${config.color}`}>{stage.count}</p>
                                                        <p className="text-xs text-muted-foreground font-medium">{config.label}</p>
                                                    </div>
                                                    {idx < widgetData.penyusutanOverview.length - 1 && (
                                                        <ArrowRight className="h-4 w-4 text-muted-foreground/40 shrink-0 hidden sm:block mt-2" />
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Row 3: Storage Capacity + Vital/Terjaga */}
                            <div className="grid gap-6 md:grid-cols-2">
                                {/* Storage Capacity */}
                                <Card className="shadow-sm border-border/60">
                                    <CardHeader className="pb-3">
                                        <div className="flex items-center gap-2">
                                            <div className="p-2 bg-teal-100/50 rounded-xl">
                                                <Building2 className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                                            </div>
                                            <div>
                                                <CardTitle className="text-base">Kapasitas Penyimpanan Fisik</CardTitle>
                                                <CardDescription className="text-xs">Utilisasi ruang arsip per gedung</CardDescription>
                                            </div>
                                        </div>
                                    </CardHeader>
                                    <CardContent>
                                        {widgetData.storageCapacity.length > 0 ? (
                                            <div className="space-y-4">
                                                {widgetData.storageCapacity.map((loc) => (
                                                    <div key={loc.id} className="space-y-2">
                                                        <div className="flex flex-wrap items-center justify-between gap-3">
                                                            <div className="flex items-center gap-2">
                                                                <Building2 className="h-4 w-4 text-muted-foreground" />
                                                                <span className="text-sm font-medium">{loc.name}</span>
                                                                <Badge variant="outline" className="text-[10px] font-mono">{loc.code}</Badge>
                                                            </div>
                                                            <span className="text-xs text-muted-foreground">
                                                                {loc.currentCount}/{loc.totalCapacity} ({loc.usagePercent}%)
                                                            </span>
                                                        </div>
                                                        <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                                                            <div
                                                                className={`h-full rounded-full transition-all duration-700 ${loc.usagePercent >= 90 ? 'bg-red-500' :
                                                                        loc.usagePercent >= 70 ? 'bg-amber-500' :
                                                                            'bg-teal-500'
                                                                    }`}
                                                                style={{ width: `${Math.min(loc.usagePercent, 100)}%` }}
                                                            />
                                                        </div>
                                                        <p className="text-[10px] text-muted-foreground">{loc.boxCount} box terdaftar</p>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="flex flex-col items-center justify-center h-32 text-center">
                                                <Building2 className="h-8 w-8 text-muted-foreground/30 mb-2" />
                                                <p className="text-xs text-muted-foreground">Belum ada data gedung arsip</p>
                                            </div>
                                        )}
                                    </CardContent>
                                    <CardFooter className="p-3 border-t bg-muted/20">
                                        <Button variant="ghost" size="sm" className="w-full text-xs h-8" onClick={() => navigate('/storage')}>
                                            Kelola Penyimpanan <ArrowRight className="ml-1 h-3 w-3" />
                                        </Button>
                                    </CardFooter>
                                </Card>

                                {/* Vital / Terjaga Alerts */}
                                <Card className="shadow-sm border-border/60">
                                    <CardHeader className="pb-3">
                                        <div className="flex items-center gap-2">
                                            <div className="p-2 bg-rose-100/50 rounded-xl">
                                                <Shield className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                                            </div>
                                            <div>
                                                <CardTitle className="text-base">Arsip Vital & Terjaga</CardTitle>
                                                <CardDescription className="text-xs">Alert arsip yang perlu tindakan segera</CardDescription>
                                            </div>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        {/* Vital */}
                                        <div className={`p-4 rounded-xl border ${widgetData.vitalTerjagaAlerts.vitalUnprotected > 0
                                                ? 'bg-red-50/50 border-red-200'
                                                : 'bg-emerald-50/50 border-emerald-200'
                                            }`}>
                                            <div className="flex items-center gap-3">
                                                <div className={`p-2.5 rounded-full ${widgetData.vitalTerjagaAlerts.vitalUnprotected > 0 ? 'bg-red-100 dark:bg-red-500/15' : 'bg-emerald-100 dark:bg-emerald-500/15'
                                                    }`}>
                                                    <ShieldAlert className={`h-5 w-5 ${widgetData.vitalTerjagaAlerts.vitalUnprotected > 0 ? 'text-red-600' : 'text-emerald-600'
                                                        }`} />
                                                </div>
                                                <div className="flex-1">
                                                    <p className="text-sm font-semibold">Arsip Vital</p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {widgetData.vitalTerjagaAlerts.vitalUnprotected > 0
                                                            ? `${widgetData.vitalTerjagaAlerts.vitalUnprotected} dari ${widgetData.vitalTerjagaAlerts.vitalTotal} arsip belum diproteksi`
                                                            : `Semua ${widgetData.vitalTerjagaAlerts.vitalTotal} arsip sudah diproteksi`}
                                                    </p>
                                                </div>
                                                <div className="text-right">
                                                    <p className={`text-xl font-bold ${widgetData.vitalTerjagaAlerts.vitalUnprotected > 0 ? 'text-red-600' : 'text-emerald-600'
                                                        }`}>{widgetData.vitalTerjagaAlerts.vitalUnprotected}</p>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Terjaga */}
                                        <div className={`p-4 rounded-xl border ${widgetData.vitalTerjagaAlerts.terjagaUnreported > 0
                                                ? 'bg-amber-50/50 border-amber-200'
                                                : 'bg-emerald-50/50 border-emerald-200'
                                            }`}>
                                            <div className="flex items-center gap-3">
                                                <div className={`p-2.5 rounded-full ${widgetData.vitalTerjagaAlerts.terjagaUnreported > 0 ? 'bg-amber-100' : 'bg-emerald-100 dark:bg-emerald-500/15'
                                                    }`}>
                                                    <FileArchive className={`h-5 w-5 ${widgetData.vitalTerjagaAlerts.terjagaUnreported > 0 ? 'text-amber-600' : 'text-emerald-600'
                                                        }`} />
                                                </div>
                                                <div className="flex-1">
                                                    <p className="text-sm font-semibold">Arsip Terjaga</p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {widgetData.vitalTerjagaAlerts.terjagaUnreported > 0
                                                            ? `${widgetData.vitalTerjagaAlerts.terjagaUnreported} dari ${widgetData.vitalTerjagaAlerts.terjagaTotal} arsip belum dilaporkan ke ANRI`
                                                            : `Semua ${widgetData.vitalTerjagaAlerts.terjagaTotal} arsip sudah dilaporkan ke ANRI`}
                                                    </p>
                                                </div>
                                                <div className="text-right">
                                                    <p className={`text-xl font-bold ${widgetData.vitalTerjagaAlerts.terjagaUnreported > 0 ? 'text-amber-600' : 'text-emerald-600'
                                                        }`}>{widgetData.vitalTerjagaAlerts.terjagaUnreported}</p>
                                                </div>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>
                        </>
                    )}
                </TabsContent>

                {isSuperAdmin && (
                    <TabsContent value="supervision">
                        <DashboardPengawasan />
                    </TabsContent>
                )}
            </Tabs>
        </div>
    )
}
