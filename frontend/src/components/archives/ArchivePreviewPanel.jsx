import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FilePreviewSection } from '@/components/surat-masuk/FilePreviewSection'
import { useAppConfig } from '@/context/app-config-context'
import { arsipService } from '@/services/arsip.service'
import { suratMasukService } from '@/services/surat-masuk.service'
import { suratKeluarService } from '@/services/surat-keluar.service'

const ARCHIVE_TYPES = { masuk: 'Surat masuk', keluar: 'Surat keluar' }
const DISPOSAL_LABELS = {
    active: 'Tidak ada usulan berjalan', proposed_pindah: 'Usulan pemindahan', proposed_musnah: 'Usulan pemusnahan',
    proposed_serah: 'Usulan penyerahan', approved: 'Disetujui', executed: 'Dilaksanakan',
}

function displayDate(value) {
    if (!value) return '—'
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
}

function usePreviewRecord(service, id) {
    const [state, setState] = useState({ loading: true, record: null, error: null })
    useEffect(() => {
        let current = true
        async function load() {
            try {
                const result = await service.getById(id)
                const record = result?.data ?? result
                if (!record) throw new Error('Data tidak tersedia.')
                if (current) setState({ loading: false, record, error: null })
            } catch (error) {
                if (current) setState({ loading: false, record: null, error })
            }
        }
        load()
        return () => { current = false }
    }, [service, id])
    return state
}

function MetadataGroup({ title, fields }) {
    return (
        <section className="min-w-0 space-y-3">
            <h3 className="text-sm font-semibold">{title}</h3>
            <dl className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                {fields.map(([label, value]) => (
                    <div key={label} className="min-w-0">
                        <dt className="text-xs text-muted-foreground">{label}</dt>
                        <dd className="mt-1 break-words text-sm [overflow-wrap:anywhere]">{value ?? '—'}</dd>
                    </div>
                ))}
            </dl>
        </section>
    )
}

function ArchiveMetadata({ archive }) {
    return <div className="space-y-5">
        <MetadataGroup title="Identitas arsip" fields={[
            ['Nomor berkas', archive.nomorBerkas], ['Kode klasifikasi', archive.kodeKlasifikasi],
            ['Uraian klasifikasi', archive.klasifikasiArsip],
            ['Jenis arsip', ARCHIVE_TYPES[archive.jenisArsip] || 'Belum tercatat'], ['Tahun', archive.tahun],
            ['Nomor surat', archive.nomorSuratOriginal], ['Tanggal arsip', displayDate(archive.tanggalArsip)],
            ['Media', archive.mediaType],
        ]} />
        <MetadataGroup title="Lokasi penyimpanan" fields={[
            ['Filing cabinet', archive.lokasiFc], ['Laci', archive.lokasiLaci],
            ['Folder', archive.lokasiFolder], ['Unit pengolah', archive.unitPengolah],
        ]} />
        <MetadataGroup title="Retensi dan penyusutan" fields={[
            ['Status penyusutan', DISPOSAL_LABELS[archive.disposalStatus] || archive.disposalStatus],
            ['Kode JRA', archive.jraKode], ['Uraian JRA', archive.jraUraian], ['Retensi aktif', archive.retensiAktif],
            ['Retensi inaktif', archive.retensiInaktif], ['Hasil akhir', archive.hasilAkhir],
            ['Tanggal kadaluarsa', displayDate(archive.tanggalKadaluarsa)],
        ]} />
        <MetadataGroup title="Keamanan dan akses" fields={[
            ['Klasifikasi keamanan', archive.klasifikasiKeamanan || 'Belum tercatat'],
            ['Penanggung jawab', archive.personInCharge],
            ['Status peminjaman', ({ available: 'Tersedia', borrowed: 'Dipinjam' })[archive.lendingStatus] || archive.lendingStatus],
            ['Penahanan hukum', archive.legalHold === true ? 'Aktif' : archive.legalHold === false ? 'Tidak aktif' : 'Belum tercatat'],
        ]} />
    </div>
}

