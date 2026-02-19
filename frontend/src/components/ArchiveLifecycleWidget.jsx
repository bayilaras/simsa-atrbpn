import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Clock, AlertTriangle, Archive, FileWarning, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { api } from '@/services/api'

/**
 * ArchiveLifecycleWidget - Shows archive status notifications
 * Display counts and lists of archives by lifecycle status
 */
export function ArchiveLifecycleWidget({ className = "" }) {
    const [data, setData] = useState(null)
    const [loading, setLoading] = useState(true)
    const [expandedSections, setExpandedSections] = useState({})

    useEffect(() => {
        fetchLifecycleData()
    }, [])

    const fetchLifecycleData = async () => {
        setLoading(true)
        try {
            const response = await api.get('/api/arsip-picker/lifecycle')
            if (response.success) {
                setData(response.data)
            }
        } catch (error) {
            console.error('Error fetching lifecycle data:', error)
        } finally {
            setLoading(false)
        }
    }

    const toggleSection = (section) => {
        setExpandedSections(prev => ({
            ...prev,
            [section]: !prev[section]
        }))
    }

    if (loading) {
        return (
            <Card className={className}>
                <CardContent className="py-6">
                    <div className="flex items-center justify-center">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                </CardContent>
            </Card>
        )
    }

    if (!data) return null

    const { summary, willBeInactive, alreadyInactive, willExpire, expired } = data

    const sections = [
        {
            key: 'expired',
            title: 'Kadaluarsa',
            icon: AlertTriangle,
            count: summary.expired,
            color: 'text-destructive',
            bgColor: 'bg-destructive/10',
            items: expired,
            badge: 'destructive',
            description: 'Perlu tindakan segera'
        },
        {
            key: 'willExpire',
            title: 'Akan Kadaluarsa',
            icon: Clock,
            count: summary.willExpire,
            color: 'text-orange-600',
            bgColor: 'bg-orange-50',
            items: willExpire,
            badge: 'outline',
            description: '30 hari lagi'
        },
        {
            key: 'alreadyInactive',
            title: 'Inaktif',
            icon: Archive,
            count: summary.alreadyInactive,
            color: 'text-blue-600',
            bgColor: 'bg-blue-50',
            items: alreadyInactive,
            badge: 'secondary',
            description: 'Masa aktif berakhir'
        },
        {
            key: 'willBeInactive',
            title: 'Akan Inaktif',
            icon: FileWarning,
            count: summary.willBeInactive,
            color: 'text-yellow-600',
            bgColor: 'bg-yellow-50',
            items: willBeInactive,
            badge: 'outline',
            description: '30 hari lagi'
        },
    ]

    const totalAlerts = summary.expired + summary.willExpire + summary.willBeInactive

    return (
        <Card className={className}>
            <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between">
                    <span className="flex items-center gap-2">
                        <Clock className="h-4 w-4" />
                        Status Retensi Arsip
                    </span>
                    {totalAlerts > 0 && (
                        <Badge variant="destructive">{totalAlerts} perlu perhatian</Badge>
                    )}
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
                {sections.map((section) => (
                    <Collapsible
                        key={section.key}
                        open={expandedSections[section.key]}
                        onOpenChange={() => toggleSection(section.key)}
                    >
                        <CollapsibleTrigger asChild>
                            <Button
                                variant="ghost"
                                className={`w-full justify-between p-3 h-auto ${section.bgColor} hover:${section.bgColor}`}
                            >
                                <div className="flex items-center gap-2">
                                    <section.icon className={`h-4 w-4 ${section.color}`} />
                                    <span className="font-medium">{section.title}</span>
                                    <Badge variant={section.badge} className="text-xs">
                                        {section.count}
                                    </Badge>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-muted-foreground">{section.description}</span>
                                    {expandedSections[section.key] ? (
                                        <ChevronUp className="h-4 w-4" />
                                    ) : (
                                        <ChevronDown className="h-4 w-4" />
                                    )}
                                </div>
                            </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                            {section.items?.length > 0 ? (
                                <div className="mt-2 space-y-1 pl-8">
                                    {section.items.slice(0, 5).map((item) => (
                                        <div key={item.id} className="text-sm p-2 bg-muted/50 rounded flex justify-between items-center">
                                            <div>
                                                <code className="text-xs">{item.nomorBerkas || item.kodeKlasifikasi}</code>
                                                <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                                                    {item.uraianBerkas || item.perihalOriginal}
                                                </p>
                                            </div>
                                            <Badge variant="outline" className="text-xs">
                                                {item.hasilAkhir || 'N/A'}
                                            </Badge>
                                        </div>
                                    ))}
                                    {section.items.length > 5 && (
                                        <p className="text-xs text-muted-foreground text-center py-1">
                                            +{section.items.length - 5} arsip lainnya
                                        </p>
                                    )}
                                </div>
                            ) : (
                                <p className="text-xs text-muted-foreground text-center py-2 pl-8">
                                    Tidak ada arsip
                                </p>
                            )}
                        </CollapsibleContent>
                    </Collapsible>
                ))}

                <div className="pt-2 border-t">
                    <p className="text-xs text-muted-foreground text-center">
                        Total {summary.total} arsip tercatat
                    </p>
                </div>
            </CardContent>
        </Card>
    )
}

export default ArchiveLifecycleWidget
