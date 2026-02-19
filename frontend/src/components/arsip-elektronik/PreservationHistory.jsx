import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { id as idLocale } from 'date-fns/locale';
import { Loader2, History, User } from 'lucide-react';
import { api } from '@/services/api';

export default function PreservationHistory({ arsipId }) {
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (arsipId) {
            loadHistory();
        }
    }, [arsipId]);

    const loadHistory = async () => {
        try {
            const data = await api.get(`/arsip-elektronik/${arsipId}/preservasi`);
            setHistory(data);
        } catch (error) {
            console.error('Failed to load preservation history:', error);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center p-4">
                <Loader2 className="h-6 w-6 animate-spin" />
            </div>
        );
    }

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
                    {history.map((item, index) => (
                        <div key={item.id} className="relative pl-6 border-l-2 border-muted pb-1 last:pb-0">
                            <div className="absolute -left-[9px] top-0 h-4 w-4 rounded-full bg-primary" />
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <h4 className="font-semibold text-sm capitalize">{item.action.replace('_', ' ')}</h4>
                                    <span className="text-xs text-muted-foreground">
                                        {format(new Date(item.performedAt), 'dd MMM yyyy HH:mm', { locale: idLocale })}
                                    </span>
                                </div>

                                {item.details && (
                                    <div className="bg-muted/50 p-2 rounded text-xs font-mono">
                                        {typeof item.details === 'string' && item.details.startsWith('{')
                                            ? <pre className="whitespace-pre-wrap">{JSON.stringify(JSON.parse(item.details), null, 2)}</pre>
                                            : item.details
                                        }
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
