import { useState, useEffect, useCallback, useRef } from 'react'
import { MailOpen, Send, Archive, AlertTriangle, TrendingUp, Clock, Eye, Loader2, Plus, FileText, FolderArchive, ArrowRight, Building2, CalendarClock, MoreHorizontal, FileBarChart, Inbox, ArrowUpRight } from 'lucide-react'
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
    Title,
    Tooltip,
    Legend,
    Filler,
} from 'chart.js'
import { Line, Bar } from 'react-chartjs-2'
import { useNavigate, useLocation } from 'react-router-dom'
import dashboardService from '@/services/dashboard.service'
import settingsService from '@/services/settings.service'
import { DashboardSkeleton } from '@/components/skeletons'
import { useAuth } from '@/context/AuthContext'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import DashboardPengawasan from '@/components/dashboard/DashboardPengawasan'

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    BarElement,
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

        const [statsResult, expiringResult, comparisonResult, recentResult] = await Promise.all([
            dashboardService.getStats(unitKerjaId),
            dashboardService.getExpiringArchives(unitKerjaId, 90),
            dashboardService.getUnitKerjaComparison(unitKerjaId),
            dashboardService.getRecentActivity(unitKerjaId, 8)
        ]);

        setStats(statsResult);
        setExpiring(expiringResult);
        setUnitKerjaStats(comparisonResult || []);
        setRecentActivity(recentResult || []);
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
        { label: 'Total Arsip', value: stats.totalArsip, change: null, icon: Archive, color: 'text-blue-600', bg: 'bg-blue-100/50', trend: 'neutral' },
        { label: 'Arsip Masuk', value: stats.arsipMasuk || 0, change: null, icon: Inbox, color: 'text-teal-600', bg: 'bg-teal-100/50', trend: 'neutral' },
        { label: 'Arsip Keluar', value: stats.arsipKeluar || 0, change: null, icon: ArrowUpRight, color: 'text-indigo-600', bg: 'bg-indigo-100/50', trend: 'neutral' },
        { label: 'Segera Musnah', value: expiringByUrgency.critical.length, change: null, icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-100/50', trend: 'neutral' },
    ] : [];

    if (loading) {
        return <DashboardSkeleton />;
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] gap-6 animate-in fade-in zoom-in duration-500">
                <div className="p-4 bg-red-50 rounded-full">
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
            {/* Hero Section - Responsive */}
            <div className="bg-gradient-to-r from-primary/90 to-primary/70 rounded-2xl sm:rounded-3xl p-4 sm:p-6 md:p-8 lg:p-10 text-white shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-40 sm:w-64 h-40 sm:h-64 bg-white/10 rounded-full blur-3xl -mr-10 sm:-mr-16 -mt-10 sm:-mt-16 animate-pulse"></div>
                <div className="absolute bottom-0 left-0 w-32 sm:w-48 h-32 sm:h-48 bg-black/10 rounded-full blur-3xl -ml-6 sm:-ml-10 -mb-6 sm:-mb-10"></div>

                <div className="relative z-10 flex flex-col gap-4 sm:gap-6">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 sm:gap-6">
                        <div className="space-y-1 sm:space-y-2 min-w-0 flex-1">
                            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight break-words">Halo, {user?.name.split(' ')[0]}! 👋</h1>
                            <p className="text-primary-foreground/90 text-sm sm:text-base md:text-lg leading-relaxed">
                                Selamat datang kembali di Dashboard SIMSA.
                            </p>
                        </div>
                        <div className="flex flex-col gap-2 w-full sm:w-auto sm:min-w-[200px] backdrop-blur-sm bg-white/10 p-2.5 sm:p-3 rounded-xl border border-white/20 shadow-sm shrink-0">
                            <div className="flex items-center gap-2 text-xs sm:text-sm font-medium">
                                <CalendarClock className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
                                <span className="truncate">{new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
                            </div>
                            {selectedUnitKerja !== 'all' && user?.unitKerjaId && (
                                <div className="flex items-center gap-2 text-xs bg-white/20 px-2 py-1 rounded-md w-fit">
                                    <Building2 className="h-3 w-3 shrink-0" />
                                    <span className="uppercase truncate">{user.unitKerjaId}</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Unit Kerja Selector for Super Admin */}
                    {isSuperAdmin && unitKerjaList.length > 0 && (
                        <div className="pt-4 sm:pt-6 border-t border-white/20">
                            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3">
                                <span className="text-xs sm:text-sm font-medium opacity-90">Tampilkan Data:</span>
                                <Select value={selectedUnitKerja} onValueChange={setSelectedUnitKerja}>
                                    <SelectTrigger className="w-full sm:w-[260px] h-9 bg-white/10 border-white/30 text-white placeholder:text-white/70 focus:ring-0 focus:ring-offset-0 focus:border-white/50">
                                        <SelectValue placeholder="Pilih Unit Kerja" className="placeholder:text-white/70" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">📊 Semua Unit Kerja</SelectItem>
                                        {unitKerjaList.map(uk => (
                                            <SelectItem key={uk.id} value={uk.id}>
                                                {uk.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    )}
                </div>
            </div>

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
                                            <Badge variant="outline" className={`font-normal text-[10px] sm:text-xs ${typeof stat.change === 'number' && stat.change > 0 ? 'text-green-600 bg-green-50 border-green-200' : 'text-gray-500'}`}>
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
                                    <div className="flex items-center justify-between">
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
                                                            <div className="flex items-center justify-between">
                                                                <p className="text-sm font-medium truncate">{item.kodeKlasifikasi}</p>
                                                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${item.daysLeft <= 15 ? 'bg-red-50 text-red-600' :
                                                                    item.daysLeft <= 30 ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-blue-600'
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
                                            onClick={() => navigate(item.type === 'masuk' ? `/surat/masuk/detail/${item.id}` : `/surat/keluar/detail/${item.id}`)}>
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
                                                <Badge variant="outline" className={`text-[10px] ${item.type === 'masuk' ? 'border-emerald-200 text-emerald-700 bg-emerald-50' : 'border-yellow-200 text-yellow-700 bg-yellow-50'}`}>
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
