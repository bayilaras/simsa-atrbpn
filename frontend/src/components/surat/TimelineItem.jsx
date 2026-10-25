import { useNavigate } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Clock, ExternalLink, Lock, MailMinus, MailPlus } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { id as idLocale } from 'date-fns/locale'

/** `aksi` (opsional): node React yang dirender di akhir item, mis. tombol aksi panel Alur Surat (Task 25). */
export function TimelineItem({ item, isLast, aksi = null }) {
    const isMasuk = item.type === 'masuk'
    const navigate = useNavigate()

    if (item.masked) {
        return (
            <div className="relative pl-8 pb-8 last:pb-0" data-masked="true">
                {!isLast && (
                    <div className="absolute left-[11px] top-8 bottom-0 w-0.5 bg-muted" />
                )}
                <div className="absolute left-0 top-1 p-1.5 rounded-full ring-4 ring-white bg-muted text-muted-foreground">
                    <Lock className="h-4 w-4" aria-hidden="true" />
                </div>
                <Card className="border-dashed bg-muted/60">
                    <CardContent className="p-4 space-y-1">
                        <Badge variant="outline">{isMasuk ? 'Surat Masuk' : 'Surat Keluar'}</Badge>
                        <p className="font-semibold text-muted-foreground">Dikecualikan</p>
                        {item.unitNama && <p className="text-sm text-muted-foreground">{item.unitNama}</p>}
                        {aksi && <div className="flex flex-wrap gap-2 pt-2">{aksi}</div>}
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className="relative pl-8 pb-8 last:pb-0">
            {/* Connector line */}
            {!isLast && (
                <div className="absolute left-[11px] top-8 bottom-0 w-0.5 bg-muted" />
            )}

            {/* Icon */}
            <div className={`absolute left-0 top-1 p-1.5 rounded-full ring-4 ring-white ${isMasuk ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600' : 'bg-blue-100 dark:bg-blue-500/15 text-blue-600'
                }`}>
                {isMasuk ? <MailPlus className="h-4 w-4" /> : <MailMinus className="h-4 w-4" />}
            </div>

            <Card className="hover:shadow-md transition-shadow duration-200">
                <CardContent className="p-4">
                    <div className="flex flex-col sm:flex-row gap-4 justify-between items-start">
                        <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                                <Badge variant={isMasuk ? 'default' : 'secondary'} className={isMasuk ? 'bg-emerald-600' : 'bg-primary text-white'}>
                                    {isMasuk ? 'Surat Masuk' : 'Surat Keluar'}
                                </Badge>
                                {item.relasiLabel && (Array.isArray(item.relasiLabel) ? item.relasiLabel : [item.relasiLabel]).map((label, index) => (
                                    <Badge key={`${label}-${index}`} variant="outline">{label}</Badge>
                                ))}
                                {item.tanggal && (
                                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                                        <Clock className="h-3 w-3" />
                                        {/* item.tanggal berasal dari tanggalSurat (kolom date, tanpa jam) di
                                            semua pemanggil saat ini -- memformat dengan HH:mm akan selalu
                                            menampilkan "00:00" yang palsu, jadi tanggal-saja diformat tanpa jam. */}
                                        {format(parseISO(item.tanggal), 'dd MMMM yyyy', { locale: idLocale })}
                                    </span>
                                )}
                            </div>
                            <h4 className="font-semibold text-base">{item.perihal || 'Tanpa Perihal'}</h4>
                            <p className="text-sm text-muted-foreground font-mono bg-muted/50 px-2 py-0.5 rounded inline-block">
                                {item.nomorSurat || 'Tanpa Nomor'}
                            </p>
                            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground mt-1">
                                <span className={isMasuk ? 'text-emerald-700 dark:text-emerald-300' : 'text-blue-700 dark:text-blue-300'}>
                                    {isMasuk ? `Dari: ${item.dari}` : `Kepada: ${item.kepada}`}
                                </span>
                                {item.unitNama && <span className="text-xs">· {item.unitNama}</span>}
                            </div>
                        </div>
                        <div className="flex gap-2 shrink-0">
                            <Button variant="outline" size="sm" onClick={() => navigate(`/surat/${item.type}/${item.id}`)}>
                                <ExternalLink className="mr-2 h-3.5 w-3.5" />
                                Detail
                            </Button>
                        </div>
                    </div>
                    {aksi && <div className="mt-3 flex flex-wrap gap-2">{aksi}</div>}
                </CardContent>
            </Card>
        </div>
    )
}

export default TimelineItem