function SourceDocumentContent({ archive, onRetry }) {
    const service = archive.jenisArsip === 'masuk' ? suratMasukService : suratKeluarService
    const { loading, record, error } = usePreviewRecord(service, archive.sourceSuratId)
    if (loading) return <p role="status" className="text-sm text-muted-foreground">Memuat dokumen sumber…</p>
    if (error) {
        const status = error.status ?? error.response?.status
        const forbidden = status === 401 || status === 403
        return <div className="space-y-3">
            <p role="status" className="text-sm text-muted-foreground">
                {forbidden ? 'Anda tidak memiliki akses ke dokumen sumber arsip ini.'
                    : 'Dokumen sumber belum dapat diakses atau sudah tidak tersedia.'}
            </p>
            {!forbidden && <Button type="button" variant="outline" onClick={onRetry}>Coba muat dokumen sumber lagi</Button>}
        </div>
    }
    if (!record.filePath) return <p className="text-sm text-muted-foreground">Belum ada berkas digital pada surat sumber.</p>
    return <div className="min-w-0 [overflow-wrap:anywhere] [&_button]:whitespace-normal [&_button]:h-auto [&_button]:min-h-9">
        <FilePreviewSection surat={record} entityType={archive.jenisArsip === 'masuk' ? 'surat_masuk' : 'surat_keluar'} />
    </div>
}

function SourceDocument({ archive }) {
    const [attempt, setAttempt] = useState(0)
    return <SourceDocumentContent key={attempt} archive={archive} onRetry={() => setAttempt(value => value + 1)} />
}

function ArchivePreviewContent({ archiveId, onRetry }) {
    const { capabilities } = useAppConfig()
    const { loading, record: archive, error } = usePreviewRecord(arsipService, archiveId)
    if (loading) return <div role="status" aria-label="Memuat pratinjau arsip" className="space-y-4 p-5">
        <span className="sr-only">Memuat pratinjau arsip…</span>
        {[1, 2, 3].map(item => <div key={item} aria-hidden="true" className="h-20 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />)}
    </div>
    if (error) return <div className="space-y-3 p-5">
        <p role="alert" className="text-sm text-destructive">Gagal memuat pratinjau arsip. Data mungkin tidak tersedia atau akses Anda telah berubah.</p>
        <Button type="button" variant="outline" onClick={onRetry}><RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />Coba lagi</Button>
    </div>
    return <div className="min-w-0 space-y-5 p-5">
        <p className="break-words font-semibold [overflow-wrap:anywhere]">{archive.uraianBerkas || archive.perihalOriginal || 'Arsip tanpa uraian'}</p>
        <section className="min-w-0 space-y-3" aria-label="Berkas digital">
            <h3 className="text-sm font-semibold">Berkas digital</h3>
            {!capabilities.files ? <p className="text-sm text-muted-foreground">Penyimpanan berkas digital belum diaktifkan. Metadata arsip tetap tersedia.</p>
                : !archive.sourceSuratId || !ARCHIVE_TYPES[archive.jenisArsip]
                    ? <p className="text-sm text-muted-foreground">Arsip ini belum terhubung dengan surat sumber untuk pratinjau berkas.</p>
                    : <SourceDocument key={`${archive.jenisArsip}:${archive.sourceSuratId}`} archive={archive} />}
        </section>
        <ArchiveMetadata archive={archive} />
        <Button asChild variant="outline" className="w-full">
            <Link to={`/arsip/detail/${encodeURIComponent(archiveId)}`}>Buka detail lengkap<ArrowUpRight className="ml-2 h-4 w-4" aria-hidden="true" /></Link>
        </Button>
    </div>
}

export function ArchivePreviewPanel({ archiveId, onClose }) {
    const headingId = useId()
    const headingRef = useRef(null)
    const [attempt, setAttempt] = useState(0)
    useEffect(() => { headingRef.current?.focus() }, [archiveId])
    return <aside aria-labelledby={headingId} className="w-full min-w-0 self-start rounded-lg border bg-card text-card-foreground xl:sticky xl:top-4 xl:max-h-[calc(100dvh-6rem)] xl:overflow-y-auto"
        onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
        <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
            <h2 id={headingId} ref={headingRef} tabIndex={-1} className="min-w-0 rounded-sm text-base font-semibold focus-visible:outline-2 focus-visible:outline-ring">Pratinjau arsip</h2>
            <Button type="button" size="icon" variant="ghost" className="shrink-0" aria-label="Tutup pratinjau arsip" onClick={onClose}><X className="h-4 w-4" aria-hidden="true" /></Button>
        </div>
        <ArchivePreviewContent key={`${archiveId}:${attempt}`} archiveId={archiveId} onRetry={() => setAttempt(value => value + 1)} />
    </aside>
}

export default ArchivePreviewPanel
