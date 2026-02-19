import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/services/api';
import { Line, Bar } from 'react-chartjs-2';
import { AlertTriangle, User, FileText, Activity, CheckCircle2, Clock } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

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
    const [daysRange, setDaysRange] = useState('7');

    useEffect(() => {
        loadData();
    }, [daysRange]);

    const loadData = async () => {
        try {
            setLoading(true);
            const [activityRes, userRes, complianceRes] = await Promise.all([
                api.get('/api/supervision/stats/activity', { days: daysRange }),
                api.get('/api/supervision/stats/users', { limit: '5' }),
                api.get('/api/supervision/stats/compliance')
            ]);

            // Backend returns data directly (not wrapped in { data: ... })
            setActivityStats(Array.isArray(activityRes) ? activityRes : (activityRes?.data || []));
            setUserStats(Array.isArray(userRes) ? userRes : (userRes?.data || []));
            setComplianceStats(activityRes && typeof complianceRes === 'object' ? complianceRes : (complianceRes?.data || null));
        } catch (error) {
            console.error('Failed to load supervision data:', error);
        } finally {
            setLoading(false);
        }
    };

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
            <div className="grid gap-4 md:grid-cols-3">
                <Card className="card-hover border-l-4 border-l-red-500 shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Lewat Masa Retensi</CardTitle>
                        <div className="p-2 bg-red-100/50 rounded-full">
                            <AlertTriangle className="h-4 w-4 text-red-600" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-red-600">{complianceStats?.overdueRetention || 0}</div>
                        <p className="text-xs text-muted-foreground mt-1">Arsip perlu tindak lanjut pemusnahan</p>
                    </CardContent>
                </Card>

                <Card className="card-hover border-l-4 border-l-amber-500 shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Belum Terverifikasi</CardTitle>
                        <div className="p-2 bg-amber-100/50 rounded-full">
                            <Clock className="h-4 w-4 text-amber-600" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-amber-600">{complianceStats?.unverifiedElectronic || 0}</div>
                        <p className="text-xs text-muted-foreground mt-1">Arsip elektronik menunggu verifikasi</p>
                    </CardContent>
                </Card>

                <Card className="card-hover border-l-4 border-l-emerald-500 shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Arsip Baru (Bulan Ini)</CardTitle>
                        <div className="p-2 bg-emerald-100/50 rounded-full">
                            <Activity className="h-4 w-4 text-emerald-600" />
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-emerald-600">{complianceStats?.newArchivesThisMonth || 0}</div>
                        <p className="text-xs text-muted-foreground mt-1">Total input arsip bulan ini</p>
                    </CardContent>
                </Card>
            </div>

            {/* Charts */}
            <div className="grid gap-6 md:grid-cols-2">
                <Card className="shadow-sm">
                    <CardHeader>
                        <CardTitle className="text-base">Tren Aktivitas Sistem</CardTitle>
                        <CardDescription>Frekuensi aksi Create, Update, Delete per hari</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[350px] w-full">
                            <Line data={activityChartData} options={chartOptions} />
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
