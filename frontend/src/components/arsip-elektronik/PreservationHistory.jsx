import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { format } from 'date-fns';
import { id as idLocale } from 'date-fns/locale';
import { Loader2, History, User } from 'lucide-react';
import { api } from '@/services/api';
import { Button } from '@/components/ui/button';

export default function PreservationHistory({ arsipId, refreshVersion = 0 }) {
    const [history, setHistory] = useState([]);
    const [loadedScope, setLoadedScope] = useState('');
    const [error, setError] = useState('');
    const [retry, setRetry] = useState(0);
    const scope = `${arsipId}:${refreshVersion}:${retry}`;
    const loading = loadedScope !== scope;

    useEffect(() => {
        let active = true;
        api.get(`/api/arsip-elektronik/${arsipId}/preservasi`).then(data => {
            if (active) { setHistory(data); setError(''); }
        }).catch(err => { if (active) setError(err.message || 'Riwayat gagal dimuat'); })
            .finally(() => { if (active) setLoadedScope(scope); });
        return () => { active = false; };
    }, [arsipId, scope]);

    if (loading) {
        return (
            <div className="flex justify-center p-4">
                <Loader2 className="h-6 w-6 animate-spin" />
            </div>
        );
    }

    if (error) return <div className="space-y-2"><p role="alert">{error}</p>
        <Button variant="outline" onClick={() => setRetry(value => value + 1)}>Muat ulang riwayat</Button></div>;

    if (history.length === 0) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                        <History className="h-5 w-5" />
                        Riwayat Preservasi
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-muted-foreground text-sm">Belum ada tindakan preservasi yang tercatat.</p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                    <History className="h-5 w-5" />
                    Riwayat Preservasi
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="space-y-6">
                    {history.map((item) => (
                        <div key={item.id} className="relative pl-6 border-l-2 border-muted pb-1 last:pb-0">
                            <div className="absolute -left-[9px] top-0 h-4 w-4 rounded-full bg-primary" />
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <h4 className="font-semibold text-sm capitalize">{item.action.replace('_', ' ')}</h4>
                                    <span className="text-xs text-muted-foreground">
                                        {format(new Date(item.performedAt), 'dd MMM yyyy HH:mm', { locale: idLocale })}
                                    </span>
                                </div>

                                <p className={`text-xs ${item.evidenceSnapshot?.result === 'mismatch' ? 'text-destructive' : 'text-muted-foreground'}`}>
                                    {item.recordingMode === 'system_integrity_check'
                                        ? item.evidenceSnapshot?.result === 'match' ? 'Pemeriksaan sistem: hash sesuai' : 'Pemeriksaan sistem: hash tidak cocok'
                                        : item.recordingMode === 'external_activity_recorded' ? 'Tindakan eksternal dicatat dengan bukti; tidak dijalankan oleh SIMSA'
                                            : 'Catatan lama: pelaksanaan dan bukti belum diverifikasi'}
                                </p>
                                {item.evidenceSnapshot?.toolName && <p className="text-xs">Perangkat: {item.evidenceSnapshot.toolName} {item.evidenceSnapshot.toolVersion}</p>}

                                {item.details && (
                                    <div className="bg-muted/50 p-2 rounded text-xs font-mono">
                                        <p className="whitespace-pre-wrap">{item.details}</p>
                                    </div>
                                )}

                                {item.notes && (
                                    <p className="text-sm text-muted-foreground italic">
                                        "{item.notes}"
                                    </p>
                                )}

                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <User className="h-3 w-3" />
                                    <span>{item.performedBy?.name || 'Unknown User'}</span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}
