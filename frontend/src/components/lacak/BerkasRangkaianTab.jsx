import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { ResourcePagination } from '@/components/ResourcePagination'
import { usePaginatedResource } from '@/hooks/use-paginated-resource'
import rangkaianService from '@/services/rangkaian.service'
import { LABEL_STATUS_RANGKAIAN } from '@/lib/lacak-labels'
import { lacakHref } from '@/lib/lacak-link'

const OPSI_ASAL = [['', 'Semua (tanpa data lama)'], ['surat_masuk', 'Surat masuk'], ['inisiatif', 'Inisiatif'], ['data_lama', 'Data lama']]
const OPSI_STATUS = [['', 'Semua status'], ['aktif', 'Aktif'], ['selesai', 'Selesai'], ['diberkaskan', 'Diberkaskan']]
const KELAS_SELECT = 'h-10 rounded-md border bg-background px-3 text-sm'

const tanggal = value => (value ? new Date(value).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')

export function BerkasRangkaianTab() {
    const [filter, setFilter] = useState({ unitPengolahId: '', status: '', asal: '' })
    const [unitOpsi, setUnitOpsi] = useState([])

    useEffect(() => {
        let aktif = true
        rangkaianService.unitKerjaOpsi()
            .then(rows => { if (aktif) setUnitOpsi(rows) })
            .catch(() => { if (aktif) setUnitOpsi([]) })
        return () => { aktif = false }
    }, [])

    const fetchPage = useCallback(({ page, limit }) => rangkaianService.list({
        unitPengolahId: filter.unitPengolahId || undefined,
        status: filter.status || undefined,
        asal: filter.asal || undefined,
        page,
        limit,
    }), [filter])
    const resource = usePaginatedResource(fetchPage, { queryKey: JSON.stringify(filter), pageSize: 20 })
    const ubah = kunci => event => setFilter(previous => ({ ...previous, [kunci]: event.target.value }))

    return (
        <section aria-label="Berkas Rangkaian" className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1">
                    <label htmlFor="berkas-unit" className="text-sm font-medium">Unit pengolah</label>
                    <select id="berkas-unit" className={KELAS_SELECT} value={filter.unitPengolahId} onChange={ubah('unitPengolahId')}>
                        <option value="">Semua unit</option>
                        {unitOpsi.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
                    </select>
                </div>
                <div className="flex flex-col gap-1">
                    <label htmlFor="berkas-status" className="text-sm font-medium">Status</label>
                    <select id="berkas-status" className={KELAS_SELECT} value={filter.status} onChange={ubah('status')}>
                        {OPSI_STATUS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                </div>
                <div className="flex flex-col gap-1">
                    <label htmlFor="berkas-asal" className="text-sm font-medium">Asal</label>
                    <select id="berkas-asal" className={KELAS_SELECT} value={filter.asal} onChange={ubah('asal')}>
                        {OPSI_ASAL.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                </div>
            </div>

            <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[720px] text-sm">
                    <thead className="bg-muted/50 text-left">
                        <tr>
                            <th scope="col" className="px-3 py-2">Kode</th>
                            <th scope="col" className="px-3 py-2">Judul</th>
                            <th scope="col" className="px-3 py-2">Status</th>
                            <th scope="col" className="px-3 py-2">Unit pengolah</th>
                            <th scope="col" className="px-3 py-2">Tahun</th>
                            <th scope="col" className="px-3 py-2">Anggota</th>
                            <th scope="col" className="px-3 py-2">Diberkaskan</th>
                        </tr>
                    </thead>
                    <tbody>
                        {resource.rows.map(row => (
                            <tr key={row.id} className="border-t">
                                <td className="px-3 py-2 font-mono text-xs">
                                    {row.dapatDibuka
                                        ? <Link to={lacakHref({ rangkaianId: row.id })} className="underline-offset-2 hover:underline">{row.kode}</Link>
                                        : <span title="Rangkaian ini tidak dapat Anda buka">{row.kode}</span>}
                                </td>
                                <td className="px-3 py-2">{row.judul}</td>
                                <td className="px-3 py-2"><Badge variant="secondary">{LABEL_STATUS_RANGKAIAN[row.status] ?? row.status}</Badge></td>
                                <td className="px-3 py-2">{row.unitPengolah?.nama ?? '—'}</td>
                                <td className="px-3 py-2">{row.tahun}</td>
                                <td className="px-3 py-2">{row.jumlahAnggota ?? '—'}</td>
                                <td className="px-3 py-2">{tanggal(row.diberkaskanAt)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {!resource.loading && !resource.error && resource.rows.length === 0 && (
                    <p role="status" className="p-4 text-sm text-muted-foreground">Belum ada rangkaian untuk filter ini.</p>
                )}
            </div>
            <ResourcePagination resource={resource} label="berkas rangkaian" />
        </section>
    )
}
